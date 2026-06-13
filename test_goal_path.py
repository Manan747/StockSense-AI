import os
import sys
import unittest
import numpy as np

# Ensure app is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.goal_path import (
    calculate_fv,
    solve_required_months,
    project_goal,
    get_portfolio_recommendation,
    get_fallback_benchmark
)
from app.backtest_engine import run_backtest
from app.risk_engine import simulate_market_crash
from app.scoring_engine import calculate_confidence_score, get_decision_summary

class TestGoalPath(unittest.TestCase):

    def test_calculate_fv_zero_returns(self):
        # With 0% returns, FV is just sum of principal and SIP payments
        # Lump sum = 1000, SIP = 100, Months = 12
        fv = calculate_fv(lump_sum=1000.0, monthly_sip=100.0, rate=0.0, months=12.0)
        self.assertEqual(fv, 2200.0)

    def test_calculate_fv_compounding(self):
        # Lump sum = 10000, SIP = 0, Rate = 12% annual, Months = 12
        # Future value should compound monthly: 10000 * (1 + 0.01)^12 = 11268.25
        fv = calculate_fv(lump_sum=10000.0, monthly_sip=0.0, rate=0.12, months=12.0)
        self.assertAlmostEqual(fv, 11268.25, places=2)

        # SIP compounding: SIP = 1000, Lump sum = 0, Rate = 12%, Months = 3
        # Month 1 start: 1000 grows to 1010 at month 1 end.
        # Month 2 start: 2010 grows to 2030.1 at month 2 end.
        # Month 3 start: 3030.1 grows to 3060.401 at month 3 end.
        # Let's check with formula: 1000 * (((1.01)^3 - 1) / 0.01) * 1.01 = 1000 * 3.0301 * 1.01 = 3060.401
        fv_sip = calculate_fv(lump_sum=0.0, monthly_sip=1000.0, rate=0.12, months=3.0)
        self.assertAlmostEqual(fv_sip, 3060.401, places=3)

    def test_solve_required_months(self):
        # Target = 2200, Lump sum = 1000, SIP = 100, Rate = 0%
        # Time required = 12 months
        months = solve_required_months(target_amount=2200.0, lump_sum=1000.0, monthly_sip=100.0, annual_rate=0.0)
        self.assertEqual(months, 12)

        # Target = 11268.25, Lump sum = 10000, SIP = 0, Rate = 12%
        # Time required = 12 months
        months_comp = solve_required_months(target_amount=11268.25, lump_sum=10000.0, monthly_sip=0.0, annual_rate=0.12)
        self.assertEqual(months_comp, 12)

    def test_project_goal(self):
        # Target = 1000000, Horizon = 10, SIP = 5000, Lump sum = 50000, Risk = 'medium'
        res = project_goal(
            target_amount=1000000.0,
            time_horizon=10,
            monthly_sip=5000.0,
            lump_sum=50000.0,
            risk_tolerance="medium"
        )
        self.assertIn("projected_value", res)
        self.assertIn("gap", res)
        self.assertIn("status", res)
        self.assertIn("path", res)
        self.assertIn("sip_adjustment", res)
        self.assertIn("time_extension_years", res)
        
        # Checking path size (time_horizon + 1 items, from year 0 to 10)
        self.assertEqual(len(res["path"]), 11)
        self.assertEqual(res["path"][0]["year"], 0)
        self.assertEqual(res["path"][0]["expected"], 50000.0)

    def test_portfolio_recommendations(self):
        # Assert low risk allocations are high debt
        portfolio = get_portfolio_recommendation("low", [])
        self.assertEqual(portfolio["allocation"]["debt"], 70)
        self.assertEqual(portfolio["allocation"]["equity"], 20)
        self.assertEqual(len(portfolio["suggested_stocks"]), 4)

        # Assert high risk allocations are high equity
        portfolio_high = get_portfolio_recommendation("high", [])
        self.assertEqual(portfolio_high["allocation"]["equity"], 85)
        self.assertEqual(portfolio_high["allocation"]["debt"], 10)

    def test_fallback_benchmark(self):
        bench = get_fallback_benchmark()
        self.assertIn("chart_data", bench)
        self.assertEqual(len(bench["chart_data"]), 52)
        self.assertGreater(bench["ai_1y_return"], 0.0)
        self.assertGreater(bench["nifty_1y_return"], 0.0)

    def test_backtest_engine(self):
        # Test backtesting simulation
        bt = run_backtest(lump_sum=10000.0, monthly_sip=1000.0, risk_tolerance="medium", time_horizon=5)
        self.assertIn("user_portfolio", bt)
        self.assertIn("nifty_benchmark", bt)
        self.assertIn("comparison", bt)
        self.assertIn("chart_data", bt)
        self.assertEqual(bt["user_portfolio"]["total_invested"], 70000.0)
        self.assertGreater(len(bt["chart_data"]), 0)

    def test_risk_engine(self):
        # Test crash simulation
        risk = simulate_market_crash(
            target_amount=100000.0,
            time_horizon=10,
            monthly_sip=500.0,
            lump_sum=5000.0,
            risk_tolerance="high",
            crash_pct=0.30,
            crash_year=5
        )
        self.assertEqual(risk["crash_year"], 5)
        self.assertEqual(risk["crash_drawdown_pct"], 30.0)
        self.assertIn("impact_value", risk)
        self.assertGreater(risk["impact_pct"], 0.0)
        self.assertGreaterEqual(risk["recovery_years"], 0.0)

    def test_scoring_engine(self):
        # Projected matches or exceeds target -> high score
        score_high = calculate_confidence_score(
            target_amount=10000.0,
            projected_value=12000.0,
            risk_tolerance="low",
            time_horizon=10
        )
        self.assertGreaterEqual(score_high, 8.0)

        # Projected is behind target -> lower score
        score_low = calculate_confidence_score(
            target_amount=100000.0,
            projected_value=40000.0,
            risk_tolerance="high",
            time_horizon=3
        )
        self.assertLess(score_low, 5.0)

        summary = get_decision_summary(
            target_amount=100000.0,
            projected_value=40000.0,
            gap=60000.0,
            sip_adjustment=500.0,
            required_sip=1500.0,
            time_extension_years=3.5,
            confidence_score=4.2
        )
        self.assertEqual(summary["required_action"], "ACTION REQUIRED: Immediately increase monthly SIP by ₹500 (raising total to ₹1,500) OR extend timeline by 3.5 years to eliminate shortfall.")

if __name__ == "__main__":
    unittest.main()
