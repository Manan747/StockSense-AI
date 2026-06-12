import os
import logging
import json
from typing import Dict, Any
import requests
from app.cache import screener_cache

logger = logging.getLogger(__name__)

MODELS_FALLBACK = [
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-latest"
]

def get_investment_thesis(ticker: str, name: str, metrics: Dict[str, Any], req_id: str = "internal", tone: str = "advanced") -> Dict[str, Any]:
    """
    Calls Google Gemini API using a fallback model list to get a structured JSON investment thesis.
    Caches the response for 15 minutes to save costs and reduce latency.
    """
    cache_key = f"ai_thesis_{ticker}_{tone}"
    cached_thesis = screener_cache.get(cache_key)
    if cached_thesis:
        logger.info(f"[{req_id}] {ticker} | cache=hit | retrieved cached thesis ({tone} tone)")
        return cached_thesis

    logger.info(f"[{req_id}] {ticker} | cache=miss | generating fresh thesis ({tone} tone)")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY environment variable is not set. Skipping Gemini generation.")
        err_msg = "AI Analysis Unavailable: GEMINI_API_KEY is not set in the backend environment. Please configure your key."
        return {
            "verdict": "HOLD",
            "confidence": 0.0,
            "verdict_reason": "Gemini API key is not configured.",
            "valuation_signal": err_msg,
            "momentum_signal": "Signal unavailable.",
            "key_risk": "Risk signal unavailable."
        }

    # Prepare prompt with available metrics
    metrics_summary = f"""
    Ticker: {ticker}
    Company Name: {name}
    Current Price: INR {metrics.get('current_price', 'N/A')}
    P/E Ratio: {metrics.get('pe', 'N/A')}
    EPS: {metrics.get('eps', 'N/A')}
    14-Day RSI: {metrics.get('rsi', 'N/A')}
    Market Cap: {f"INR {metrics.get('market_cap'):,}" if metrics.get('market_cap') else 'N/A'}
    52-Week High: INR {metrics.get('high_52w', 'N/A')}
    52-Week Low: INR {metrics.get('low_52w', 'N/A')}
    Today's Volume: {f"{metrics.get('volume_today'):,}" if metrics.get('volume_today') else 'N/A'}
    30-Day Avg Volume: {f"{int(metrics.get('volume_avg_30d')):,}" if metrics.get('volume_avg_30d') else 'N/A'}
    """

    headers = {"Content-Type": "application/json"}
    
    if tone == "el5":
        system_instruction_text = (
            "You are a simple, friendly financial guide. Given these stock metrics, write a structured investment "
            "thesis. You must output six properties: verdict (strictly BUY, HOLD, or AVOID), confidence (a number from 0.0 to 10.0), "
            "verdict_reason (a simple summary sentence), valuation_signal, momentum_signal, and key_risk. "
            "Explain things using simple everyday analogies (like buying candies, sharing toys, or playground rules) "
            "that a 5-year-old would easily grasp. Do not use financial jargon without explaining it simply. "
            "Be concise and write no disclaimers or warnings."
        )
    else:
        system_instruction_text = (
            "You are a concise equity analyst. Given these stock metrics, write a structured investment thesis. "
            "You must output six properties: verdict (strictly BUY, HOLD, or AVOID), confidence (a number from 0.0 to 10.0), "
            "verdict_reason (a summary sentence), valuation_signal, momentum_signal, and key_risk. "
            "Be direct, use numbers, and write no disclaimers or warnings."
        )

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": f"Analyze this stock and provide the investment thesis:\n{metrics_summary}"
                    }
                ]
            }
        ],
        "systemInstruction": {
            "parts": [
                {
                    "text": system_instruction_text
                }
            ]
        },
        "generationConfig": {
            "temperature": 0.5,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "verdict": {"type": "STRING", "description": "Strictly one of: BUY, HOLD, AVOID"},
                    "confidence": {"type": "NUMBER", "description": "Confidence score from 0.0 to 10.0"},
                    "verdict_reason": {"type": "STRING", "description": "A brief 1-sentence reasoning summary combining major indicators"},
                    "valuation_signal": {"type": "STRING"},
                    "momentum_signal": {"type": "STRING"},
                    "key_risk": {"type": "STRING"}
                },
                "required": ["verdict", "confidence", "verdict_reason", "valuation_signal", "momentum_signal", "key_risk"]
            }
        }
    }

    last_error = ""
    for model_name in MODELS_FALLBACK:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                logger.info(f"Attempting Gemini generation for {ticker} using {model_name} (attempt {attempt + 1}/{max_attempts})...")
                response = requests.post(url, headers=headers, json=payload, timeout=10)
                response.raise_for_status()
                res_json = response.json()
                
                candidates = res_json.get("candidates", [])
                if candidates:
                    content = candidates[0].get("content", {})
                    parts = content.get("parts", [])
                    if parts:
                        thesis_str = parts[0].get("text", "").strip()
                        # Parse the thesis string to structured dict
                        thesis_dict = json.loads(thesis_str)
                        
                        # Cache the parsed dict for 15 minutes (900 seconds)
                        screener_cache.set(cache_key, thesis_dict, expiry_seconds=900)
                        return thesis_dict
                
                last_error = f"Invalid response structure from {model_name}"
                break  # If response JSON structural checks failed, don't retry, try next model
                
            except Exception as e:
                err_msg = str(e)
                if hasattr(e, 'response') and e.response is not None:
                    try:
                        err_detail = e.response.json()
                        err_msg = err_detail.get("error", {}).get("message", e.response.text)
                    except Exception:
                        err_msg = f"Status {e.response.status_code} - {e.response.text}"
                
                logger.warning(f"Failed to generate analysis using {model_name} on attempt {attempt + 1}: {err_msg}")
                last_error = err_msg
                
                if attempt < max_attempts - 1:
                    import time
                    time.sleep(0.5)

    logger.error(f"All Gemini models failed for {ticker}. Last error: {last_error}")
    return {
        "verdict": "HOLD",
        "confidence": 0.0,
        "verdict_reason": f"AI Generation failed: {last_error}",
        "valuation_signal": f"AI Analysis failed: {last_error}",
        "momentum_signal": "Signal unavailable.",
        "key_risk": "Risk signal unavailable."
    }
