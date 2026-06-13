import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

def calculate_confidence_score(
    target_amount: float,
    projected_value: float,
    risk_tolerance: str,
    time_horizon: int
) -> float:
    """
    Calculates a deterministic non-AI confidence score (0 to 10) based on:
    1. Feasibility Ratio: expected final value vs target (0 to 6.0 points).
    2. Time Horizon Buffer: longer timelines absorb market volatility (0 to 2.5 points).
    3. Asset Allocation Risk suitability for the given timeline (0 to 1.5 points).
    """
    if target_amount <= 0:
        return 0.0

    ratio = projected_value / target_amount
    
    # 1. Feasibility Ratio points (max 6.0)
    if ratio >= 1.2:
        base_score = 6.0
    elif ratio >= 1.0:
        # Scale linearly between 5.0 and 6.0
        base_score = 5.0 + (ratio - 1.0) * 5.0
    else:
        # Scale linearly between 0.0 and 5.0
        base_score = max(0.0, ratio * 5.0)

    # 2. Time Horizon Buffer points (max 2.5)
    # Give full points for 20+ years, scale down for shorter periods
    horizon_score = min(2.5, (time_horizon / 20.0) * 2.5)

    # 3. Risk Profile Suitability points (max 1.5)
    # Low risk (capital preservation) has higher certainty (1.5)
    # Medium risk has good balance (1.0)
    # High risk is volatile:
    #   - If horizon is long (>= 15 years), high risk has high chance of outperforming (1.2)
    #   - If horizon is medium (7 to 14 years), give partial suitability (0.6)
    #   - If horizon is short (< 7 years), penalize high volatility exposure (0.0)
    risk_tolerance = risk_tolerance.lower()
    if risk_tolerance == "low":
        risk_score = 1.5
    elif risk_tolerance == "medium":
        risk_score = 1.0
    else:  # high
        if time_horizon >= 15:
            risk_score = 1.2
        elif time_horizon >= 7:
            risk_score = 0.6
        else:
            risk_score = 0.0

    score = base_score + horizon_score + risk_score
    return round(max(0.0, min(10.0, score)), 1)

def get_decision_summary(
    target_amount: float,
    projected_value: float,
    gap: float,
    sip_adjustment: float,
    required_sip: float,
    time_extension_years: float,
    confidence_score: float
) -> Dict[str, Any]:
    """
    Generates an actionable strategic summary card based on feasibility calculations.
    """
    if projected_value >= target_amount * 1.10:
        verdict = "OVERACHIEVING"
        action = "PLAN STABLE: Expected final value exceeds target by >10%. Maintain current contributions."
    elif projected_value >= target_amount:
        verdict = "ON TRACK"
        action = "PLAN STABLE: Expected final value meets target. Maintain current SIP and timeline."
    else:
        verdict = "AT RISK"
        # Formulate direct action to resolve the shortfall
        action = f"ACTION REQUIRED: Immediately increase monthly SIP by ₹{int(sip_adjustment):,} (raising total to ₹{int(required_sip):,}) OR extend timeline by {time_extension_years:.1f} years to eliminate shortfall."

    return {
        "verdict": verdict,
        "confidence_score": confidence_score,
        "required_action": action
    }
