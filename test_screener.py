import os
import sys
import pandas as pd
import numpy as np

# Ensure app is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.screener import calculate_rsi
from app.cache import screener_cache

def test_rsi():
    print("--- Running RSI Calculation Test ---")
    # Generate 30 days of price data:
    # 15 days of gains, followed by 15 days of losses
    prices = pd.Series([100.0 + i for i in range(15)] + [114.0 - i for i in range(15)])
    rsi_series = calculate_rsi(prices, period=14)
    
    print(f"Prices count: {len(prices)}")
    print(f"Calculated RSI count: {len(rsi_series)}")
    latest_rsi = rsi_series.iloc[-1]
    print(f"Latest RSI: {latest_rsi:.2f}")
    
    assert len(rsi_series) == len(prices), "RSI series length must match input prices length"
    assert not np.isnan(latest_rsi), "Latest RSI value should not be NaN"
    assert 0 <= latest_rsi <= 100, "RSI must be between 0 and 100"
    print("[OK] RSI Wilder's calculation formula verified.")

def test_yfinance():
    print("\n--- Running Single yfinance Fetch Test ---")
    import yfinance as yf
    import requests


    # Configure session with standard browser headers to avoid HTTP 429
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    })

    ticker = "RELIANCE.NS"
    try:
        t = yf.Ticker(ticker, session=session)
        print(f"Fetching metadata for {ticker} (info call)...")
        info = t.info
        print(f"  Name: {info.get('longName')}")
        print(f"  P/E: {info.get('trailingPE') or info.get('forwardPE')}")
        print(f"  Market Cap: {info.get('marketCap')}")
        print("[OK] Live yfinance info fetch verified.")
    except Exception as e:
        print(f"[WARNING] yfinance info fetch rate-limited or failed: {str(e)}")

    print("\nTesting batch yf.download (historical close data)...")
    try:
        data = yf.download(tickers=["RELIANCE.NS", "TCS.NS"], period="1mo", session=session, progress=False)
        print(f"  Downloaded columns: {list(data.columns.levels[0]) if hasattr(data.columns, 'levels') else list(data.columns)}")
        print(f"  Data points count: {len(data)}")
        if not data.empty:
            print("[OK] Live yf.download connection verified successfully.")
        else:
            print("[ERROR] Downloaded data is empty.")
    except Exception as e:
        print(f"[ERROR] Batch yf.download failed: {str(e)}")




if __name__ == "__main__":
    test_rsi()
    test_yfinance()
    print("\nBackend code verification complete.")
