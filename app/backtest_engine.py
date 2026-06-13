import logging
import datetime
import numpy as np
import pandas as pd
import yfinance as yf
from typing import Dict, List, Any, Tuple
from app.cache import screener_cache

logger = logging.getLogger(__name__)

# Portfolio Allocations (same as goal_path.py)
PORTFOLIO_ALLOCATIONS = {
    "low": {"equity": 0.20, "debt": 0.70, "cash": 0.10},
    "medium": {"equity": 0.60, "debt": 0.30, "cash": 0.10},
    "high": {"equity": 0.85, "debt": 0.10, "cash": 0.05}
}

# Assumed steady annual returns for debt and cash/gold portions
DEBT_ANNUAL_RETURN = 0.065   # 6.5% CAGR
CASH_ANNUAL_RETURN = 0.040   # 4.0% CAGR

def xirr(cash_flows: List[Tuple[float, datetime.date]]) -> float:
    """
    Calculates the Internal Rate of Return (IRR) for a series of periodic cash flows.
    Cash flows is a list of tuples: (amount, date).
    Negative amounts are outflows (investments), positive amount is the final value.
    """
    if not cash_flows or len(cash_flows) < 2:
        return 0.0

    t0 = cash_flows[0][1]

    def npv(rate: float) -> float:
        val = 0.0
        for amount, date in cash_flows:
            t_years = (date - t0).days / 365.25
            val += amount / ((1.0 + rate) ** t_years)
        return val

    # Verify if we have both negative and positive flows
    negatives = any(cf[0] < 0 for cf in cash_flows)
    positives = any(cf[0] > 0 for cf in cash_flows)
    if not (negatives and positives):
        return 0.0

    # Bisection search
    low_r = -0.99
    high_r = 5.0
    for _ in range(50):
        mid_r = (low_r + high_r) / 2.0
        val = npv(mid_r)
        if val > 0:
            low_r = mid_r
        else:
            high_r = mid_r

    return low_r

def calculate_max_drawdown(values: List[float]) -> float:
    """
    Computes the maximum peak-to-trough drawdown of a value series.
    """
    if not values:
        return 0.0
    peak = values[0]
    max_dd = 0.0
    for v in values:
        if v > peak:
            peak = v
        dd = (peak - v) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd
    return max_dd

def calculate_volatility(values: List[float]) -> float:
    """
    Computes the annualized volatility of the daily return series.
    """
    if len(values) < 2:
        return 0.0
    returns = []
    for i in range(1, len(values)):
        prev = values[i-1]
        r = (values[i] - prev) / prev if prev > 0 else 0.0
        returns.append(r)
    
    std_dev = float(np.std(returns))
    return std_dev * np.sqrt(252)

def get_nifty_data(time_horizon_years: int) -> pd.DataFrame:
    """
    Downloads and caches daily Nifty 50 index closing prices from yfinance.
    Falls back to a high-quality mock data generator if the API fails or is offline.
    """
    ticker = "^NSEI"
    cache_key = f"nifty_historical_data_{time_horizon_years}y"
    cached = screener_cache.get(cache_key)
    if cached is not None:
        logger.info(f"Retrieved cached Nifty historical data for {time_horizon_years}y")
        # Reconstruct DataFrame from cached dict list
        df = pd.DataFrame(cached)
        df["Date"] = pd.to_datetime(df["Date"]).dt.date
        df.set_index("Date", inplace=True)
        return df

    logger.info(f"Fetching fresh Nifty historical data for {time_horizon_years}y from yfinance...")
    try:
        # Download historical data
        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=int(time_horizon_years * 365.25))
        
        # Pull slightly more history to ensure we get the full time_horizon backtest
        df = yf.download(ticker, start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), progress=False)
        
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
            
        if df.empty or "Close" not in df.columns:
            raise ValueError("Empty response or missing Close column from yfinance download.")
            
        # Clean dataframe
        df = df[["Close"]].copy()
        df.index = pd.to_datetime(df.index).date
        df.index.name = "Date"
        df.sort_index(inplace=True)
        
        # Cache the dataframe as a list of dicts for serialization
        df_reset = df.reset_index()
        # Convert Date objects to string for JSON serialization in cache
        df_reset["Date"] = df_reset["Date"].astype(str)
        screener_cache.set(cache_key, df_reset.to_dict(orient="records"), expiry_seconds=86400) # Cache for 1 day
        
        return df
        
    except Exception as e:
        logger.error(f"Failed to fetch Nifty data: {str(e)}. Generating high-quality fallback series.")
        return generate_fallback_series(time_horizon_years)

def generate_fallback_series(time_horizon_years: int) -> pd.DataFrame:
    """
    Generates a realistic mock Nifty 50 daily closing price series.
    Assumes standard long-term index trajectory (12.5% CAGR, 15% Volatility, cyclical drawdowns).
    """
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=int(time_horizon_years * 365.25))
    
    # Generate business days
    dates = pd.bdate_range(start=start_date, end=end_date)
    
    # Random walk simulation
    n_days = len(dates)
    daily_drift = 0.125 / 252.0
    daily_vol = 0.15 / np.sqrt(252.0)
    
    # Generate random returns
    np.random.seed(42)  # Seed for deterministic simulation behavior
    random_returns = np.random.normal(daily_drift, daily_vol, n_days)
    
    # Add cyclical market corrections (-15% crash and recovery cycles)
    for i in range(n_days):
        # Apply a correction cycle every few years
        cycle_idx = i / (252.0 * 4) # Cycle period of 4 years
        correction_factor = -0.12 * np.sin(cycle_idx * 2 * np.pi)
        if correction_factor < 0:
            random_returns[i] += correction_factor / 252.0
            
    prices = [10000.0]
    for r in random_returns:
        prices.append(prices[-1] * (1.0 + r))
    prices = prices[1:] # Trim starting point
    
    df = pd.DataFrame(index=dates.date, data={"Close": prices})
    df.index.name = "Date"
    return df

def run_rolling_analysis(
    lump_sum: float,
    monthly_sip: float,
    risk_tolerance: str,
    window_years: int
) -> Dict[str, Any]:
    """
    Simulates investment performance across rolling windows of time (equal to window_years)
    using Nifty historical data from the past 15 years to avoid cherry-picked results.
    """
    # Fetch 15 years of Nifty data for broad rolling windows
    df_15 = get_nifty_data(15)
    dates_15 = list(df_15.index)
    prices_15 = []
    
    if "Close" in df_15.columns:
        if isinstance(df_15["Close"], pd.DataFrame):
            prices_15 = df_15["Close"].iloc[:, 0].astype(float).tolist()
        else:
            prices_15 = df_15["Close"].astype(float).tolist()
    else:
        prices_15 = df_15.iloc[:, 0].astype(float).tolist()

    if len(dates_15) < 252 or not prices_15:
        # Fallback if empty
        df_15 = generate_fallback_series(15)
        dates_15 = list(df_15.index)
        prices_15 = df_15["Close"].astype(float).tolist()

    # Define allocation
    allocation = PORTFOLIO_ALLOCATIONS.get(risk_tolerance.lower(), PORTFOLIO_ALLOCATIONS["medium"])
    w_e = allocation["equity"]
    w_d = allocation["debt"]
    w_c = allocation["cash"]

    daily_debt_rate = (1.0 + DEBT_ANNUAL_RETURN) ** (1.0 / 252.0) - 1.0
    daily_cash_rate = (1.0 + CASH_ANNUAL_RETURN) ** (1.0 / 252.0) - 1.0

    # Ensure window days matches trading calendar
    actual_window_years = min(window_years, 12)
    window_days = int(actual_window_years * 252)
    step = 126  # Step by 6 months

    total_len = len(dates_15)
    if window_days >= total_len:
        window_days = max(252, total_len // 2)

    windows = []
    for start_idx in range(0, total_len - window_days, step):
        end_idx = start_idx + window_days
        
        w_dates = dates_15[start_idx:end_idx]
        w_prices = prices_15[start_idx:end_idx]
        
        # Benchmark Portfolio
        nifty_units = lump_sum / w_prices[0]
        nifty_value_path = [lump_sum]
        nifty_cash_flows = [(-lump_sum, w_dates[0])]
        
        # User Portfolio
        user_equity_units = (w_e * lump_sum) / w_prices[0]
        user_debt_value = w_d * lump_sum
        user_cash_value = w_c * lump_sum
        user_value_path = [lump_sum]
        user_cash_flows = [(-lump_sum, w_dates[0])]
        
        last_month = w_dates[0].month
        
        for j in range(1, len(w_dates)):
            date = w_dates[j]
            price = w_prices[j]
            
            user_debt_value *= (1.0 + daily_debt_rate)
            user_cash_value *= (1.0 + daily_cash_rate)
            
            if date.month != last_month:
                # Add SIP
                nifty_units += monthly_sip / price
                nifty_cash_flows.append((-monthly_sip, date))
                
                user_equity_units += (w_e * monthly_sip) / price
                user_debt_value += (w_d * monthly_sip)
                user_cash_value += (w_c * monthly_sip)
                user_cash_flows.append((-monthly_sip, date))
                
                last_month = date.month
                
            nifty_value_path.append(nifty_units * price)
            user_value_path.append((user_equity_units * price) + user_debt_value + user_cash_value)
            
        final_nifty_val = nifty_value_path[-1]
        final_user_val = user_value_path[-1]
        
        nifty_cash_flows.append((final_nifty_val, w_dates[-1]))
        user_cash_flows.append((final_user_val, w_dates[-1]))
        
        n_cagr = xirr(nifty_cash_flows)
        u_cagr = xirr(user_cash_flows)
        
        n_max_dd = calculate_max_drawdown(nifty_value_path)
        u_max_dd = calculate_max_drawdown(user_value_path)
        
        windows.append({
            "start_date": w_dates[0].strftime("%Y-%m-%d"),
            "end_date": w_dates[-1].strftime("%Y-%m-%d"),
            "user_cagr": round(u_cagr * 100.0, 2),
            "nifty_cagr": round(n_cagr * 100.0, 2),
            "user_max_dd": round(u_max_dd * 100.0, 2),
            "nifty_max_dd": round(n_max_dd * 100.0, 2),
            "outperformed": u_cagr > n_cagr
        })
        
    if not windows:
        return {}

    total_windows = len(windows)
    outperformed_count = sum(1 for w in windows if w["outperformed"])
    outperformance_rate = (outperformed_count / total_windows) * 100.0
    
    avg_user_cagr = np.mean([w["user_cagr"] for w in windows])
    avg_nifty_cagr = np.mean([w["nifty_cagr"] for w in windows])
    avg_user_max_dd = np.mean([w["user_max_dd"] for w in windows])
    avg_nifty_max_dd = np.mean([w["nifty_max_dd"] for w in windows])
    
    return {
        "outperformance_rate_pct": round(outperformance_rate, 2),
        "total_windows": total_windows,
        "avg_user_cagr": round(float(avg_user_cagr), 2),
        "avg_nifty_cagr": round(float(avg_nifty_cagr), 2),
        "avg_user_max_dd": round(float(avg_user_max_dd), 2),
        "avg_nifty_max_dd": round(float(avg_nifty_max_dd), 2),
        "windows": windows[:15]
    }

def run_backtest(
    lump_sum: float,
    monthly_sip: float,
    risk_tolerance: str,
    time_horizon: int
) -> Dict[str, Any]:
    """
    Performs historical simulation of a Lump-sum and Monthly SIP strategy.
    Compares Nifty 50 index (100% Equity) vs a custom User Allocated Portfolio.
    """
    risk_tolerance = risk_tolerance.lower()
    if risk_tolerance not in PORTFOLIO_ALLOCATIONS:
        risk_tolerance = "medium"
        
    allocation = PORTFOLIO_ALLOCATIONS[risk_tolerance]
    w_e = allocation["equity"]
    w_d = allocation["debt"]
    w_c = allocation["cash"]
    
    # 1. Fetch historical Nifty data
    df = get_nifty_data(time_horizon)
    dates = list(df.index)
    
    if "Close" in df.columns:
        if isinstance(df["Close"], pd.DataFrame):
            prices = df["Close"].iloc[:, 0].astype(float).tolist()
        else:
            prices = df["Close"].astype(float).tolist()
    else:
        # Columns might be MultiIndex (e.g. ('Close', '^NSEI'))
        prices = df.iloc[:, 0].astype(float).tolist()
        
    if len(dates) < 2 or not prices:
        # Fallback if somehow empty
        df = generate_fallback_series(time_horizon)
        dates = list(df.index)
        prices = df["Close"].astype(float).tolist()

    # Precompute daily rates for compounding Debt and Cash
    daily_debt_rate = (1.0 + DEBT_ANNUAL_RETURN) ** (1.0 / 252.0) - 1.0
    daily_cash_rate = (1.0 + CASH_ANNUAL_RETURN) ** (1.0 / 252.0) - 1.0

    # 2. Simulation State variables
    # Benchmark Portfolio
    nifty_units = lump_sum / prices[0]
    nifty_value_path = [lump_sum]
    nifty_total_invested = lump_sum
    nifty_cash_flows = [(-lump_sum, dates[0])]
    
    # User Allocated Portfolio
    user_equity_units = (w_e * lump_sum) / prices[0]
    user_debt_value = w_d * lump_sum
    user_cash_value = w_c * lump_sum
    user_value_path = [lump_sum]
    user_total_invested = lump_sum
    user_cash_flows = [(-lump_sum, dates[0])]

    last_month = dates[0].month

    # 3. Step day by day through history
    for i in range(1, len(dates)):
        date = dates[i]
        price = prices[i]
        
        # Compound debt and cash for user portfolio
        user_debt_value *= (1.0 + daily_debt_rate)
        user_cash_value *= (1.0 + daily_cash_rate)
        
        # Check if calendar month changed for monthly SIP contribution
        if date.month != last_month:
            # SIP contribution
            # Nifty Benchmark
            nifty_units += monthly_sip / price
            nifty_total_invested += monthly_sip
            nifty_cash_flows.append((-monthly_sip, date))
            
            # User Allocated Portfolio
            user_equity_units += (w_e * monthly_sip) / price
            user_debt_value += (w_d * monthly_sip)
            user_cash_value += (w_c * monthly_sip)
            user_total_invested += monthly_sip
            user_cash_flows.append((-monthly_sip, date))
            
            last_month = date.month
            
        # Compute daily valuations
        nifty_val = nifty_units * price
        nifty_value_path.append(nifty_val)
        
        user_val = (user_equity_units * price) + user_debt_value + user_cash_value
        user_value_path.append(user_val)

    # 4. Final valuations and XIRR cash flows
    final_nifty_val = nifty_value_path[-1]
    final_user_val = user_value_path[-1]
    
    nifty_cash_flows.append((final_nifty_val, dates[-1]))
    user_cash_flows.append((final_user_val, dates[-1]))

    # Calculate metrics
    nifty_cagr = xirr(nifty_cash_flows)
    user_cagr = xirr(user_cash_flows)
    
    nifty_max_dd = calculate_max_drawdown(nifty_value_path)
    user_max_dd = calculate_max_drawdown(user_value_path)
    
    nifty_vol = calculate_volatility(nifty_value_path)
    user_vol = calculate_volatility(user_value_path)
    
    outperformance = user_cagr - nifty_cagr
    drawdown_diff = nifty_max_dd - user_max_dd # Positive means user has lower drawdown
    
    # 5. Build sampled chart data points (~100 points max to keep UI fast)
    chart_data = []
    step = max(1, len(dates) // 100)
    for idx in range(0, len(dates), step):
        chart_data.append({
            "date": dates[idx].strftime("%Y-%m-%d"),
            "nifty": round(nifty_value_path[idx], 2),
            "portfolio": round(user_value_path[idx], 2)
        })
        
    # Append final day explicitly if not already included
    if (len(dates) - 1) % step != 0:
        chart_data.append({
            "date": dates[-1].strftime("%Y-%m-%d"),
            "nifty": round(nifty_value_path[-1], 2),
            "portfolio": round(user_value_path[-1], 2)
        })

    # Run rolling analysis over 15 years
    rolling_analysis = run_rolling_analysis(
        lump_sum=lump_sum,
        monthly_sip=monthly_sip,
        risk_tolerance=risk_tolerance,
        window_years=time_horizon
    )

    # Calculate Sharpe Ratio
    risk_free_rate = 0.06
    user_sharpe = (user_cagr - risk_free_rate) / user_vol if user_vol > 0 else 0.0
    nifty_sharpe = (nifty_cagr - risk_free_rate) / nifty_vol if nifty_vol > 0 else 0.0

    return {
        "user_portfolio": {
            "final_value": round(final_user_val, 2),
            "total_invested": round(user_total_invested, 2),
            "cagr": round(user_cagr * 100.0, 2),
            "max_drawdown": round(user_max_dd * 100.0, 2),
            "volatility": round(user_vol * 100.0, 2),
            "sharpe_ratio": round(user_sharpe, 2)
        },
        "nifty_benchmark": {
            "final_value": round(final_nifty_val, 2),
            "total_invested": round(nifty_total_invested, 2),
            "cagr": round(nifty_cagr * 100.0, 2),
            "max_drawdown": round(nifty_max_dd * 100.0, 2),
            "volatility": round(nifty_vol * 100.0, 2),
            "sharpe_ratio": round(nifty_sharpe, 2)
        },
        "comparison": {
            "outperformance_pct": round(outperformance * 100.0, 2),
            "drawdown_reduction_pct": round(drawdown_diff * 100.0, 2)
        },
        "chart_data": chart_data,
        "rolling_analysis": rolling_analysis
    }
