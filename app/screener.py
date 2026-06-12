import logging
import concurrent.futures
import numpy as np
import pandas as pd
import yfinance as yf
from typing import List, Dict, Any
from app.cache import screener_cache

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 50 Nifty 50 Tickers with .NS suffix
NIFTY_50_TICKERS = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "BHARTIARTL.NS",
    "INFY.NS", "ITC.NS", "SBIN.NS", "LICI.NS", "LT.NS",
    "HINDUNILVR.NS", "HCLTECH.NS", "AXISBANK.NS", "SUNPHARMA.NS", "KOTAKBANK.NS",
    "TATAMOTORS.NS", "NTPC.NS", "ONGC.NS", "COALINDIA.NS", "ADANIENT.NS",
    "ADANIPORTS.NS", "MARUTI.NS", "POWERGRID.NS", "TATASTEEL.NS", "TITAN.NS",
    "ULTRACEMCO.NS", "JSWSTEEL.NS", "GRASIM.NS", "NESTLEIND.NS", "TECHM.NS",
    "BAJFINANCE.NS", "WIPRO.NS", "ASIANPAINT.NS", "HINDALCO.NS", "SBILIFE.NS",
    "HDFCLIFE.NS", "DRREDDY.NS", "CIPLA.NS", "APOLLOHOSP.NS", "TATACONSUM.NS",
    "BPCL.NS", "BRITANNIA.NS", "INDUSINDBK.NS", "EICHERMOT.NS", "DIVISLAB.NS",
    "HEROMOTOCO.NS", "BAJAJ-AUTO.NS", "BAJAJFINSV.NS", "SHRIRAMFIN.NS", "M&M.NS"
]

def calculate_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """
    Calculates the 14-day Relative Strength Index (RSI) using Wilder's smoothing method.
    """
    if len(prices) < period + 1:
        return pd.Series(index=prices.index, dtype=float)
    
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    
    # Pre-allocate Series for Wilders averages
    avg_gain = pd.Series(index=prices.index, dtype=float)
    avg_loss = pd.Series(index=prices.index, dtype=float)
    
    # The first average is a simple average of the first 'period' gains/losses
    avg_gain.iloc[period] = gain.iloc[1:period+1].mean()
    avg_loss.iloc[period] = loss.iloc[1:period+1].mean()
    
    # Subsequent values use Wilder's exponential smoothing
    for i in range(period + 1, len(prices)):
        avg_gain.iloc[i] = (avg_gain.iloc[i - 1] * (period - 1) + gain.iloc[i]) / period
        avg_loss.iloc[i] = (avg_loss.iloc[i - 1] * (period - 1) + loss.iloc[i]) / period
        
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    
    # Replace division by zero cases
    rsi = rsi.replace([np.inf], 100.0)
    rsi.loc[(avg_gain == 0) & (avg_loss == 0)] = 50.0
    
    return rsi

def fetch_ticker_info(ticker: str) -> Dict[str, Any]:
    """
    Fetches fundamental metrics for a single ticker.
    Handles rate-limiting and other connection issues gracefully.
    """
    try:
        t = yf.Ticker(ticker)
        info = t.info
        return {
            "ticker": ticker,
            "pe": info.get("trailingPE") or info.get("forwardPE"),
            "eps": info.get("trailingEps"),
            "market_cap": info.get("marketCap"),
            "name": info.get("longName") or ticker.replace(".NS", "")
        }
    except Exception as e:
        logger.error(f"Error fetching info for {ticker}: {str(e)}")
        # Fallback values
        return {
            "ticker": ticker,
            "pe": None,
            "eps": None,
            "market_cap": None,
            "name": ticker.replace(".NS", "")
        }

def get_screener_data(force_refresh: bool = False) -> List[Dict[str, Any]]:
    """
    Gets quantitative metrics and fundamentals for all 50 tickers.
    Loads from cache if available and not expired.
    """
    cache_key = "nifty_50_screener_data"
    if not force_refresh:
        cached_data = screener_cache.get(cache_key)
        if cached_data:
            logger.info("Screener data retrieved from cache.")
            return cached_data

    logger.info("Cache miss or force refresh. Fetching fresh market data...")
    
    # 1. Fetch 1-year historical data for all tickers in a single batch
    try:
        # 1 year covers 52w indicators and ensures RSI stability
        hist_df = yf.download(
            tickers=NIFTY_50_TICKERS,
            period="1y",
            interval="1d",
            group_by="ticker",
            progress=False
        )
    except Exception as e:
        logger.error(f"Failed to batch download historical data: {str(e)}")
        hist_df = None

    # 2. Fetch fundamentals in parallel
    info_map = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
        future_to_ticker = {executor.submit(fetch_ticker_info, ticker): ticker for ticker in NIFTY_50_TICKERS}
        for future in concurrent.futures.as_completed(future_to_ticker):
            result = future.result()
            info_map[result["ticker"]] = result

    # 3. Combine history calculations with fundamentals
    combined_results = []
    
    for ticker in NIFTY_50_TICKERS:
        fundamentals = info_map.get(ticker, {
            "pe": None, "eps": None, "market_cap": None, "name": ticker.replace(".NS", "")
        })
        
        stock_result = {
            "ticker": ticker,
            "name": fundamentals["name"],
            "pe": fundamentals["pe"],
            "eps": fundamentals["eps"],
            "market_cap": fundamentals["market_cap"],
            "current_price": None,
            "rsi": None,
            "volume_today": None,
            "volume_avg_30d": None,
            "high_52w": None,
            "low_52w": None,
            "pct_from_52w_high": None,
            "pct_from_52w_low": None,
            "sparkline_30d": [],
            "status": "data_unavailable"
        }
        
        # Parse history data if available
        if hist_df is not None and ticker in hist_df.columns.levels[0]:
            try:
                # Get the DataFrame for this ticker and drop empty rows
                ticker_df = hist_df[ticker].dropna(subset=["Close"])
                
                if len(ticker_df) >= 15:
                    # Calculate RSI
                    rsi_series = calculate_rsi(ticker_df["Close"])
                    latest_rsi = rsi_series.iloc[-1]
                    if not np.isnan(latest_rsi):
                        stock_result["rsi"] = float(round(latest_rsi, 2))
                    
                    # Current price
                    current_price = float(ticker_df["Close"].iloc[-1])
                    stock_result["current_price"] = float(round(current_price, 2))
                    
                    # Volumes
                    volume_today = int(ticker_df["Volume"].iloc[-1])
                    # Last 30 trading days volume average
                    volume_avg_30d = float(ticker_df["Volume"].iloc[-30:].mean())
                    stock_result["volume_today"] = volume_today
                    stock_result["volume_avg_30d"] = float(round(volume_avg_30d, 2))
                    
                    # 52w High / Low
                    high_52w = float(ticker_df["High"].max())
                    low_52w = float(ticker_df["Low"].min())
                    stock_result["high_52w"] = float(round(high_52w, 2))
                    stock_result["low_52w"] = float(round(low_52w, 2))
                    
                    # Proximity %
                    # % below 52w High
                    pct_from_high = ((high_52w - current_price) / high_52w) * 100
                    # % above 52w Low
                    pct_from_low = ((current_price - low_52w) / low_52w) * 100
                    stock_result["pct_from_52w_high"] = float(round(pct_from_high, 2))
                    stock_result["pct_from_52w_low"] = float(round(pct_from_low, 2))
                    
                    # Sparkline data (30-day closing prices)
                    spark_prices = ticker_df["Close"].iloc[-30:].tolist()
                    stock_result["sparkline_30d"] = [float(round(p, 2)) for p in spark_prices]
                    stock_result["status"] = "active"
            except Exception as e:
                logger.error(f"Error parsing history for {ticker}: {str(e)}")
                
        combined_results.append(stock_result)
        
    # Store combined results in cache
    screener_cache.set(cache_key, combined_results)
    return combined_results
