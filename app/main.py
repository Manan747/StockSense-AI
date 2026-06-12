import os
import logging
import asyncio
import time
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Query, Request, Path
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import yfinance as yf

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables
load_dotenv()

from app.screener import get_screener_data, NIFTY_50_TICKERS
from app.ai_analyst import get_investment_thesis
from app.cache import screener_cache

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Rate Limiter setup
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="StockSense AI Backend",
    description="Intelligent stock screener API for Indian Markets",
    version="1.0.0"
)

# Custom Rate Limit Exceeded Handler to Log Abuse
def custom_rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    client_ip = get_remote_address(request)
    logger.warning(f"Rate limit exceeded | ip={client_ip} | path={request.url.path}")
    return _rate_limit_exceeded_handler(request, exc)

# Attach rate limiter to app and register error handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, custom_rate_limit_exceeded_handler)

# CORS Configuration
# React app runs on http://localhost:5173 by default in Vite.
# Restrict origins dynamically with ALLOWED_ORIGINS env variable
origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
origins = [o.strip() for o in origins if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to StockSense AI API. Use /api/stocks to get screener data."}

@app.get("/health")
def health_check():
    """
    Standard deployment health check endpoint for Railway / Render with cache checks.
    """
    try:
        screener_cache.set("health_check_key", "ok", expiry_seconds=10)
        cache_status = "available" if screener_cache.get("health_check_key") == "ok" else "unavailable"
    except Exception as e:
        logger.error(f"Health check cache failure: {str(e)}")
        cache_status = "unavailable"
        
    return {
        "status": "ok" if cache_status == "available" else "degraded",
        "cache": cache_status
    }

@app.get("/api/stocks")
def get_stocks(refresh: bool = Query(False, description="Force refresh the data from yfinance")):
    """
    Returns the compiled screener data for all 50 Nifty 50 tickers.
    Includes technical indicators (RSI, volume spikes), 52w High/Low, P/E, EPS, and 30-day sparklines.
    """
    try:
        data = get_screener_data(force_refresh=refresh)
        return data
    except Exception as e:
        logger.error(f"Error in /api/stocks: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch stock screener data. Please try again later.")

@app.get("/api/stocks/{ticker}")
async def get_stock_detail(
    ticker: str = Path(..., min_length=1, max_length=20, pattern="^[a-zA-Z]{1,10}([&-][a-zA-Z]{1,10})?(\\.[a-zA-Z]{1,5})?$")
):
    """
    Returns detailed metrics and 1-year historical data for a specific ticker
    to support rich charting (1W/1M/3M/1Y ranges) on the frontend.
    """
    # Clean up input ticker
    ticker = ticker.upper().strip()
    if ticker not in NIFTY_50_TICKERS:
        # Fallback check, check if .NS suffix is missing
        if not ticker.endswith(".NS") and f"{ticker}.NS" in NIFTY_50_TICKERS:
            ticker = f"{ticker}.NS"
        else:
            raise HTTPException(status_code=404, detail="Stock ticker not found in the supported Nifty 50 list")

    import uuid
    req_id = str(uuid.uuid4())[:8]
    logger.info(f"[{req_id}] {ticker} | start_detail_fetch")
    start_time = time.time()

    # Check cache first
    cache_key = f"detail_data_{ticker}"
    cached_detail = screener_cache.get(cache_key)
    if cached_detail:
        logger.info(f"[{req_id}] {ticker} | cache=hit")
        response_time = time.time() - start_time
        logger.info(f"[{req_id}] {ticker} | status=success | time={response_time:.4f}s")
        return cached_detail

    logger.info(f"[{req_id}] {ticker} | cache=miss")

    # Define the blocking yfinance history call with retry logic (1 retry attempt)
    def fetch_blocking():
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                t = yf.Ticker(ticker)
                hist_df = t.history(period="1y", interval="1d")
                if hist_df.empty:
                    raise ValueError("No historical data returned")
                return hist_df
            except Exception as e:
                logger.warning(f"[{req_id}] Attempt {attempt + 1} failed for yfinance fetch on {ticker}: {str(e)}")
                if attempt == max_attempts - 1:
                    raise e
                time.sleep(0.5)

    try:
        # Fetch 1 year of history for this ticker in a thread pool with a 10s timeout
        hist_df = await asyncio.wait_for(asyncio.to_thread(fetch_blocking), timeout=10.0)

        # Format historical data
        history = []
        for index, row in hist_df.iterrows():
            history.append({
                "date": index.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"])
            })

        # Get the screener metrics for this stock (run in thread to keep loop free)
        screener_data = await asyncio.to_thread(get_screener_data, force_refresh=False)
        stock_metrics = next((s for s in screener_data if s["ticker"] == ticker), {})

        result = {
            "ticker": ticker,
            "name": stock_metrics.get("name") or ticker.replace(".NS", ""),
            "metrics": stock_metrics,
            "history": history
        }

        # Cache detail data for 15 minutes (900 seconds)
        screener_cache.set(cache_key, result, expiry_seconds=900)
        
        response_time = time.time() - start_time
        logger.info(f"[{req_id}] {ticker} | status=success | time={response_time:.4f}s")
        return result

    except asyncio.TimeoutError:
        logger.error(f"[{req_id}] Timeout fetching detail data for {ticker}")
        raise HTTPException(status_code=504, detail="Request to market data timed out. Please try again later.")
    except Exception as e:
        logger.error(f"[{req_id}] {ticker} | failed | {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch details for {ticker.replace('.NS', '')}. Please try again later.")

@app.post("/api/stocks/{ticker}/analysis")
@app.get("/api/stocks/{ticker}/analysis")
@limiter.limit("5/minute")
async def get_stock_analysis(
    request: Request,
    ticker: str = Path(..., min_length=1, max_length=20, pattern="^[a-zA-Z]{1,10}([&-][a-zA-Z]{1,10})?(\\.[a-zA-Z]{1,5})?$"),
    tone: str = Query("advanced", description="AI Analyst tone: advanced or el5")
):
    """
    Triggers Gemini to generate a structured 3-bullet investment thesis.
    Adheres strictly to quantitative parameters. Supports both GET and POST.
    """
    ticker = ticker.upper().strip()
    if ticker not in NIFTY_50_TICKERS:
        if not ticker.endswith(".NS") and f"{ticker}.NS" in NIFTY_50_TICKERS:
            ticker = f"{ticker}.NS"
        else:
            raise HTTPException(status_code=404, detail="Stock ticker not found in the supported Nifty 50 list")

    if tone not in ("advanced", "el5"):
        raise HTTPException(status_code=400, detail="Invalid tone parameter. Must be 'advanced' or 'el5'.")

    import uuid
    req_id = str(uuid.uuid4())[:8]
    logger.info(f"[{req_id}] {ticker} | start_analysis | tone={tone}")
    start_time = time.time()

    try:
        # Load screener data (blocking call, run in thread)
        screener_data = await asyncio.to_thread(get_screener_data, force_refresh=False)
        stock_metrics = next((s for s in screener_data if s["ticker"] == ticker), None)
        
        if not stock_metrics:
            raise HTTPException(status_code=404, detail=f"Metrics not found for {ticker}")

        name = stock_metrics.get("name", ticker)
        
        # Call Gemini generation (blocking call, run in thread) with a 15-second timeout
        thesis = await asyncio.wait_for(
            asyncio.to_thread(get_investment_thesis, ticker, name, stock_metrics, req_id, tone),
            timeout=15.0
        )
        
        response_time = time.time() - start_time
        logger.info(f"[{req_id}] {ticker} | status=success | tone={tone} | time={response_time:.4f}s")
        return {"ticker": ticker, "name": name, "analysis": thesis}
        
    except asyncio.TimeoutError:
        logger.error(f"[{req_id}] Timeout generating analysis for {ticker}")
        raise HTTPException(status_code=504, detail="AI generation request timed out. Please try again later.")
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"[{req_id}] {ticker} | failed_analysis | {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate investment thesis. Please check configuration and network connectivity.")
