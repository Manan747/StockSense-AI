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
            "verdict_reason": "Signal Score 0.0/10 — quantitative processing halted due to missing backend credentials.",
            "valuation_signal": "Sector benchmark P/E comparison unavailable without API connection.",
            "momentum_signal": "Volume trend processing suspended.",
            "key_risk": "Execution warning — Missing API key in environment config."
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
            "You are a simple, friendly financial guide. Write a structured investment thesis. "
            "Rule 1: Never write BUY, SELL, or any directional recommendation. Replace with signal scores, risk levels, or conditional statements. "
            "Rule 2: Every single number must have a benchmark comparison (e.g. 'trades 12% below sector median of 19.6'). "
            "Rule 3: Outcomes before explanations. Lead with the financial impact in ₹ or % before explaining the reason. "
            "You must output six properties: verdict (strictly BUY, HOLD, or AVOID), confidence (a number from 0.0 to 10.0), "
            "verdict_reason, valuation_signal, momentum_signal, and key_risk. Explain things using simple everyday analogies. "
            "Be extremely concise, direct, and write no disclaimers or warnings."
        )
    else:
        system_instruction_text = (
            "You are a concise equity analyst at Zerodha. Write a structured investment thesis. "
            "Rule 1: Never write BUY, SELL, or any directional recommendation. Replace with signal scores, risk levels, or conditional statements. "
            "Rule 2: Every single number must have a benchmark comparison (sector or Nifty comparison benchmarks). "
            "Rule 3: Outcomes before explanations. Lead all explanations with outcomes (financial impact in % or ₹) before explaining the reasons (e.g. 'Margin compression risk — NIM contracted 18bps YoY. Watch Q2 results'). "
            "Rule 4: State failures directly. Be direct, use numbers, and write no disclaimers or warnings. "
            "You must output six properties: verdict (strictly BUY, HOLD, or AVOID), confidence (a number from 0.0 to 10.0), "
            "verdict_reason, valuation_signal, momentum_signal, and key_risk."
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
        "verdict_reason": f"Signal Score 0.0/10 — AI generation failed: {last_error}",
        "valuation_signal": f"P/E comparison unavailable due to API error: {last_error}",
        "momentum_signal": "Volume trend processing suspended.",
        "key_risk": f"Execution warning — AI analysis failed: {last_error}"
    }

def get_goal_path_explanation(goal_data: Dict[str, Any], req_id: str = "internal", tone: str = "advanced") -> Dict[str, Any]:
    """
    Calls Google Gemini to generate a personalized structured advice report for the user's financial goal.
    Caches the explanation to minimize LLM invocation costs.
    """
    import hashlib
    
    # Generate a stable cache key
    serialized_data = json.dumps(goal_data, sort_keys=True)
    hash_str = hashlib.md5(serialized_data.encode("utf-8")).hexdigest()
    cache_key = f"ai_goal_path_{hash_str}_{tone}"
    
    cached_explanation = screener_cache.get(cache_key)
    if cached_explanation:
        logger.info(f"[{req_id}] goal_path_thesis | cache=hit | retrieved cached explanation ({tone} tone)")
        return cached_explanation

    logger.info(f"[{req_id}] goal_path_thesis | cache=miss | generating fresh explanation ({tone} tone)")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY environment variable is not set. Skipping Gemini explanation generation.")
        fallback_msg = "Advisory suspended — missing backend API credentials."
        return {
            "why_it_works": fallback_msg,
            "tradeoffs": "Timeline adjustment review pending: Expected target corpus not validated.",
            "top_3_risks": "1. CAGR Deficit — rolling 10-year windows have underperformed at <6% returns.\n2. Sequence of Returns Risk — final-year crashes wipe out accumulated compound growth.\n3. Behavior Failure Rate — panic-selling during drawdowns destroys capital.",
            "what_could_go_wrong": "Severe correction risk — A -30% drawdown at current allocation halts compounding and delays goals by multiple years."
        }

    # Format data summary for LLM
    stocks_summary = ", ".join([f"{s['ticker']} ({s['name']})" for s in goal_data.get("suggested_stocks", [])])
    
    financials_summary = f"""
    -- Financial Parameters --
    Target Corpus: INR {goal_data.get('target_amount'):,}
    Time Horizon: {goal_data.get('time_horizon')} years
    Current Monthly SIP: INR {goal_data.get('monthly_sip'):,}
    Starting Lump Sum: INR {goal_data.get('lump_sum'):,}
    Selected Risk Tolerance: {goal_data.get('risk_tolerance')}
    
    -- Projection & Feasibility Metrics --
    Projected Portfolio Value: INR {goal_data.get('projected_value'):,}
    Shortfall / Gap: INR {goal_data.get('gap'):,}
    Feasibility Status: {goal_data.get('status').upper()}
    Required SIP Increase/Adjustment: INR {goal_data.get('sip_adjustment'):,} (Target Total SIP: INR {goal_data.get('required_sip'):,})
    Required Time Extension: {goal_data.get('time_extension_years')} years (Total timeline required: {goal_data.get('total_required_years')} years)
    
    -- Recommended Allocation --
    Equity: {goal_data.get('allocation', {}).get('equity')}% (Large-cap: {goal_data.get('equity_breakdown', {}).get('large_cap')}%, Mid-cap: {goal_data.get('equity_breakdown', {}).get('mid_cap')}%, Index: {goal_data.get('equity_breakdown', {}).get('index')}%)
    Debt: {goal_data.get('allocation', {}).get('debt')}%
    Cash/Gold: {goal_data.get('allocation', {}).get('cash')}%
    
    -- Suggested Nifty 50 Stocks for Equity portion --
    Stocks: {stocks_summary}
    """

    headers = {"Content-Type": "application/json"}
    
    if tone == "el5":
        system_instruction_text = (
            "You are a friendly, encouraging financial guide. Given the user's financial goal parameters and feasibility analysis, "
            "write a structured explanation. Explain things using simple everyday metaphors that a 5-year-old would easily understand. "
            "Rule 1: Never use directional recommendation/advisory terms like buy/sell. "
            "Rule 2: Every single number must have a benchmark comparison. "
            "Rule 3: Lead all explanations with outcomes (like the final amount or shortfall percentage) before explaining. "
            "Rule 4: Do not soften or sugarcoat failures. State clearly that the plan fails and by how much (e.g., 'This plan fails. You will miss your ₹1 Cr goal by ₹53.6L (54%)'). "
            "Be concise and write no disclaimers or warnings. "
            "You must fill in four properties: why_it_works, tradeoffs, top_3_risks, and what_could_go_wrong."
        )
    else:
        system_instruction_text = (
            "You are a concise, outcome-driven wealth strategist. Given the user's goal parameters and quantitative feasibility analysis, "
            "generate a professional, structured investment decision thesis. "
            "Rule 1: Never use directional recommendation/advisory terms like buy/sell. "
            "Rule 2: Every single number must have a benchmark comparison (e.g., CAGR compared to Nifty benchmark). "
            "Rule 3: Lead all explanations with outcomes first, followed by quantitative reasons. "
            "Rule 4: Do not soften or sugarcoat failures. Explicitly state the shortfall amount and percentage gap first (e.g., 'This plan fails. You will miss your ₹1 Cr goal by ₹53.6L (54%) at current pace.'). "
            "Be concise, direct, use specific numbers, and write no disclaimers or warnings. "
            "You must fill in four properties: why_it_works, tradeoffs, top_3_risks, and what_could_go_wrong."
        )

    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": f"Analyze this goal planning setup and provide strategic advice:\n{financials_summary}"
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
                    "why_it_works": {"type": "STRING", "description": "Explain in detail why this specific asset allocation matches their financial target and risk level."},
                    "tradeoffs": {"type": "STRING", "description": "Assessment of their progress status, shortfall gap, and required adjustments (SIP amount vs time expansion)."},
                    "top_3_risks": {"type": "STRING", "description": "Write down exactly 3 bullet points showing the top 3 risks of this allocation in the Indian context."},
                    "what_could_go_wrong": {"type": "STRING", "description": "Detail what could go wrong (market underperformance risk, overestimation of CAGR, and behavioral consistency)."}
                },
                "required": ["why_it_works", "tradeoffs", "top_3_risks", "what_could_go_wrong"]
            }
        }
    }

    last_error = ""
    for model_name in MODELS_FALLBACK:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                logger.info(f"Attempting Gemini explanation for goal using {model_name} (attempt {attempt + 1}/{max_attempts})...")
                response = requests.post(url, headers=headers, json=payload, timeout=12)
                response.raise_for_status()
                res_json = response.json()
                
                candidates = res_json.get("candidates", [])
                if candidates:
                    content = candidates[0].get("content", {})
                    parts = content.get("parts", [])
                    if parts:
                        explanation_str = parts[0].get("text", "").strip()
                        explanation_dict = json.loads(explanation_str)
                        
                        # Cache the results for 15 minutes
                        screener_cache.set(cache_key, explanation_dict, expiry_seconds=900)
                        return explanation_dict
                
                last_error = f"Invalid response structure from {model_name}"
                break
                
            except Exception as e:
                err_msg = str(e)
                if hasattr(e, 'response') and e.response is not None:
                    try:
                        err_detail = e.response.json()
                        err_msg = err_detail.get("error", {}).get("message", e.response.text)
                    except Exception:
                        err_msg = f"Status {e.response.status_code} - {e.response.text}"
                
                logger.warning(f"Failed to generate goal path explanation using {model_name} on attempt {attempt + 1}: {err_msg}")
                last_error = err_msg
                
                if attempt < max_attempts - 1:
                    import time
                    time.sleep(0.5)

    logger.error(f"All Gemini models failed for goal path explanation. Last error: {last_error}")
    return {
        "why_it_works": "Strategic review suspended — AI advisory generation failed.",
        "tradeoffs": f"Goal status check: Projected value underperforms target with API error: {last_error}",
        "top_3_risks": "1. CAGR Deficit — rolling 10-year windows have underperformed at <6% returns.\n2. Sequence of Returns Risk — final-year crashes wipe out accumulated compound growth.\n3. Behavior Failure Rate — panic-selling during drawdowns destroys capital.",
        "what_could_go_wrong": f"Downturn stress crash simulation error: {last_error}"
    }

