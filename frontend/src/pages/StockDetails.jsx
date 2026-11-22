import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Star, TrendingUp, Cpu, Activity, AlertTriangle,
  TrendingDown, ShieldAlert, BarChart3, LineChart as LineIcon,
  Copy, Check
} from 'lucide-react';
import { ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

const toSentenceCase = (str) => {
  if (!str) return '';
  const lower = str.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

export default function StockDetails() {
  const { ticker } = useParams();
  const fullTicker = ticker.endsWith(".NS") ? ticker : `${ticker}.NS`;

  // State
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState('3M'); // Default to 3 months

  // AI analysis state
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiTone, setAiTone] = useState('advanced');
  const [aiTimestamp, setAiTimestamp] = useState(null);
  const [detailsTimestamp, setDetailsTimestamp] = useState(null);
  const [copied, setCopied] = useState(false);

  // Watchlist local storage
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('stocksense_watchlist');
    return saved ? JSON.parse(saved) : [];
  });

  const isWatchlisted = watchlist.includes(fullTicker);

  const fetchStockDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${CLEAN_BASE_URL}/api/stocks/${fullTicker}`);
      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }
      const resData = await response.json();
      setData(resData);
      setDetailsTimestamp(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Fetch stock details error:", err);
      setError("Failed to load detailed stock data. Check connection.");
    } finally {
      setLoading(false);
    }
  };

  const fetchAIAnalysis = async (tone = 'advanced') => {
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await fetch(`${CLEAN_BASE_URL}/api/stocks/${fullTicker}/analysis?tone=${tone}`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error(`AI generation error ${response.status}`);
      }
      const resData = await response.json();
      setAiAnalysis(resData.analysis);
      setAiTimestamp(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("AI Analysis error:", err);
      setAiError("Failed to generate AI investment thesis.");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    fetchStockDetails();
    fetchAIAnalysis(aiTone);
  }, [ticker]);

  // Save watchlist updates
  useEffect(() => {
    localStorage.setItem('stocksense_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  const handleToneChange = (newTone) => {
    setAiTone(newTone);
    fetchAIAnalysis(newTone);
  };

  const handleCopy = () => {
    if (!aiAnalysis) return;
    const text = `StockSense AI Investment Thesis for ${ticker.toUpperCase()}:
Verdict: ${aiAnalysis.verdict || 'HOLD'} (Confidence: ${aiAnalysis.confidence || 0.0}/10)
Verdict Reason: ${aiAnalysis.verdict_reason || 'N/A'}
Valuation Signal: ${aiAnalysis.valuation_signal || 'N/A'}
Momentum Signal: ${aiAnalysis.momentum_signal || 'N/A'}
Key Risk Flag: ${aiAnalysis.key_risk || 'N/A'}`;

    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => {
        console.error("Clipboard copy error:", err);
      });
  };

  const toggleWatchlist = () => {
    setWatchlist(prev =>
      prev.includes(fullTicker)
        ? prev.filter(t => t !== fullTicker)
        : [...prev, fullTicker]
    );
  };

  // Calculate 50 DMA and add to history
  const historyWithDma = useMemo(() => {
    if (!data || !data.history) return [];

    const hist = data.history.map((d, index) => {
      if (index < 49) {
        return { ...d, dma50: null };
      }
      let sum = 0;
      for (let i = 0; i < 50; i++) {
        sum += data.history[index - i].close;
      }
      return { ...d, dma50: parseFloat((sum / 50).toFixed(2)) };
    });
    return hist;
  }, [data]);

  // Slice historical data based on timeframe selection
  const chartData = useMemo(() => {
    if (historyWithDma.length === 0) return [];

    switch (timeframe) {
      case '1W':
        return historyWithDma.slice(-5); // 5 trading days
      case '1M':
        return historyWithDma.slice(-20); // ~20 trading days
      case '3M':
        return historyWithDma.slice(-60); // ~60 trading days
      case '1Y':
        return historyWithDma.slice(-250); // ~250 trading days
      default:
        return historyWithDma.slice(-250); // Default to last 1Y
    }
  }, [historyWithDma, timeframe]);

  // Determine trend indicators
  const statsSummary = useMemo(() => {
    if (!chartData || chartData.length === 0) return { changePrice: 0, changePercent: 0, isBullish: true };
    const firstPrice = chartData[0].close;
    const lastPrice = chartData[chartData.length - 1].close;
    const changePrice = lastPrice - firstPrice;
    const changePercent = (changePrice / firstPrice) * 100;
    return {
      changePrice: parseFloat(changePrice.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      isBullish: changePrice >= 0
    };
  }, [chartData]);

  // Formatter for Market Cap
  const formatMcap = (mcapBytes) => {
    if (!mcapBytes) return '-';
    const crores = mcapBytes / 10000000;
    if (crores >= 100000) {
      return `₹${(crores / 100000).toFixed(2)} L Cr`;
    }
    return `₹${crores.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
  };

  // RSI Color Coding matching design system
  const getRsiBadgeClass = (rsi) => {
    if (rsi === null || rsi === undefined) return 'text-[#888888] bg-[#f0f2f5]';
    if (rsi < 30) return 'text-[#2e7d32] bg-[#e8f5e9]';
    if (rsi > 60) return 'text-[#b45309] bg-[#fff3e0]';
    return 'text-[#555555] bg-[#f0f2f5]';
  };

  if (loading) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center p-8 bg-[#f8f9fb]">
        <Activity className="text-[#1a56db] animate-pulse stroke-[2.5]" size={36} />
        <p className="mt-3 text-sm text-[#888888]">Calculating...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center p-8 text-center bg-[#f8f9fb]">
        <AlertTriangle className="text-[#c62828] mb-2" size={36} />
        <h3 className="font-medium text-[#111111] mb-2">{error || "Data not found"}</h3>
        <Link to="/" className="px-4 py-2 bg-[#1a56db] hover:opacity-95 rounded-[7px] text-xs font-semibold text-white transition-all flex items-center gap-2">
          <ArrowLeft size={14} /> Back to Screener
        </Link>
      </div>
    );
  }

  const { metrics } = data;
  const isAvailable = metrics.status !== 'data_unavailable';
  const volRatio = (metrics.volume_today && metrics.volume_avg_30d) ? metrics.volume_today / metrics.volume_avg_30d : 0;

  return (
    <div className="flex-grow bg-[#f8f9fb] p-6 flex flex-col gap-6 max-w-7xl mx-auto w-full">

      {/* 1. TOP HEADER & METRICS BAR */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[#e8eaed] pb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="p-2 bg-white border border-[#e8eaed] hover:border-[#1a56db] rounded-lg text-[#888888] hover:text-[#111111] transition-all"
            title="Back to screener"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-medium tracking-tight text-[#111111] font-mono">
                {data.ticker.replace(".NS", "")}
              </h2>
              <span className="text-xs bg-white px-2 py-0.5 rounded font-mono text-[#9aa0aa] border border-[#e8eaed]">
                NSE
              </span>
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-[#9aa0aa] px-2 py-0.5 bg-white rounded border border-[#e8eaed] font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2e7d32]"></span>
                <span>Live Data</span>
                {detailsTimestamp && <span className="text-[9px] text-[#9aa0aa] border-l border-[#e8eaed] pl-1.5 ml-0.5">Fetched: {detailsTimestamp}</span>}
              </div>
              <button
                onClick={toggleWatchlist}
                className="text-[#d1d5db] hover:text-[#f59e0b] transition-colors ml-1"
                title="Add to watchlist"
              >
                <Star
                  size={20}
                  className={isWatchlisted ? "fill-[#f59e0b] text-[#f59e0b]" : "text-[#d1d5db]"}
                />
              </button>
            </div>
            <p className="text-[13px] text-[#888888] font-normal mt-0.5">{toSentenceCase(data.name)}</p>
          </div>
        </div>

        {/* Live quote box */}
        <div className="flex items-baseline gap-4 bg-white border border-[#e8eaed] rounded-lg px-5 py-3.5 self-stretch md:self-auto font-mono">
          <div className="flex flex-col">
            <span className="text-[10px] text-[#9aa0aa] tracking-wider font-medium">Current Price</span>
            <span className="text-2xl font-medium text-[#111111] mt-0.5">
              {isAvailable ? `₹${metrics.current_price.toLocaleString('en-IN')}` : '-'}
            </span>
          </div>

          {/* Sliced timeframe change percentage (amber for drops, green for gains) */}
          {chartData.length > 0 && (
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-[#9aa0aa] tracking-wider font-medium">Change ({timeframe})</span>
              <span className={`flex items-center gap-0.5 text-sm font-medium mt-1.5 ${statsSummary.isBullish ? 'text-[#2e7d32]' : 'text-[#b45309]'}`}>
                {statsSummary.isBullish ? '+' : ''}{statsSummary.changePercent}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. MAIN GRID (CHART & AI PANELS) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left/Middle: Rich Price Chart */}
        <div className="lg:col-span-2 bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4 min-h-[420px]">

          {/* Chart controls */}
          <div className="flex items-center justify-between border-b border-[#e8eaed] pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#888888]">
              <LineIcon size={14} className="text-[#1a56db]" />
              <span>Price history</span>
            </div>

            {/* Timeframe selector */}
            <div className="flex gap-1 bg-[#f8f9fb] border border-[#e8eaed] rounded p-0.5 text-xs font-mono font-bold">
              {['1W', '1M', '3M', '1Y'].map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1 rounded text-center transition-colors cursor-pointer ${timeframe === tf ? 'bg-[#1a56db] text-white' : 'text-[#888888] hover:text-[#111111]'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Visualizing Area Chart */}
          <div className="flex-1 min-h-[300px] w-full">
            {chartData.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-[#888888] text-xs">
                History unavailable
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1a56db" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#1a56db" stopOpacity={0.00} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" opacity={0.6} />
                  <XAxis
                    dataKey="date"
                    stroke="#9aa0aa"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                  />
                  <YAxis
                    yAxisId="price"
                    domain={['auto', 'auto']}
                    stroke="#9aa0aa"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    dx={-5}
                    tickFormatter={(v) => `₹${v}`}
                  />
                  <YAxis
                    yAxisId="volume"
                    orientation="right"
                    domain={[0, (data) => Math.max(...data.map(d => d.volume)) * 4]}
                    hide={true}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e8eaed', borderRadius: '6px' }}
                    labelStyle={{ color: '#888888', fontSize: '11px', fontFamily: 'monospace' }}
                    itemStyle={{ color: '#111111', fontSize: '13px', fontWeight: 'medium' }}
                    formatter={(val, name) => {
                      if (name === 'Close') return [`₹${val.toLocaleString('en-IN')}`, 'Close Price'];
                      if (name === '50 DMA') return val !== null ? [`₹${val.toLocaleString('en-IN')}`, '50-Day Avg'] : ['-', '50-Day Avg'];
                      if (name === 'Volume') return [`${val.toLocaleString('en-IN')} shares`, 'Volume'];
                      return [val, name];
                    }}
                  />
                  <Bar
                    yAxisId="volume"
                    dataKey="volume"
                    fill="#e8eaed"
                    opacity={0.6}
                    barSize={6}
                    name="Volume"
                  />
                  <Area
                    yAxisId="price"
                    type="monotone"
                    dataKey="close"
                    stroke="#1a56db"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorPrice)"
                    name="Close"
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="dma50"
                    stroke="#b45309"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="3 3"
                    name="50 DMA"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

        </div>

        {/* Right Column: AI Analysis Verdict & Details */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          {aiLoading ? (
            <div className="flex flex-col gap-6 animate-pulse w-full">
              <div className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4">
                <div className="h-4 bg-[#e8eaed] rounded w-1/3"></div>
                <div className="h-10 bg-[#e8eaed] rounded w-full"></div>
              </div>
              <div className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-5">
                <div className="h-4 bg-[#e8eaed] rounded w-1/2"></div>
                <div className="h-14 bg-[#e8eaed] rounded w-full"></div>
              </div>
            </div>
          ) : aiError ? (
            <div className="bg-white border border-[#e8eaed] rounded-lg flex flex-col gap-4 justify-center items-center text-center p-8 min-h-[300px]">
              <AlertTriangle className="text-[#b45309] mx-auto mb-2" size={28} />
              <p className="text-xs text-[#888888] mb-4">{aiError}</p>
              <button
                onClick={() => fetchAIAnalysis(aiTone)}
                className="px-4 py-2 bg-white border border-[#e8eaed] hover:border-[#1a56db] rounded-[7px] text-xs text-[#444444] font-mono font-bold transition-all cursor-pointer"
              >
                Retry Analysis
              </button>
            </div>
          ) : (aiAnalysis && typeof aiAnalysis === 'object') ? (
            <>
              {/* 1. Decision Summary Card */}
              <div className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4 select-none">
                <div className="flex items-center justify-between border-b border-[#e8eaed] pb-2.5">
                  <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider flex items-center gap-1.5 font-mono">
                    <Cpu size={12} className="text-[#1a56db]" />
                    Investment decision
                  </span>
                  {aiTimestamp && (
                    <span className="text-[9px] text-[#9aa0aa]/75 font-mono">
                      Refreshed: {aiTimestamp}
                    </span>
                  )}
                </div>

                {/* Score bar using Warning Amber for low confidence */}
                <div className="flex flex-col gap-1.5 p-3.5 bg-[#f8f9fb] rounded-lg border border-[#e8eaed] w-full select-none">
                  <div className="flex items-center justify-between text-[10px] text-[#9aa0aa] font-bold tracking-wider">
                    <span>Quantitative Signal Score</span>
                    <span className="text-[#111111] font-mono font-black text-sm">{aiAnalysis.confidence !== undefined ? `${aiAnalysis.confidence}/10` : '-'}</span>
                  </div>
                  <div className="w-full bg-[#e8eaed] rounded-full h-1.5 mt-1 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        aiAnalysis.confidence >= 7.5 ? 'bg-[#2e7d32]' :
                        aiAnalysis.confidence >= 5.0 ? 'bg-[#b45309]' :
                        'bg-[#b45309]'
                      }`}
                      style={{ width: `${(aiAnalysis.confidence || 5.0) * 10}%` }}
                    ></div>
                  </div>
                </div>

                {/* Why (Verdict Reason) */}
                <div className="flex gap-2.5 items-start p-2.5 bg-[#eff4ff]/30 border border-[#b3c8f8]/30 rounded-lg">
                  <span className="text-sm">💡</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-[#1a56db] tracking-wider">Strategic Thesis</span>
                    <p className="text-[#444444] text-[11px] mt-0.5 font-medium leading-relaxed">
                      {aiAnalysis.verdict_reason || 'Reasoning analysis unavailable.'}
                    </p>
                  </div>
                </div>

                {/* Key Risk Summary */}
                <div className="flex gap-2.5 items-start p-2.5 bg-[#fff3e0]/30 border border-[#b45309]/15 rounded-lg">
                  <span className="text-sm">⚠️</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-[#b45309] tracking-wider">Critical Risk Flag</span>
                    <p className="text-[#444444] text-[11px] mt-0.5 font-medium leading-relaxed">
                      {aiAnalysis.key_risk || 'Risk details unavailable.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. Detailed AI Analyst Thesis Card */}
              <div className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4 relative overflow-hidden select-none">

                <div className="flex items-center justify-between border-b border-[#e8eaed] pb-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#111111]">
                    <Cpu size={14} className="text-[#1a56db]" />
                    <span>AI analyst thesis</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopy}
                      disabled={aiLoading || !aiAnalysis}
                      className="p-1 rounded border border-[#e8eaed] hover:border-[#1a56db] text-[#888888] hover:text-[#111111] transition-all disabled:opacity-50 flex items-center justify-center cursor-pointer"
                      title="Copy analysis details to clipboard"
                    >
                      {copied ? <Check size={12} className="text-[#2e7d32]" /> : <Copy size={12} />}
                    </button>

                    <button
                      onClick={() => fetchAIAnalysis(aiTone)}
                      disabled={aiLoading}
                      className="text-[10px] px-2 py-0.5 rounded border border-[#e8eaed] hover:border-[#1a56db] text-[#888888] hover:text-[#111111] font-mono font-bold transition-all disabled:opacity-50 cursor-pointer"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>

                {/* Tone Toggle Selector */}
                <div className="flex bg-[#f8f9fb] border border-[#e8eaed] rounded p-0.5 text-[10px] font-bold font-mono">
                  <button
                    onClick={() => handleToneChange('advanced')}
                    disabled={aiLoading}
                    className={`flex-1 py-1 rounded text-center transition-all cursor-pointer ${aiTone === 'advanced'
                      ? 'bg-[#1a56db] text-white shadow-sm'
                      : 'text-[#888888] hover:text-[#111111]'
                      }`}
                  >
                    Advanced
                  </button>
                  <button
                    onClick={() => handleToneChange('el5')}
                    disabled={aiLoading}
                    className={`flex-1 py-1 rounded text-center transition-all cursor-pointer ${aiTone === 'el5'
                      ? 'bg-[#1a56db] text-white shadow-sm'
                      : 'text-[#888888] hover:text-[#111111]'
                      }`}
                  >
                    Explain like I'm 5
                  </button>
                </div>

                {/* Thesis Details */}
                <div className="flex-grow">
                  <div className="flex flex-col gap-4 text-sm leading-relaxed">
                    {/* Thesis item 1: Valuation */}
                    <div className="flex gap-3 items-start border-b border-[#e8eaed]/50 pb-3">
                      <div className="p-1.5 bg-[#eff4ff] text-[#1a56db] rounded border border-[#b3c8f8]/30 mt-0.5 shrink-0">
                        <BarChart3 size={14} />
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold text-[#1a56db] tracking-wider font-mono">Valuation Analysis</h4>
                        <p className="text-[#444444] text-xs mt-1 font-medium">{aiAnalysis.valuation_signal || 'Signal unavailable.'}</p>
                      </div>
                    </div>

                    {/* Thesis item 2: Momentum */}
                    <div className="flex gap-3 items-start">
                      <div className="p-1.5 bg-[#e8f5e9] text-[#2e7d32] rounded border border-[#e8f5e9] mt-0.5 shrink-0">
                        <TrendingUp size={14} />
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold text-[#2e7d32] tracking-wider font-mono">Momentum Analysis</h4>
                        <p className="text-[#444444] text-xs mt-1 font-medium">{aiAnalysis.momentum_signal || 'Signal unavailable.'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white border border-[#e8eaed] rounded-lg flex flex-col gap-4 justify-center items-center text-center p-8 min-h-[300px]">
              <Cpu className="text-[#9aa0aa] mx-auto mb-2 opacity-50" size={28} />
              <p className="text-xs text-[#888888]">No analysis retrieved yet.</p>
              <button
                onClick={() => fetchAIAnalysis(aiTone)}
                className="px-4 py-2 bg-[#1a56db] hover:opacity-95 rounded text-xs text-white font-mono font-bold transition-all cursor-pointer"
              >
                Run AI Analyst
              </button>
            </div>
          )}
        </div>

      </div>

      {/* 3. QUANTITATIVE INDICATORS PANEL */}
      <div className="bg-white border border-[#e8eaed] rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#888888] border-b border-[#e8eaed] pb-3">
          <Activity size={14} className="text-[#1a56db]" />
          <span>Technical & fundamental indicators</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">

          {/* Indicator 1: P/E */}
          <div className="bg-[#f8f9fb] border border-[#e8eaed] rounded p-4 flex flex-col">
            <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider">P/E Ratio</span>
            <span className="text-xl font-bold font-mono text-[#111111] mt-1">
              {isAvailable && metrics.pe !== null ? metrics.pe.toFixed(2) : '-'}
            </span>
            <span className="text-[9px] text-[#9aa0aa] font-mono mt-1">
              vs Median: {typeof metrics.sector_pe_median === 'number' ? metrics.sector_pe_median.toFixed(2) : metrics.sector_pe_median || '19.6'}
            </span>
          </div>

          {/* Indicator 2: EPS */}
          <div className="bg-[#f8f9fb] border border-[#e8eaed] rounded p-4 flex flex-col">
            <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider">EPS</span>
            <span className="text-xl font-bold font-mono text-[#111111] mt-1">
              {isAvailable && metrics.eps !== null ? `₹${metrics.eps.toFixed(2)}` : '-'}
            </span>
            <span className="text-[9px] text-[#9aa0aa] font-mono mt-1">Trailing 12-Month Earnings</span>
          </div>

          {/* Indicator 3: 14-day RSI */}
          <div className="bg-[#f8f9fb] border border-[#e8eaed] rounded p-4 flex flex-col">
            <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider">14d RSI (Wilder)</span>
            {isAvailable && metrics.rsi !== null ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xl font-bold font-mono text-[#111111]">
                  {metrics.rsi.toFixed(2)}
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${getRsiBadgeClass(metrics.rsi)}`}>
                  {metrics.rsi < 30 ? 'Oversold' : metrics.rsi > 60 ? 'Overbought' : 'Neutral'}
                </span>
              </div>
            ) : (
              <span className="text-xl font-bold font-mono text-[#111111] mt-1">-</span>
            )}
            <span className="text-[9px] text-[#9aa0aa] font-mono mt-1">Momentum limits</span>
          </div>

          {/* Indicator 4: 52w High / Proximity */}
          <div className="bg-[#f8f9fb] border border-[#e8eaed] rounded p-4 flex flex-col">
            <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider">52W High</span>
            <span className="text-xl font-bold font-mono text-[#111111] mt-1">
              {isAvailable && metrics.high_52w !== null ? `₹${metrics.high_52w.toLocaleString('en-IN')}` : '-'}
            </span>
            <span className={`text-[9px] font-mono mt-1 ${isAvailable && metrics.pct_from_52w_high !== null && metrics.pct_from_52w_high > 20 ? 'text-[#b45309] font-bold' : 'text-[#888888]'}`}>
              {isAvailable && metrics.pct_from_52w_high !== null ? (
                `Proximity: -${metrics.pct_from_52w_high.toFixed(2)}%`
              ) : '-'}
            </span>
          </div>

          {/* Indicator 5: 52w Low / Proximity */}
          <div className="bg-[#f8f9fb] border border-[#e8eaed] rounded p-4 flex flex-col">
            <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider">52W Low</span>
            <span className="text-xl font-bold font-mono text-[#111111] mt-1">
              {isAvailable && metrics.low_52w !== null ? `₹${metrics.low_52w.toLocaleString('en-IN')}` : '-'}
            </span>
            <span className={`text-[9px] font-mono mt-1 ${isAvailable && metrics.pct_from_52w_low !== null ? 'text-[#2e7d32]' : 'text-[#9aa0aa]'}`}>
              {isAvailable && metrics.pct_from_52w_low !== null ? `Proximity: +${metrics.pct_from_52w_low.toFixed(2)}%` : '-'}
            </span>
          </div>

          {/* Indicator 6: Market Capitalisation */}
          <div className="bg-[#f8f9fb] border border-[#e8eaed] rounded p-4 flex flex-col md:col-span-2">
            <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider">Market Cap</span>
            <span className="text-lg font-bold text-[#111111] mt-1.5">
              {formatMcap(metrics.market_cap)}
            </span>
            <span className="text-[9px] text-[#9aa0aa] font-mono mt-1">Nifty constituents rank</span>
          </div>

          {/* Indicator 7: Volume Spike ratio */}
          <div className="bg-[#f8f9fb] border border-[#e8eaed] rounded p-4 flex flex-col md:col-span-3">
            <span className="text-[10px] text-[#9aa0aa] font-bold tracking-wider">Volume Spike Ratio</span>
            <div className="flex items-center gap-4 mt-1.5">
              <span className={`text-xl font-bold font-mono ${volRatio >= 2.0 ? 'text-[#1a56db]' : 'text-[#111111]'}`}>
                {volRatio > 0 ? `${volRatio.toFixed(2)}x` : '-'}
              </span>
              <div className="flex flex-col text-[10px] text-[#9aa0aa] font-mono">
                <span>Today: {metrics.volume_today ? metrics.volume_today.toLocaleString('en-IN') : '-'}</span>
                <span>Avg: {metrics.volume_avg_30d ? Math.round(metrics.volume_avg_30d).toLocaleString('en-IN') : '-'}</span>
              </div>
            </div>
            <span className="text-[9px] text-[#9aa0aa] font-mono mt-1">Ratio: Today vs 30d Average</span>
          </div>

        </div>
      </div>

    </div>
  );
}
