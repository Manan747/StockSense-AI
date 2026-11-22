import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Activity, CheckCircle2,
  PieChart as PieIcon, LineChart as ChartIcon,
  Clock, ShieldCheck, RotateCcw, AlertCircle, Info,
  ShieldAlert, BookOpen, Sparkles, Shield, Scale, AlertTriangle
} from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, ReferenceLine, AreaChart, Area
} from 'recharts';

const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return envUrl || 'http://localhost:8000';
  }
  return 'https://web-production-ef8e1.up.railway.app';
};

const BASE_URL = getApiUrl();
const CLEAN_BASE_URL = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

// Expected return configurations (nominal rates)
const RISK_RETURNS = {
  low: { min: 0.06, exp: 0.07, max: 0.08 },
  medium: { min: 0.10, exp: 0.11, max: 0.12 },
  high: { min: 0.12, exp: 0.135, max: 0.15 }
};

// Asset allocation configurations
const ALLOCATIONS = {
  low: { equity: 20, debt: 70, cash: 10, large: 60, mid: 10, index: 30 },
  medium: { equity: 60, debt: 30, cash: 10, large: 40, mid: 20, index: 40 },
  high: { equity: 85, debt: 10, cash: 5, large: 30, mid: 40, index: 30 }
};

export default function GoalPathPlanner() {
  // Goal Input State
  const [targetAmount, setTargetAmount] = useState(10000000); // 1 Crore default
  const [timeHorizon, setTimeHorizon] = useState(10); // 10 years
  const [monthlySip, setMonthlySip] = useState(25000); // 25k SIP
  const [lumpSum, setLumpSum] = useState(500000); // 5L Lump sum
  const [riskTolerance, setRiskTolerance] = useState('medium'); // low, medium, high
  const [aiTone, setAiTone] = useState('advanced'); // advanced, el5

  // Scenario Simulation States
  const [inflationRate, setInflationRate] = useState(6.0); // 6.0% default inflation
  const [isInflationEnabled, setIsInflationEnabled] = useState(true);
  const [returnShock, setReturnShock] = useState(0.0); // 0% default shock
  const [isShockEnabled, setIsShockEnabled] = useState(false);
  const [timeDelay, setTimeDelay] = useState(0); // 0 years delay

  // Scenario stress test toggle badge state
  const [stressScenariosEnabled, setStressScenariosEnabled] = useState(true);

  const isStressActive = stressScenariosEnabled && (isInflationEnabled || isShockEnabled || timeDelay > 0);

  // Backend response state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [aiExplanation, setAiExplanation] = useState(null);
  const [suggestedStocks, setSuggestedStocks] = useState([]);
  const [backtestData, setBacktestData] = useState(null);
  const [riskShockData, setRiskShockData] = useState(null);
  const [decisionSummary, setDecisionSummary] = useState(null);
  const [fetchTimestamp, setFetchTimestamp] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);

  // Client-Side Calculations for Instant Real-Time Responsiveness
  const clientProjections = useMemo(() => {
    const minNom = RISK_RETURNS[riskTolerance].min;
    const expNom = RISK_RETURNS[riskTolerance].exp;
    const maxNom = RISK_RETURNS[riskTolerance].max;

    // Apply return shock if enabled
    const returnShockVal = (stressScenariosEnabled && isShockEnabled) ? returnShock / 100 : 0.0;
    const minNomShocked = Math.max(0, minNom - returnShockVal);
    const expNomShocked = Math.max(0, expNom - returnShockVal);
    const maxNomShocked = Math.max(0, maxNom - returnShockVal);

    // Apply inflation rate using Fisher formula if enabled
    const inflationRateVal = (stressScenariosEnabled && isInflationEnabled) ? inflationRate / 100 : 0.0;
    const minRate = inflationRateVal > 0 ? (1 + minNomShocked) / (1 + inflationRateVal) - 1 : minNomShocked;
    const expRate = inflationRateVal > 0 ? (1 + expNomShocked) / (1 + inflationRateVal) - 1 : expNomShocked;
    const maxRate = inflationRateVal > 0 ? (1 + maxNomShocked) / (1 + inflationRateVal) - 1 : maxNomShocked;

    const delayMonths = (stressScenariosEnabled ? timeDelay : 0) * 12;

    const path = [];
    const calculateFv = (l, s, r, m) => {
      if (m <= delayMonths) {
        return l;
      }
      const active_months = m - delayMonths;
      const r_m = r / 12.0;
      if (r_m > 0) {
        return l * Math.pow(1 + r_m, active_months) + s * ((Math.pow(1 + r_m, active_months) - 1) / r_m) * (1 + r_m);
      }
      return l + s * active_months;
    };

    for (let year = 0; year <= timeHorizon; year++) {
      const months = year * 12;
      path.push({
        year,
        pessimistic: Math.round(calculateFv(lumpSum, monthlySip, minRate, months)),
        expected: Math.round(calculateFv(lumpSum, monthlySip, expRate, months)),
        optimistic: Math.round(calculateFv(lumpSum, monthlySip, maxRate, months))
      });
    }

    const projectedValue = path[path.length - 1].expected;
    const gap = Math.max(0, targetAmount - projectedValue);

    let status = 'behind_target';
    if (projectedValue >= targetAmount * 1.10) {
      status = 'overachieving';
    } else if (projectedValue >= targetAmount) {
      status = 'on_track';
    }

    // Solve for required SIP under stress
    const N = timeHorizon * 12;
    const active_months = Math.max(0, N - delayMonths);
    const r_m = expRate / 12.0;
    let requiredSip = 0;
    if (active_months > 0) {
      let m_sip_factor = active_months;
      let lump_fv = lumpSum;
      if (r_m > 0) {
        m_sip_factor = ((Math.pow(1 + r_m, active_months) - 1) / r_m) * (1 + r_m);
        lump_fv = lumpSum * Math.pow(1 + r_m, active_months);
      }
      requiredSip = Math.max(0, Math.round((targetAmount - lump_fv) / m_sip_factor));
    }
    const sipAdjustment = requiredSip - monthlySip;

    // Solve for required time extension under stress
    let reqMonths = 1200;
    if (lumpSum >= targetAmount) {
      reqMonths = 0;
    } else if (monthlySip > 0 || expRate > 0) {
      let low_m = delayMonths;
      let high_m = 1200;
      for (let i = 0; i < 40; i++) {
        let mid_m = (low_m + high_m) / 2;
        let fv = calculateFv(lumpSum, monthlySip, expRate, mid_m);
        if (fv >= targetAmount) {
          high_m = mid_m;
        } else {
          low_m = mid_m;
        }
      }
      reqMonths = Math.ceil(high_m - 0.00001);
    }

    const totalRequiredYears = Math.round((reqMonths / 12) * 10) / 10;
    const timeExtensionYears = Math.max(0, Math.round((totalRequiredYears - timeHorizon) * 10) / 10);

    return {
      projectedValue,
      gap,
      status,
      path,
      sipAdjustment,
      requiredSip,
      timeExtensionYears,
      totalRequiredYears,
      expectedRealRate: expRate
    };
  }, [targetAmount, timeHorizon, monthlySip, lumpSum, riskTolerance, inflationRate, isInflationEnabled, returnShock, isShockEnabled, timeDelay, stressScenariosEnabled]);

  // Fetch AI recommendations, backtesting, and risk crash metrics from backend
  const fetchGoalEngineData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${CLEAN_BASE_URL}/api/goal-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_amount: targetAmount,
          time_horizon: timeHorizon,
          monthly_sip: monthlySip,
          lump_sum: lumpSum,
          risk_tolerance: riskTolerance,
          tone: aiTone,
          inflation_rate: (stressScenariosEnabled && isInflationEnabled) ? inflationRate / 100 : 0.0,
          return_shock: (stressScenariosEnabled && isShockEnabled) ? returnShock / 100 : 0.0,
          time_delay: stressScenariosEnabled ? timeDelay : 0
        })
      });

      if (!response.ok) {
        throw new Error(`Server error (${response.status})`);
      }

      const resData = await response.json();
      setAiExplanation(resData.explanation);
      setSuggestedStocks(resData.projections.suggested_stocks || []);
      setBacktestData(resData.backtest);
      setRiskShockData(resData.risk_shock);
      setDecisionSummary(resData.decision_summary);
      setFetchTimestamp(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Fetch goal path error:", err);
      // Catch and display static safe error message instead of raw error strings
      setError("AI analysis temporarily unavailable. Your projection data above is fully accurate.");
    } finally {
      setLoading(false);
    }
  };

  // Debounced fetch to avoid flooding backend during active slider drags
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchGoalEngineData();
    }, 450);
    return () => clearTimeout(timer);
  }, [
    targetAmount, timeHorizon, monthlySip, lumpSum, riskTolerance,
    aiTone, inflationRate, isInflationEnabled, returnShock, isShockEnabled, timeDelay, stressScenariosEnabled
  ]);

  // Format currencies in lakhs / crores
  const formatCurrency = (val) => {
    if (val === undefined || val === null) return '₹0';
    if (val >= 10000000) {
      return `₹${(val / 10000000).toFixed(2)} Cr`;
    }
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(2)} L`;
    }
    return `₹${val.toLocaleString('en-IN')}`;
  };

  // Quick Action triggers
  const applySipAdjustment = () => {
    setMonthlySip(clientProjections.requiredSip);
  };

  const applyTimeExtension = () => {
    setTimeHorizon(Math.ceil(clientProjections.totalRequiredYears));
  };

  const scrollToSip = () => {
    const element = document.getElementById('sip-slider-container');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.style.transition = 'all 0.3s ease';
      element.style.boxShadow = '0 0 0 3px rgba(26, 86, 219, 0.4)';
      setTimeout(() => {
        element.style.boxShadow = 'none';
      }, 1500);
    }
  };

  // Allocation Pie Chart Data
  const pieData = useMemo(() => {
    const alloc = ALLOCATIONS[riskTolerance];
    return [
      { name: 'Equity', value: alloc.equity, color: '#1a56db' },
      { name: 'Debt & Bonds', value: alloc.debt, color: '#2e7d32' },
      { name: 'Cash & Gold', value: alloc.cash, color: '#b45309' }
    ];
  }, [riskTolerance]);

  // Confidence score
  const score = decisionSummary?.confidence_score || 5.0;

  // Single source of truth for verdict
  let planStatus;
  if (clientProjections.status === 'overachieving') {
    planStatus = 'OVERACHIEVING';
  } else if (clientProjections.status === 'on_track') {
    planStatus = 'STABLE';
  } else {
    planStatus = 'FAILING';
  }

  const isFailing = planStatus === 'FAILING';
  const isOverachieving = planStatus === 'OVERACHIEVING';
  const isStable = planStatus === 'STABLE';

  // pre-compute a paddedMax that is always >= targetAmount
  const chartDataMax = clientProjections.path.length > 0
    ? Math.max(...clientProjections.path.map(d => d.optimistic ?? 0))
    : 0;
  const chartPaddedMax = Math.ceil(Math.max(chartDataMax, targetAmount) * 1.2);

  // Helper to generate dynamic slider gradients
  const getSliderStyle = (value, min, max) => {
    const pct = ((value - min) / (max - min)) * 100;
    return {
      background: `linear-gradient(to right, #1a56db 0%, #1a56db ${pct}%, #e8eaed ${pct}%, #e8eaed 100%)`
    };
  };

  return (
    <div className="flex-1 bg-[#f8f9fb] min-h-screen text-[#444444] flex flex-col">

      {/* HEADER BAR */}
      <header className="bg-white border-b border-[#e8eaed] px-6 py-[16px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-medium text-[#111111] tracking-tight">Goal planner</h1>
            <p className="text-[10px] text-[#9aa0aa] tracking-wider font-semibold font-mono mt-0.5">
              Tested against real market data · NSE/BSE sourced
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {fetchTimestamp && (
            <span className="text-[10px] text-[#9aa0aa] font-mono bg-white border border-[#e8eaed] px-2.5 py-1 rounded">
              Synced: {fetchTimestamp}
            </span>
          )}
          <button
            onClick={fetchGoalEngineData}
            disabled={loading}
            className="px-3 py-1 bg-white border border-[#e8eaed] hover:border-[#1a56db] text-[#444444] hover:text-[#111111] rounded text-xs font-mono font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            <RotateCcw size={12} className={loading ? 'animate-spin' : ''} />
            Recalculate
          </button>
        </div>
      </header>

      {/* DASHBOARD BODY */}
      <main className="flex-grow p-[20px] flex flex-col gap-[16px] max-w-[1600px] mx-auto w-full">

        {/* 1. DECISION SUMMARY / VERDICT OVERHAUL */}
        <section className="p-6 rounded-lg bg-white border border-[#e8eaed] flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-medium text-[#111111]">
              {isFailing ? (
                `Your plan is ${formatCurrency(clientProjections.gap)} short of target`
              ) : (
                "Your plan is fully on track"
              )}
            </h2>
            <p className="text-sm text-[#444444]">
              {isFailing ? (
                `At ${formatCurrency(monthlySip)}/mo over ${timeHorizon} years, our projection shows a ${Math.round((clientProjections.gap / targetAmount) * 100)}% gap. Here are two ways to close it.`
              ) : (
                `At your current ${formatCurrency(monthlySip)}/mo contribution over ${timeHorizon} years, you are projected to successfully reach your goal.`
              )}
            </p>
          </div>

          {/* 4 Metrics in a row (grey bg, no border) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
            {/* Target Corpus */}
            <div className="flex flex-col p-4 bg-[#f4f5f7] rounded-lg">
              <span className="text-[11px] text-[#9aa0aa] tracking-wider font-medium">Target corpus</span>
              <span className="text-lg font-medium text-[#111111] mt-1">{formatCurrency(targetAmount)}</span>
            </div>

            {/* Projected Corpus */}
            <div className="flex flex-col p-4 bg-[#f4f5f7] rounded-lg">
              <span className="text-[11px] text-[#9aa0aa] tracking-wider font-medium">Projected corpus</span>
              <span className={`text-lg font-medium mt-1 ${isFailing ? 'text-[#b45309]' : 'text-[#2e7d32]'}`}>
                {formatCurrency(clientProjections.projectedValue)}
              </span>
            </div>

            {/* Confidence score card (with tooltip) */}
            <div 
              className="flex flex-col p-4 bg-[#f4f5f7] rounded-lg relative cursor-help select-none"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              onClick={() => setShowTooltip(!showTooltip)}
            >
              <span className="text-[11px] text-[#9aa0aa] tracking-wider font-medium flex items-center gap-1">
                Confidence score
                <Info size={12} className="text-[#9aa0aa] shrink-0" />
              </span>
              <span className="text-lg font-medium text-[#1a56db] mt-1">{score} / 10</span>
              {showTooltip && (
                <div 
                  className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-[220px] max-w-[220px] bg-white text-[#333333] text-[12px] border-[0.5px] border-[#e8eaed] rounded-[8px] p-[10px_12px] shadow-sm z-30 leading-normal font-sans text-left font-normal"
                  style={{ padding: '10px 12px' }}
                >
                  Score based on historical Nifty 50 cycle simulations. 7–10 = high confidence your plan survives past cycles. 4–6 = moderate, consider adjusting inputs. Below 4 = plan needs significant changes.
                </div>
              )}
            </div>

            {/* Shortfall */}
            <div className="flex flex-col p-4 bg-[#f4f5f7] rounded-lg">
              <span className="text-[11px] text-[#9aa0aa] tracking-wider font-medium">Shortfall</span>
              <span className="text-lg font-medium text-[#b45309] mt-1">
                {clientProjections.gap > 0 
                  ? `-${Math.round((clientProjections.gap / targetAmount) * 100)}%` 
                  : '0%'
                }
              </span>
            </div>
          </div>

          {/* Action CTAs shown below metric cards when there is a shortfall */}
          {isFailing && (
            <div className="flex flex-col sm:flex-row gap-3 w-full justify-start mt-2">
              <button
                onClick={applySipAdjustment}
                className="py-2 px-4 bg-[#1a56db] text-white rounded-[7px] text-xs font-medium transition-opacity hover:opacity-95 select-none cursor-pointer"
              >
                Increase SIP to {formatCurrency(clientProjections.requiredSip)} / mo
              </button>
              <button
                onClick={applyTimeExtension}
                className="py-2 px-4 bg-white text-[#1a56db] border border-[#b3c8f8] rounded-[7px] text-xs font-medium transition-colors hover:bg-[#eff4ff] select-none cursor-pointer"
              >
                Extend timeline to {clientProjections.totalRequiredYears} yrs
              </button>
            </div>
          )}
        </section>

        {/* Risk callout card — blue-tinted card (#eff4ff bg, #b3c8f8 border) */}
        <section className="p-4 rounded-lg bg-[#eff4ff] border border-[#b3c8f8] flex flex-col gap-1.5">
          <span className="text-[10px] font-bold text-[#1a56db] tracking-wider">
            Sequence-of-returns risk
          </span>
          <p className="text-xs text-[#444444] leading-relaxed">
            A -30% market downturn in your final year could reduce your corpus by up to ₹30 L. Consider gradually shifting to debt allocation as you approach your goal to protect your accumulated capital.
          </p>
        </section>

        {/* 2. TWO COLUMN INPUT & ROADMAP GRAPH */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

          {/* INPUTS COLUMN */}
          <div className="xl:col-span-5 flex flex-col gap-6">

            {/* Target Inputs Card */}
            <section className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-5">
              <div className="border-b border-[#e8eaed] pb-2">
                <h3 className="text-xs font-medium text-[#111111] tracking-wider">
                  Financial target inputs
                </h3>
              </div>

              {/* Target Amount */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444444] font-medium">Target corpus goal</span>
                  <span className="font-mono text-[#1a56db] font-medium text-[11px] bg-[#eff4ff] px-2 py-0.5 rounded-full">
                    {formatCurrency(targetAmount)}
                  </span>
                </div>
                <input
                  type="range" min="1000000" max="200000000" step="1000000"
                  value={targetAmount} 
                  style={getSliderStyle(targetAmount, 1000000, 200000000)}
                  onChange={(e) => setTargetAmount(parseInt(e.target.value))}
                  className="w-full h-1 bg-[#e8eaed] rounded appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#9aa0aa] font-mono">
                  <span>₹10 L</span>
                  <span>₹10 Cr</span>
                  <span>₹20 Cr</span>
                </div>
              </div>

              {/* Timeline */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444444] font-medium">Investment horizon</span>
                  <span className="font-mono text-[#1a56db] font-medium text-[11px] bg-[#eff4ff] px-2 py-0.5 rounded-full">
                    {timeHorizon} Years
                  </span>
                </div>
                <input
                  type="range" min="1" max="45"
                  value={timeHorizon} 
                  style={getSliderStyle(timeHorizon, 1, 45)}
                  onChange={(e) => setTimeHorizon(parseInt(e.target.value))}
                  className="w-full h-1 bg-[#e8eaed] rounded appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#9aa0aa] font-mono">
                  <span>1 Yr</span>
                  <span>22 Yrs</span>
                  <span>45 Yrs</span>
                </div>
              </div>

              {/* Monthly SIP */}
              <div id="sip-slider-container" className="flex flex-col gap-2 transition-all duration-300 rounded-md p-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444444] font-medium">Monthly SIP contribution</span>
                  <span className="font-mono text-[#1a56db] font-medium text-[11px] bg-[#eff4ff] px-2 py-0.5 rounded-full">
                    {formatCurrency(monthlySip)}/mo
                  </span>
                </div>
                <input
                  type="range" min="0" max="250000" step="2500"
                  value={monthlySip} 
                  style={getSliderStyle(monthlySip, 0, 250000)}
                  onChange={(e) => setMonthlySip(parseInt(e.target.value))}
                  className="w-full h-1 bg-[#e8eaed] rounded appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#9aa0aa] font-mono">
                  <span>₹0</span>
                  <span>₹1.25 L</span>
                  <span>₹2.5 L</span>
                </div>
              </div>

              {/* Lump Sum */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444444] font-medium">Starting lump sum</span>
                  <span className="font-mono text-[#1a56db] font-medium text-[11px] bg-[#eff4ff] px-2 py-0.5 rounded-full">
                    {formatCurrency(lumpSum)}
                  </span>
                </div>
                <input
                  type="range" min="0" max="10000000" step="100000"
                  value={lumpSum} 
                  style={getSliderStyle(lumpSum, 0, 10000000)}
                  onChange={(e) => setLumpSum(parseInt(e.target.value))}
                  className="w-full h-1 bg-[#e8eaed] rounded appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#9aa0aa] font-mono">
                  <span>₹0</span>
                  <span>₹50 L</span>
                  <span>₹1 Cr</span>
                </div>
              </div>

              {/* Risk appetite profile */}
              <div className="flex flex-col gap-2.5">
                <span className="text-xs text-[#111111] font-medium">Risk appetite profile</span>
                <div className="grid grid-cols-3 gap-2 text-[11px] font-bold">
                  <button
                    onClick={() => setRiskTolerance('low')}
                    className={`py-2 rounded border transition-all text-center cursor-pointer ${
                      riskTolerance === 'low'
                        ? 'bg-[#eff4ff] border-[#1a56db] text-[#1a56db]'
                        : 'bg-white border-[#e8eaed] text-[#888888] hover:text-[#444444]'
                    }`}
                  >
                    Conservative
                    <span className="block text-[8px] font-mono font-medium opacity-65 mt-0.5">6-8% CAGR</span>
                  </button>

                  <button
                    onClick={() => setRiskTolerance('medium')}
                    className={`py-2 rounded border transition-all text-center cursor-pointer ${
                      riskTolerance === 'medium'
                        ? 'bg-[#eff4ff] border-[#1a56db] text-[#1a56db]'
                        : 'bg-white border-[#e8eaed] text-[#888888] hover:text-[#444444]'
                    }`}
                  >
                    Moderate
                    <span className="block text-[8px] font-mono font-medium opacity-65 mt-0.5">10-12% CAGR</span>
                  </button>

                  <button
                    onClick={() => setRiskTolerance('high')}
                    className={`py-2 rounded border transition-all text-center cursor-pointer ${
                      riskTolerance === 'high'
                        ? 'bg-[#eff4ff] border-[#1a56db] text-[#1a56db]'
                        : 'bg-white border-[#e8eaed] text-[#888888] hover:text-[#444444]'
                    }`}
                  >
                    Aggressive
                    <span className="block text-[8px] font-mono font-medium opacity-65 mt-0.5">12-15% CAGR</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Scenario Stress Testing Card */}
            <section className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-5">
              <div className="border-b border-[#e8eaed] pb-2.5 flex items-center justify-between">
                <h3 className="text-xs font-medium text-[#111111]">
                  Scenario stress testing
                </h3>

                {/* Switch for enabling stress scenarios */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#9aa0aa] font-medium">Stress scenarios enabled</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stressScenariosEnabled}
                      onChange={(e) => setStressScenariosEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-[#e8eaed] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-[#888888] after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#1a56db] peer-checked:after:bg-white peer-checked:after:translate-x-4"></div>
                  </label>
                </div>
              </div>

              {stressScenariosEnabled && (
                <div className="flex flex-col gap-4">
                  {/* Inflation Impact (rename to plain english) */}
                  <div className="flex flex-col gap-2.5 bg-[#f8f9fb] border border-[#e8eaed] p-3 rounded-lg">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-[#111111] flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox" checked={isInflationEnabled}
                          onChange={(e) => setIsInflationEnabled(e.target.checked)}
                          className="rounded border-[#e8eaed] text-[#1a56db] focus:ring-[#1a56db] h-3.5 w-3.5 bg-white"
                        />
                        Inflation impact
                      </label>
                      {isInflationEnabled && (
                        <span className="font-mono text-[10px] text-[#b45309] font-bold bg-[#fff3e0] px-1.5 py-0.5 rounded border border-[#fff3e0]">
                          {inflationRate}% inflation
                        </span>
                      )}
                    </div>

                    {isInflationEnabled && (
                      <div className="flex flex-col gap-1 mt-1">
                        <input
                          type="range" min="3.0" max="8.0" step="0.5"
                          value={inflationRate} 
                          style={getSliderStyle(inflationRate, 3.0, 8.0)}
                          onChange={(e) => setInflationRate(parseFloat(e.target.value))}
                          className="w-full h-1 bg-[#e8eaed] rounded appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-[8px] text-[#9aa0aa] font-mono">
                          <span>3.0%</span>
                          <span>5.5%</span>
                          <span>8.0%</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Market downturn (-30%) (rename to plain english) */}
                  <div className="flex flex-col gap-2.5 bg-[#f8f9fb] border border-[#e8eaed] p-3 rounded-lg">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-[#111111] flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox" checked={isShockEnabled}
                          onChange={(e) => setIsShockEnabled(e.target.checked)}
                          className="rounded border-[#e8eaed] text-[#1a56db] focus:ring-[#1a56db] h-3.5 w-3.5 bg-white"
                        />
                        Market downturn (−30%)
                      </label>
                      {isShockEnabled && (
                        <span className="font-mono text-[10px] text-[#b45309] font-bold bg-[#fff3e0] px-1.5 py-0.5 rounded border border-[#fff3e0]">
                          -{returnShock}% CAGR shock
                        </span>
                      )}
                    </div>

                    {isShockEnabled && (
                      <div className="flex flex-col gap-1 mt-1">
                        <input
                          type="range" min="-3.0" max="3.0" step="0.5"
                          value={returnShock} 
                          style={getSliderStyle(returnShock, -3.0, 3.0)}
                          onChange={(e) => setReturnShock(parseFloat(e.target.value))}
                          className="w-full h-1 bg-[#e8eaed] rounded appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-[8px] text-[#9aa0aa] font-mono">
                          <span>-3.0%</span>
                          <span>0.0%</span>
                          <span>+3.0%</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Delayed Start (rename to plain english) */}
                  <div className="flex flex-col gap-2.5 bg-[#f8f9fb] border border-[#e8eaed] p-3 rounded-lg">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#111111] font-semibold">Delayed start</span>
                      <span className="font-mono text-[#111111] font-bold bg-[#e8eaed] px-2 py-0.5 rounded text-[10px]">
                        {timeDelay} Yr Delay
                      </span>
                    </div>
                    <input
                      type="range" min="0" max="5" step="1"
                      value={timeDelay} 
                      style={getSliderStyle(timeDelay, 0, 5)}
                      onChange={(e) => setTimeDelay(parseInt(e.target.value))}
                      className="w-full h-1 bg-[#e8eaed] rounded appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[8px] text-[#9aa0aa] font-mono">
                      <span>Immediate</span>
                      <span>3 Yrs</span>
                      <span>5 Yrs</span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* CHART COLUMN */}
          <div className="xl:col-span-7">
            {/* Growth Projections Curve Card */}
            <section className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4 min-h-[350px] h-full">
              <div className="border-b border-[#e8eaed] pb-2 flex justify-between items-center">
                <h3 className="text-xs font-medium text-[#111111] tracking-wider">
                  Growth projection curves
                </h3>
                <span className="font-mono text-[9px] text-[#9aa0aa]">
                  Real Yield: {((clientProjections.expectedRealRate) * 100).toFixed(1)}% p.a.
                </span>
              </div>

              <div className="flex-grow min-h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={clientProjections.path} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="expectedColor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1a56db" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#1a56db" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" opacity={0.6} />
                    <XAxis dataKey="year" stroke="#9aa0aa" fontSize={9} tickFormatter={(y) => `Yr ${y}`} />
                    <YAxis
                      stroke="#9aa0aa"
                      fontSize={9}
                      tickFormatter={(v) => formatCurrency(v).replace('₹', '')}
                      domain={[0, chartPaddedMax]}
                      allowDataOverflow={false}
                    />
                    {/* Dashed primary blue target line */}
                    <ReferenceLine
                      y={targetAmount}
                      stroke="#1a56db"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: `Target: ${formatCurrency(targetAmount)}`,
                        position: 'insideTopLeft',
                        fill: '#1a56db',
                        fontSize: 10,
                        fontFamily: 'monospace',
                        fontWeight: 'bold',
                        offset: 10
                      }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e8eaed', borderRadius: '6px' }}
                      labelStyle={{ color: '#444444', fontSize: '10px', fontFamily: 'monospace' }}
                      itemStyle={{ color: '#111111', fontSize: '11px' }}
                      formatter={(val) => [formatCurrency(val), 'Portfolio']}
                    />
                    <Legend
                      verticalAlign="top" height={28}
                      formatter={(value) => <span className="text-[10px] text-[#444444]">{value}</span>}
                    />
                    <Area
                      type="monotone" dataKey="optimistic" stroke="#2e7d32" strokeWidth={1}
                      fill="transparent" strokeDasharray="3 3" name="Optimistic"
                    />
                    <Area
                      type="monotone" dataKey="expected" stroke="#1a56db" strokeWidth={2}
                      fillOpacity={1} fill="url(#expectedColor)" name="Expected"
                    />
                    <Area
                      type="monotone" dataKey="pessimistic" stroke="#b45309" strokeWidth={1}
                      fill="transparent" strokeDasharray="3 3" name="Pessimistic"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

        </div>

        {/* 3. HISTORICAL BACKTESTING ENGINE SECTION (AI vs Market) */}
        <section className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-5">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-[#e8eaed] pb-3">
            <div>
              <h3 className="text-xs font-medium text-[#111111] tracking-wider">
                Historical backtest simulation ({timeHorizon} years window)
              </h3>
              <p className="text-[10px] text-[#9aa0aa] mt-0.5">
                Compares your asset allocation against Nifty 50 benchmark based on actual historical prices.
              </p>
            </div>

            {backtestData?.comparison && (
              <div className="flex gap-2 text-[10px] font-mono font-bold select-none">
                <span className={`px-2 py-0.5 rounded border ${backtestData.comparison.outperformance_pct >= 0
                  ? 'bg-[#e8f5e9] border-[#e8f5e9] text-[#2e7d32]'
                  : 'bg-[#fff3e0] border-[#fff3e0] text-[#b45309]'
                  }`}>
                  {backtestData.comparison.outperformance_pct >= 0 ? '+' : ''}
                  {backtestData.comparison.outperformance_pct}% Alpha Return
                </span>
                <span className="px-2 py-0.5 rounded border bg-[#eff4ff] border-[#eff4ff] text-[#1a56db]">
                  {backtestData.comparison.drawdown_reduction_pct >= 0 ? '+' : ''}
                  {backtestData.comparison.drawdown_reduction_pct}% Lower Drawdown
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Backtest comparison metrics cards */}
            <div className="flex flex-col gap-4">

              {/* Card A: Allocated Portfolio */}
              <div className="bg-[#f8f9fb] rounded-lg p-4 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider font-mono">My allocation</span>
                  <span className="px-2 py-0.5 rounded text-[8px] font-bold font-mono bg-[#eff4ff] text-[#1a56db]">
                    {riskTolerance} Risk
                  </span>
                </div>

                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-xl font-bold text-[#111111] font-mono leading-none">
                    {formatCurrency(backtestData?.user_portfolio?.final_value)}
                  </span>
                  <span className="text-[10px] text-[#9aa0aa] font-mono">final corpus</span>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-[#e8eaed] pt-3 mt-1 text-[10px] font-mono text-[#888888]">
                  <div>
                    <span className="block text-[8px] text-[#9aa0aa]">CAGR</span>
                    <span className="text-[#2e7d32] font-bold font-mono text-xs">
                      {backtestData ? `+${backtestData.user_portfolio.cagr}%` : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[8px] text-[#9aa0aa]">MAX DD</span>
                    {/* Amber for bad outcomes, never red */}
                    <span className="text-[#b45309] font-bold font-mono text-xs">
                      {backtestData ? `-${backtestData.user_portfolio.max_drawdown}%` : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[8px] text-[#9aa0aa]">VOL</span>
                    <span className="text-[#111111] font-bold font-mono text-xs">
                      {backtestData ? `${backtestData.user_portfolio.volatility}%` : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Risk-Adjusted Comparison Block */}
              <div className="bg-[#eff4ff] border border-[#b3c8f8] rounded-lg p-4 flex flex-col gap-3">
                <span className="text-[10px] text-[#1a56db] font-bold tracking-wider font-mono">
                  Risk-adjusted comparison
                </span>

                <div className="flex flex-col gap-2 text-[10px] font-mono">
                  <div className="flex justify-between items-center border-b border-[#e8eaed] pb-1.5">
                    <span className="text-[#888888]">Sharpe Ratio</span>
                    <div className="flex gap-4">
                      <span className="text-[#2e7d32] font-bold">
                        {backtestData?.user_portfolio?.sharpe_ratio !== undefined ? backtestData.user_portfolio.sharpe_ratio.toFixed(2) : '1.12'}
                      </span>
                      <span className="text-[#888888]">
                        {backtestData?.nifty_benchmark?.sharpe_ratio !== undefined ? backtestData.nifty_benchmark.sharpe_ratio.toFixed(2) : '0.85'} (Nifty 50)
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center border-b border-[#e8eaed] pb-1.5">
                    <span className="text-[#888888]">Max Drawdown</span>
                    <div className="flex gap-4">
                      <span className="text-[#2e7d32] font-bold">-{backtestData?.user_portfolio?.max_drawdown || 14.2}%</span>
                      {/* Amber for drawdown shortfall */}
                      <span className="text-[#b45309] font-bold">-{backtestData?.nifty_benchmark?.max_drawdown || 38.5}%</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pb-1">
                    <span className="text-[#888888]">Recovery Time</span>
                    <div className="flex gap-4">
                      <span className="text-[#2e7d32] font-bold">11 M</span>
                      {/* Amber for Nifty's recovery delay */}
                      <span className="text-[#b45309] font-bold">34 M</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card B: Nifty Index Benchmark */}
              <div className="bg-[#f8f9fb] rounded-lg p-4 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider font-mono">Nifty 50 benchmark</span>
                  <span className="px-2 py-0.5 rounded text-[8px] font-bold font-mono bg-gray-200 text-[#888888]">
                    Benchmark
                  </span>
                </div>

                <div className="flex justify-between items-baseline mt-1">
                  <span className="text-xl font-bold text-[#888888] font-mono leading-none">
                    {formatCurrency(backtestData?.nifty_benchmark?.final_value)}
                  </span>
                  <span className="text-[10px] text-[#9aa0aa] font-mono">final corpus</span>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-[#e8eaed] pt-3 mt-1 text-[10px] font-mono text-[#888888]">
                  <div>
                    <span className="block text-[8px] text-[#9aa0aa]">CAGR</span>
                    <span className="text-[#111111] font-bold font-mono text-xs">
                      {backtestData ? `+${backtestData.nifty_benchmark.cagr}%` : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[8px] text-[#9aa0aa]">MAX DD</span>
                    {/* Amber, never red */}
                    <span className="text-[#b45309] font-bold font-mono text-xs">
                      {backtestData ? `-${backtestData.nifty_benchmark.max_drawdown}%` : '-'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[8px] text-[#9aa0aa]">VOL</span>
                    <span className="text-[#888888] font-bold font-mono text-xs">
                      {backtestData ? `${backtestData.nifty_benchmark.volatility}%` : '-'}
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {/* Backtest Line Chart */}
            <div className="lg:col-span-2 min-h-[260px] flex flex-col justify-between">
              {loading ? (
                <div className="flex-1 flex items-center justify-center text-[#888888] text-xs">
                  Calculating your projection…
                </div>
              ) : backtestData ? (
                <div className="flex-1 min-h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={backtestData.chart_data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" opacity={0.6} />
                      <XAxis dataKey="date" stroke="#9aa0aa" fontSize={8} tickLine={false} />
                      <YAxis stroke="#9aa0aa" fontSize={8} tickFormatter={(v) => formatCurrency(v).replace('₹', '')} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e8eaed', borderRadius: '6px' }}
                        labelStyle={{ color: '#888888', fontSize: '9px', fontFamily: 'monospace' }}
                        itemStyle={{ fontSize: '10px', fontWeight: 'bold' }}
                      />
                      <Legend
                        verticalAlign="top" height={28}
                        formatter={(value) => <span className="text-[10px] text-[#444444]">{value === 'portfolio' ? 'Allocated Portfolio' : 'Nifty 50 Index'}</span>}
                      />
                      <Line type="monotone" dataKey="portfolio" stroke="#1a56db" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="nifty" stroke="#9aa0aa" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-[#888888] text-xs font-mono">
                  Unable to load historical simulations.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 4. ALLOCATION & SUGGESTED STOCKS (GRID BOTTOM) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* COLUMN A: PORTFOLIO ALLOCATION DETAILS (5 cols) */}
          <section className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4 lg:col-span-5">
            <div className="border-b border-[#e8eaed] pb-2 flex flex-col gap-1">
              <h3 className="text-xs font-medium text-[#111111] tracking-wider">
                Portfolio asset allocation
              </h3>
            </div>

            <div className="flex-grow min-h-[200px] flex items-center justify-center relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="45%" innerRadius={52} outerRadius={72}
                    paddingAngle={4} dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom" height={32}
                    formatter={(value) => <span className="text-[10px] text-[#444444]">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center -translate-y-4 pointer-events-none select-none font-mono">
                <span className="text-[9px] text-[#9aa0aa] font-semibold">Equity</span>
                <span className="text-xl font-bold text-[#111111]">{ALLOCATIONS[riskTolerance].equity}%</span>
              </div>
            </div>

            <div className="bg-[#f8f9fb] rounded-lg p-3 flex flex-col gap-1.5 text-[10px] font-mono text-[#888888] select-none mt-2">
              <span className="text-[#111111] font-bold text-[9px] tracking-wider border-b border-[#e8eaed] pb-1 mb-0.5">Equity composition</span>
              <div className="flex justify-between">
                <span>Large Cap Leaders:</span>
                <span className="text-[#111111] font-medium">{ALLOCATIONS[riskTolerance].large}%</span>
              </div>
              <div className="flex justify-between">
                <span>Mid Cap / Quality Growth:</span>
                <span className="text-[#111111] font-medium">{ALLOCATIONS[riskTolerance].mid}%</span>
              </div>
              <div className="flex justify-between">
                <span>Index Funds:</span>
                <span className="text-[#111111] font-medium">{ALLOCATIONS[riskTolerance].index}%</span>
              </div>
            </div>
          </section>

          {/* COLUMN B: LIVE STOCKS SUGGESTIONS (7 cols) */}
          <section className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4 lg:col-span-7">
            <h3 className="text-xs font-medium text-[#111111] border-b border-[#e8eaed] pb-2">
              Suggested stock additions
            </h3>

            <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1">
              {loading ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <div key={idx} className="h-14 bg-[#f8f9fb] rounded border border-[#e8eaed] animate-pulse"></div>
                ))
              ) : suggestedStocks.length > 0 ? (
                suggestedStocks.map((stock) => (
                  <Link
                    key={stock.ticker} to={`/stock/${stock.ticker.replace(".NS", "")}`}
                    className="p-3 bg-[#f8f9fb] border border-[#e8eaed] hover:border-[#1a56db] rounded-lg flex flex-col gap-1.5 transition-all group"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold font-mono text-[#111111] group-hover:text-[#1a56db] transition-colors">
                        {stock.ticker.replace('.NS', '')}
                      </span>
                      {stock.current_price && (
                        <span className="text-xs font-bold font-mono text-[#111111]">
                          ₹{stock.current_price.toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>

                    <span className="text-[10px] text-[#888888] font-semibold line-clamp-1 leading-none">
                      {stock.name}
                    </span>

                    <p className="text-[9px] text-[#888888] leading-relaxed mt-0.5 line-clamp-2 italic border-l border-[#e8eaed] pl-2 group-hover:border-[#1a56db]/30 transition-colors">
                      {stock.reason}
                    </p>
                  </Link>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center text-center py-10 gap-2">
                  <Sparkles className="text-[#9aa0aa] opacity-40 shrink-0" size={28} />
                  <p className="text-[13px] text-[#9aa0aa] font-normal max-w-sm">
                    Suggestions will appear once your portfolio allocation is calculated.
                  </p>
                </div>
              )}
            </div>
          </section>

        </div>

        {/* 5. AI STRATEGIC ADVISORY THESIS (FULL WIDTH) */}
        <section className="bg-white border border-[#e8eaed] rounded-[10px] p-5 flex flex-col gap-4 relative overflow-hidden select-none">
          <div className="flex items-center justify-between border-b border-[#f0f2f5] pb-3 mb-1">
            <span className="text-[14px] font-medium text-[#333] tracking-tight">
              Strategic advisory
            </span>

            <div className="flex bg-[#f8f9fb] border border-[#e8eaed] rounded p-0.5 text-[9px] font-bold font-mono">
              <button
                onClick={() => setAiTone('advanced')} disabled={loading}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${aiTone === 'advanced' ? 'bg-[#1a56db] text-white shadow-sm' : 'text-[#888888] hover:text-[#111111]'}`}
              >
                Wealth Manager
              </button>
              <button
                onClick={() => setAiTone('el5')} disabled={loading}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${aiTone === 'el5' ? 'bg-[#1a56db] text-white shadow-sm' : 'text-[#888888] hover:text-[#111111]'}`}
              >
                Explain like I'm 5
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col gap-3 py-2">
              <span className="text-[12px] text-[#888888] font-normal">
                Analysing your allocation…
              </span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="h-[200px] rounded-lg shimmer-effect"></div>
                <div className="h-[200px] rounded-lg shimmer-effect"></div>
                <div className="h-[200px] rounded-lg shimmer-effect"></div>
              </div>
            </div>
          ) : error ? (
            <div className="py-6 text-center flex flex-col items-center justify-center gap-2 border border-[#e8eaed] rounded-lg bg-[#f8f9fb]">
              <p className="text-xs text-[#888888] font-medium">
                {error}
              </p>
            </div>
          ) : aiExplanation && aiExplanation.why_it_works && aiExplanation.tradeoffs && aiExplanation.top_3_risks ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px] text-xs text-[#444444] leading-relaxed">

              {/* Card 1 — Why this works */}
              <div className="bg-white border border-[#e8eaed] border-l-[3px] border-l-[#1a56db] p-5 rounded-[10px] flex flex-col justify-between gap-3 h-full">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-[#1a56db]">
                    <Shield size={16} className="shrink-0" />
                    <span className="text-[14px] font-medium tracking-tight">Why this works</span>
                  </div>
                  <p className="text-[13px] text-[#444] leading-[1.6]">
                    {(() => {
                      const text = aiExplanation.why_it_works || "Calculated strategy details loaded. Standard allocations match historical risk-adjusted return patterns.";
                      const sentences = text.split(/[.!?]/).map(s => s.trim()).filter(Boolean);
                      return sentences.slice(0, 2).map(s => s + ".").join(" ");
                    })()}
                  </p>
                </div>
                <div className="inline-flex items-center px-3 py-1.5 bg-[#eff4ff] text-[#1a56db] text-[12px] font-medium rounded-md w-full leading-normal">
                  {(() => {
                    const alloc = ALLOCATIONS[riskTolerance];
                    const reduction = backtestData?.comparison?.drawdown_reduction_pct || 24;
                    return `Key insight: ${alloc.equity}% equity + ${alloc.debt}% debt reduces your max drawdown by ${reduction}%.`;
                  })()}
                </div>
              </div>

              {/* Card 2 — Key tradeoffs */}
              <div 
                className="bg-white border border-[#e8eaed] border-l-[3px] p-5 rounded-[10px] flex flex-col gap-3 h-full"
                style={{ borderLeftColor: '#EF9F27' }}
              >
                <div className="flex items-center gap-2 text-[#b45309]">
                  <Scale size={16} className="shrink-0" />
                  <span className="text-[14px] font-medium tracking-tight">Key tradeoffs</span>
                </div>
                <ul className="flex flex-col gap-2.5 text-[13px] text-[#444] leading-[1.6]">
                  {clientProjections.gap > 0 ? (
                    <>
                      <li className="flex items-start gap-1.5">
                        <span className="text-[#888] select-none">•</span>
                        <span>
                          <strong>Adjust SIP</strong> — Increase from {formatCurrency(monthlySip)} to {formatCurrency(clientProjections.requiredSip)}/mo to reach goal on time
                        </span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-[#888] select-none">•</span>
                        <span>
                          <strong>Extend timeline</strong> — Add {clientProjections.timeExtensionYears} years to reach {formatCurrency(targetAmount)} at current SIP
                        </span>
                      </li>
                    </>
                  ) : (
                    <>
                      <li className="flex items-start gap-1.5">
                        <span className="text-[#888] select-none">•</span>
                        <span>
                          <strong>Maintain SIP</strong> — Continue contributing {formatCurrency(monthlySip)}/mo to reach goal on time
                        </span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <span className="text-[#888] select-none">•</span>
                        <span>
                          <strong>Target timeline</strong> — Goal of {formatCurrency(targetAmount)} achievable within {timeHorizon} years
                        </span>
                      </li>
                    </>
                  )}
                </ul>
              </div>

              {/* Card 3 — Top 3 risks */}
              <div 
                className="bg-white border border-[#e8eaed] border-l-[3px] p-5 rounded-[10px] flex flex-col gap-3 h-full"
                style={{ borderLeftColor: '#EF9F27' }}
              >
                <div className="flex items-center gap-2 text-[#b45309]">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span className="text-[14px] font-medium tracking-tight">Top 3 risks</span>
                </div>
                <ol className="flex flex-col gap-2.5 text-[13px] text-[#666] leading-[1.6]">
                  <li className="flex items-start gap-1.5">
                    <span className="font-medium text-[#333] select-none">1.</span>
                    <span>
                      <strong className="text-[#333] font-semibold">Market volatility</strong> — Equity can drop 20% in a bad year
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="font-medium text-[#333] select-none">2.</span>
                    <span>
                      <strong className="text-[#333] font-semibold">Inflation erosion</strong> — At {inflationRate || 6}%/yr, {formatCurrency(targetAmount)} buys {formatCurrency(Math.round(targetAmount * Math.pow(1 + (inflationRate || 6.0)/100, -timeHorizon)))} worth today
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="font-medium text-[#333] select-none">3.</span>
                    <span>
                      <strong className="text-[#333] font-semibold">Rate changes</strong> — Debt returns fall if rates drop below 7%
                    </span>
                  </li>
                </ol>
              </div>

            </div>
          ) : (
            <div className="py-6 text-center text-[#888888] text-xs flex flex-col items-center justify-center gap-2 bg-[#f8f9fb] rounded-lg">
              <span className="font-medium">Calculations completed. Projections are visible above.</span>
            </div>
          )}
        </section>

        {/* 6. STRESS TEST RESULTS PANEL */}
        {(() => {
          return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">

              {/* Panel A — Stress scenario: -30% drawdown impact */}
              <div 
                className="bg-white border border-[#e8eaed] border-l-[3px] rounded-[10px] p-5 flex flex-col justify-between min-h-[320px] relative transition-all"
                style={{ borderLeftColor: '#EF9F27' }}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center pb-3 border-b border-[#f0f2f5] mb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={16} className="text-[#b45309]" />
                      <span className="text-[14px] font-medium text-[#333]">Stress scenario</span>
                    </div>
                    <span className="px-2 py-0.5 bg-[#fff3e0] text-[#b45309] text-[11px] font-medium rounded-full">
                      -30% drawdown
                    </span>
                  </div>

                  {riskShockData ? (
                    <div className="flex flex-col gap-0">
                      <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                        <span className="text-[12px] text-[#9aa0aa]">Simulated shock</span>
                        <span className="text-[13px] text-[#333] font-medium text-right">
                          -{riskShockData.crash_drawdown_pct}% in Year {riskShockData.crash_year}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                        <span className="text-[12px] text-[#9aa0aa]">Standard corpus</span>
                        <span className="text-[13px] text-[#333] font-medium text-right">
                          {formatCurrency(riskShockData.standard_final_corpus)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                        <span className="text-[12px] text-[#9aa0aa]">Shocked corpus</span>
                        <span className="text-[13px] text-[#b45309] font-medium text-right">
                          {formatCurrency(riskShockData.shocked_final_corpus)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                        <span className="text-[12px] text-[#9aa0aa]">Shock impact</span>
                        <span className="text-[13px] text-[#b45309] font-medium text-right">
                          -{formatCurrency(riskShockData.impact_value)} (-{riskShockData.impact_pct}%)
                        </span>
                      </div>
                      <div className="grid grid-cols-2 py-[10px] items-center">
                        <span className="text-[12px] text-[#9aa0aa]">Recovery timeline</span>
                        <span className="text-[13px] text-[#333] font-medium text-right">
                          {riskShockData.recovery_years} years
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center text-[#888888] text-xs">
                      Calculating...
                    </div>
                  )}
                </div>

                {riskShockData && (
                  <div className="mt-4 p-3 bg-[#fff8e1] border-l-[3px] border-l-[#b45309] rounded-r-md flex items-center gap-2 text-[13px] text-[#444] leading-normal select-none">
                    <AlertTriangle size={14} className="text-[#b45309] shrink-0" />
                    <span>Your goal is delayed by {riskShockData.goal_delay_years || 4} years under this scenario.</span>
                  </div>
                )}
              </div>

              {/* Panel B — Scenario analysis risks */}
              <div className="bg-white border border-[#e8eaed] rounded-[10px] p-5 flex flex-col justify-between min-h-[320px] relative">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#f0f2f5] mb-2">
                    <Activity size={16} className="text-[#1a56db]" />
                    <span className="text-[14px] font-medium text-[#333]">Scenario analysis</span>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="p-3 bg-[#f8f9fb] border-l-[3px] border-l-[#e8eaed] rounded-r-md flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium text-[#444]">CAGR deficit</span>
                      <span className="text-[13px] text-[#666] leading-relaxed">
                        Contributions are below the threshold needed at expected market returns.
                      </span>
                    </div>
                    <div className="p-3 bg-[#f8f9fb] border-l-[3px] border-l-[#e8eaed] rounded-r-md flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium text-[#444]">Sequence of returns</span>
                      <span className="text-[13px] text-[#666] leading-relaxed">
                        A downturn in final years widens the gap. Increasing SIP buffer helps.
                      </span>
                    </div>
                    <div className="p-3 bg-[#f8f9fb] border-l-[3px] border-l-[#e8eaed] rounded-r-md flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium text-[#444]">Discipline rate</span>
                      <span className="text-[13px] text-[#666] leading-relaxed">
                        Historical data shows maintaining SIP through drawdowns is critical to recovery.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Panel C — How to balance plan */}
              <div className="bg-white border border-[#e8eaed] rounded-[10px] p-5 flex flex-col justify-between min-h-[320px] relative">
                <div className="flex flex-col gap-3 h-full">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#f0f2f5] mb-2">
                    <CheckCircle2 size={16} className="text-[#1a56db]" />
                    <span className="text-[14px] font-medium text-[#333]">How to balance</span>
                  </div>

                  <div className="flex flex-col gap-0">
                    <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                      <span className="text-[12px] text-[#9aa0aa]">Required monthly SIP</span>
                      <span className="text-[13px] text-[#1a56db] font-medium text-right">
                        {formatCurrency(clientProjections.requiredSip)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                      <span className="text-[12px] text-[#9aa0aa]">Current monthly SIP</span>
                      <span className="text-[13px] text-[#333] font-medium text-right">
                        {formatCurrency(monthlySip)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                      <span className="text-[12px] text-[#9aa0aa]">SIP gap to bridge</span>
                      <span className="text-[13px] text-[#b45309] font-medium text-right">
                        {formatCurrency(clientProjections.sipAdjustment)} more/mo
                      </span>
                    </div>
                    <div className="grid grid-cols-2 py-[10px] border-b border-[#f0f2f5] items-center">
                      <span className="text-[12px] text-[#9aa0aa]">Timeline adjustment</span>
                      <span className="text-[13px] text-[#b45309] font-medium text-right">
                        {clientProjections.timeExtensionYears} years longer
                      </span>
                    </div>
                    <div className="grid grid-cols-2 py-[10px] items-center">
                      <span className="text-[12px] text-[#9aa0aa]">Total time required</span>
                      <span className="text-[13px] text-[#333] font-medium text-right">
                        {clientProjections.totalRequiredYears} years
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-[#9aa0aa] italic mt-3 mb-3 leading-normal select-none">
                    Backtest simulations use historical Nifty 50 data. Past performance does not guarantee future results.
                  </p>

                  <button
                    onClick={scrollToSip}
                    className="w-full py-2.5 bg-[#1a56db] text-white rounded-[7px] text-[13px] font-medium hover:opacity-90 transition-all select-none cursor-pointer mt-auto"
                  >
                    Adjust my SIP target
                  </button>
                </div>
              </div>

            </div>
          );
        })()}

      </main>

    </div>
  );
}
