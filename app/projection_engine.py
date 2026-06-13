import logging
import numpy as np
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

RISK_RETURNS = {
    "low": (6.0, 7.0, 8.0),
    "medium": (10.0, 11.0, 12.0),
    "high": (12.0, 13.5, 15.0)
}

def calculate_fv_upgraded(
    lump_sum: float,
    monthly_sip: float,
    annual_rate: float,
    total_months: float,
    delay_months: float = 0.0
) -> float:
    """
    Computes Future Value (FV) with start delays and monthly compounding.
    Investments do not compound or accumulate SIP contributions during delay.
    """
    if total_months <= delay_months:
        return lump_sum
        
    active_months = total_months - delay_months
    r_m = annual_rate / 12.0
    
    if r_m > 0:
        fv_lump = lump_sum * ((1.0 + r_m) ** active_months)
        fv_sip = monthly_sip * (((1.0 + r_m) ** active_months - 1.0) / r_m) * (1.0 + r_m)
    else:
        fv_lump = lump_sum
        fv_sip = monthly_sip * active_months
        
    return fv_lump + fv_sip

def solve_required_months_upgraded(
    target_amount: float,
    lump_sum: float,
    monthly_sip: float,
    annual_rate: float,
    delay_months: float = 0.0
) -> int:
    """
    Numerical binary search solver to find required compounding months under scenario conditions.
    Capped at 1200 months (100 years).
    """
    if lump_sum >= target_amount:
        return 0
    if monthly_sip <= 0 and annual_rate <= 0:
        return 1200
        
    low_m = delay_months
    high_m = 1200.0
    
    for _ in range(40):
        mid_m = (low_m + high_m) / 2.0
        fv = calculate_fv_upgraded(lump_sum, monthly_sip, annual_rate, mid_m, delay_months)
        if fv >= target_amount:
            high_m = mid_m
        else:
            low_m = mid_m
            
    return int(np.ceil(high_m - 1e-5))

def run_projections(
    target_amount: float,
    time_horizon: int,
    monthly_sip: float,
    lump_sum: float,
    risk_tolerance: str,
    inflation_rate: float = 0.0,
    return_shock: float = 0.0,
    time_delay: int = 0
) -> Dict[str, Any]:
    """
    Calculates year-by-year nominal/real projection path, feasibility metrics,
    and updates adjustments based on risk shocks and inflation deflations.
    """
    risk_tolerance = risk_tolerance.lower()
    if risk_tolerance not in RISK_RETURNS:
        risk_tolerance = "medium"
        
    # Standard rates
    min_nom, exp_nom, max_nom = [r / 100.0 for r in RISK_RETURNS[risk_tolerance]]
    
    # Apply return shock
    min_nom = max(0.0, min_nom - return_shock)
    exp_nom = max(0.0, exp_nom - return_shock)
    max_nom = max(0.0, max_nom - return_shock)
    
    # Convert nominal rates to real rates using Fisher equation: (1+nom)/(1+infl) - 1
    # This deflates the projections directly, showing real purchasing power values
    min_real = (1.0 + min_nom) / (1.0 + inflation_rate) - 1.0 if inflation_rate > 0 else min_nom
    exp_real = (1.0 + exp_nom) / (1.0 + inflation_rate) - 1.0 if inflation_rate > 0 else exp_nom
    max_real = (1.0 + max_nom) / (1.0 + inflation_rate) - 1.0 if inflation_rate > 0 else max_nom
    
    delay_months = time_delay * 12
    
    # Year by year path
    path = []
    for year in range(time_horizon + 1):
        months = year * 12
        fv_pess = calculate_fv_upgraded(lump_sum, monthly_sip, min_real, months, delay_months)
        fv_exp = calculate_fv_upgraded(lump_sum, monthly_sip, exp_real, months, delay_months)
        fv_opt = calculate_fv_upgraded(lump_sum, monthly_sip, max_real, months, delay_months)
        
        path.append({
            "year": year,
            "pessimistic": round(fv_pess, 2),
            "expected": round(fv_exp, 2),
            "optimistic": round(fv_opt, 2)
        })
        
    final_exp = path[-1]["expected"]
    gap = max(0.0, target_amount - final_exp)
    
    # Feasibility status
    if final_exp >= target_amount * 1.10:
        status = "overachieving"
    elif final_exp >= target_amount:
        status = "on_track"
    else:
        status = "behind_target"
        
    # Solve for required SIP under stress
    N = time_horizon * 12
    active_months = max(0.0, N - delay_months)
    r_m = exp_real / 12.0
    
    if active_months > 0:
        if r_m > 0:
            m_sip_factor = (((1.0 + r_m) ** active_months - 1.0) / r_m) * (1.0 + r_m)
            lump_fv = lump_sum * ((1.0 + r_m) ** active_months)
        else:
            m_sip_factor = active_months
            lump_fv = lump_sum
        required_sip = (target_amount - lump_fv) / m_sip_factor
        required_sip = max(0.0, required_sip)
    else:
        required_sip = 0.0
        
    sip_adjustment = required_sip - monthly_sip
    
    # Solve for required timeline extension under stress
    req_months = solve_required_months_upgraded(target_amount, lump_sum, monthly_sip, exp_real, delay_months)
    req_years = round(req_months / 12.0, 1)
    time_extension = max(0.0, req_years - time_horizon)
    
    return {
        "projected_value": round(final_exp, 2),
        "target_amount": target_amount,
        "time_horizon": time_horizon,
        "monthly_sip": monthly_sip,
        "lump_sum": lump_sum,
        "gap": round(gap, 2),
        "status": status,
        "path": path,
        "sip_adjustment": round(sip_adjustment, 2),
        "required_sip": round(required_sip, 2),
        "time_extension_years": time_extension,
        "total_required_years": req_years,
        "expected_real_rate": round(exp_real * 100, 2),
        "inflation_rate": round(inflation_rate * 100, 2),
        "return_shock": round(return_shock * 100, 2),
        "time_delay": time_delay
    }
