import logging
import numpy as np
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Expected Returns (min, expected, max) - same as goal_path.py
RISK_RETURNS = {
    "low": 0.07,     # 7.0% expected
    "medium": 0.11,  # 11.0% expected
    "high": 0.135    # 13.5% expected
}

def calculate_fv_step(current_value: float, monthly_sip: float, monthly_rate: float, months: int) -> float:
    """
    Compounds a starting value and monthly SIP contributions for a given number of months.
    """
    val = current_value
    for _ in range(months):
        # Grow the current balance
        val *= (1.0 + monthly_rate)
        # Add the monthly SIP (assuming beginning-of-month payment)
        val += monthly_sip * (1.0 + monthly_rate)
    return val

def simulate_market_crash(
    target_amount: float,
    time_horizon: int,
    monthly_sip: float,
    lump_sum: float,
    risk_tolerance: str,
    crash_pct: float = 0.30,  # Default -30% drawdown
    crash_year: int = 5
) -> Dict[str, Any]:
    """
    Simulates a severe market crash at Year 5 (or mid-horizon for shorter timelines),
    and calculates final corpus impact, recovery timeline, and goal delays.
    """
    risk_tolerance = risk_tolerance.lower()
    annual_rate = RISK_RETURNS.get(risk_tolerance, 0.11)
    monthly_rate = annual_rate / 12.0
    
    # Adjust crash year if horizon is too short
    # If timeline is <= 3 years, crash at middle year.
    # Otherwise crash at min(5, time_horizon - 1)
    if time_horizon <= 3:
        actual_crash_year = max(1, time_horizon // 2)
    else:
        actual_crash_year = min(crash_year, time_horizon - 1)

    crash_month = actual_crash_year * 12
    total_months = time_horizon * 12

    # 1. Standard projection without crash
    standard_final = lump_sum
    # Month-by-month to match the crash math exactly
    standard_final = calculate_fv_step(standard_final, monthly_sip, monthly_rate, total_months)

    # 2. Projection with crash
    # Step A: Compound normally until crash month
    pre_crash_val = lump_sum
    pre_crash_val = calculate_fv_step(pre_crash_val, monthly_sip, monthly_rate, crash_month)
    
    # Step B: Apply crash shock
    post_crash_val = pre_crash_val * (1.0 - crash_pct)
    
    # Step C: Resume compounding after crash month
    post_crash_months = total_months - crash_month
    shocked_final = post_crash_val
    shocked_final = calculate_fv_step(shocked_final, monthly_sip, monthly_rate, post_crash_months)

    # 3. Calculate recovery timeline (months to grow from post_crash_val back to pre_crash_val)
    recovery_months = 0
    temp_val = post_crash_val
    # Cap search at 120 months (10 years)
    for m in range(1, 121):
        temp_val = (temp_val + monthly_sip) * (1.0 + monthly_rate)
        if temp_val >= pre_crash_val:
            recovery_months = m
            break
            
    recovery_years = round(recovery_months / 12.0, 1)

    # 4. Calculate goal delay (how many additional months to reach target_amount under crash)
    goal_delay_years = 0.0
    if shocked_final < target_amount:
        # Loop forward from shocked_final value until we reach target
        additional_months = 0
        temp_val = shocked_final
        # Limit search to 360 months (30 years)
        for m in range(1, 361):
            temp_val = (temp_val + monthly_sip) * (1.0 + monthly_rate)
            if temp_val >= target_amount:
                additional_months = m
                break
        goal_delay_years = round(additional_months / 12.0, 1)

    impact_val = standard_final - shocked_final
    impact_pct = (impact_val / standard_final) * 100.0 if standard_final > 0 else 0.0

    return {
        "crash_year": actual_crash_year,
        "crash_drawdown_pct": round(crash_pct * 100.0, 1),
        "standard_final_corpus": round(standard_final, 2),
        "shocked_final_corpus": round(shocked_final, 2),
        "impact_value": round(impact_val, 2),
        "impact_pct": round(impact_pct, 2),
        "recovery_years": recovery_years,
        "recovery_months": recovery_months,
        "goal_delay_years": goal_delay_years,
        "is_delayed": goal_delay_years > 0
    }
