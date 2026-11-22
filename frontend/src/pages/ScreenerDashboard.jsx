import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, SlidersHorizontal, RefreshCw, Star, ArrowUpDown,
  Bookmark, Award
} from 'lucide-react';

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

export default function ScreenerDashboard() {
  const navigate = useNavigate();

  // State
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('stocksense_watchlist');
    return saved ? JSON.parse(saved) : [];
  });

  // Active Preset Tracker
  const [activePreset, setActivePreset] = useState('all');

  // Filters State
  const [peMin, setPeMin] = useState(0);
  const [peMax, setPeMax] = useState(150);
  const [rsiMin, setRsiMin] = useState(0);
  const [rsiMax, setRsiMax] = useState(100);
  const [minMcap, setMinMcap] = useState(0); // In Thousand Crores
  const [proximityHigh, setProximityHigh] = useState(100); // within X% of 52w high
  const [proximityLow, setProximityLow] = useState(100);   // within X% of 52w low
  const [volumeSpikeOnly, setVolumeSpikeOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);

  // Sorting State
  const [sortField, setSortField] = useState('market_cap');
  const [sortAsc, setSortAsc] = useState(false); // Descending market cap by default

  const fetchStocks = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const url = forceRefresh ? `${CLEAN_BASE_URL}/api/stocks?refresh=true` : `${CLEAN_BASE_URL}/api/stocks`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setStocks(data);
    } catch (err) {
      console.error("Fetch stocks error:", err);
      setError(`Failed to fetch market data. Please verify your connection or try again.`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Fetch stocks on mount
  useEffect(() => {
    fetchStocks();
  }, []);

  // Save watchlist to localStorage when changed
  useEffect(() => {
    localStorage.setItem('stocksense_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  // Watchlist Toggle
  const toggleWatchlist = (e, ticker) => {
    e.stopPropagation(); // Avoid navigating to details page
    setWatchlist(prev =>
      prev.includes(ticker)
        ? prev.filter(t => t !== ticker)
        : [...prev, ticker]
    );
  };

  // Presets Handlers
  const applyPreset = (preset) => {
    setActivePreset(preset);
    // Reset defaults first
    setPeMin(0);
    setPeMax(150);
    setRsiMin(0);
    setRsiMax(100);
    setMinMcap(0);
    setProximityHigh(100);
    setProximityLow(100);
    setVolumeSpikeOnly(false);
    setWatchlistOnly(false);

    switch (preset) {
      case 'oversold':
        setRsiMax(30);
        break;
      case 'overbought':
        setRsiMin(60); // Overbought is >60 in spec
        break;
      case 'spikes':
        setVolumeSpikeOnly(true);
        break;
      case 'high':
        setProximityHigh(5); // Within 5% of 52w High
        break;
      case 'watchlist':
        setWatchlistOnly(true);
        break;
      default:
        break; // 'all'
    }
  };

  // Sort Handler
  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false); // Default to descending for numbers
    }
  };

  // Helper to calculate Volume Ratio (Today Volume / 30-day Avg)
  const getVolumeRatio = (stock) => {
    if (!stock.volume_today || !stock.volume_avg_30d) return 0;
    return stock.volume_today / stock.volume_avg_30d;
  };

  // Helper to calculate 1-month change from sparkline data
  const getOneMonthChange = (stock) => {
    if (!stock.sparkline_30d || stock.sparkline_30d.length === 0) return null;
    const start = stock.sparkline_30d[0];
    const end = stock.sparkline_30d[stock.sparkline_30d.length - 1];
    if (!start) return 0;
    return ((end - start) / start) * 100;
  };



  // Filter & Sort Logic
  const filteredAndSortedStocks = useMemo(() => {
    let result = [...stocks];

    // 1. Text Search Filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(stock =>
        stock.ticker.toLowerCase().includes(q) ||
        stock.name.toLowerCase().includes(q)
      );
    }

    // 2. Watchlist Only
    if (watchlistOnly) {
      result = result.filter(stock => watchlist.includes(stock.ticker));
    }

    // 3. Quantitative Filters
    result = result.filter(stock => {
      // If data is unavailable, only show it if searching or all filters are defaults
      if (stock.status === 'data_unavailable') {
        return searchQuery.trim() !== '';
      }

      // P/E Ratio filter
      if (stock.pe !== null) {
        if (stock.pe < peMin || stock.pe > peMax) return false;
      } else if (peMin > 0) {
        return false;
      }

      // RSI filter
      if (stock.rsi !== null) {
        if (stock.rsi < rsiMin || stock.rsi > rsiMax) return false;
      }

      // Market Cap filter (convert market cap to Thousand Crores: MCAP / 1e10)
      const mcapThousandCrore = stock.market_cap ? stock.market_cap / 10000000000 : 0;
      if (mcapThousandCrore < minMcap) return false;

      // Volume Spike filter
      if (volumeSpikeOnly) {
        const ratio = getVolumeRatio(stock);
        if (ratio < 2.0) return false;
      }

      // Proximity to 52w High
      if (stock.pct_from_52w_high !== null && stock.pct_from_52w_high > proximityHigh) return false;

      // Proximity to 52w Low
      if (stock.pct_from_52w_low !== null && stock.pct_from_52w_low > proximityLow) return false;

      return true;
    });

    // 4. Sort logic
    result.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      // Handle calculated or special fields
      if (sortField === 'watchlist') {
        valA = watchlist.includes(a.ticker) ? 1 : 0;
        valB = watchlist.includes(b.ticker) ? 1 : 0;
      } else if (sortField === 'one_month_change') {
        valA = getOneMonthChange(a) ?? -999;
        valB = getOneMonthChange(b) ?? -999;
      }

      // Place null values at the bottom
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    return result;
  }, [stocks, searchQuery, watchlistOnly, watchlist, peMin, peMax, rsiMin, rsiMax, minMcap, proximityHigh, proximityLow, volumeSpikeOnly, sortField, sortAsc]);

  // Formatter for Market Cap
  const formatMcap = (mcapBytes) => {
    if (!mcapBytes) return '-';
    // MCAP in Crores = MCAP / 10,000,000
    const crores = mcapBytes / 10000000;
    if (crores >= 100000) {
      return `${(crores / 100000).toFixed(2)} L Cr`;
    }
    return `${crores.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
  };

  // RSI Color Coding class builder matching design system
  const getRsiBadgeClass = (rsi) => {
    if (rsi === null || rsi === undefined) return 'text-[#888888] bg-[#f0f2f5]';
    if (rsi < 30) return 'text-[#2e7d32] bg-[#e8f5e9]';
    if (rsi > 60) return 'text-[#b45309] bg-[#fff3e0]';
    return 'text-[#555555] bg-[#f0f2f5]';
  };

  // Helper to generate dynamic slider gradients
  const getSliderStyle = (value, min, max) => {
    const pct = ((value - min) / (max - min)) * 100;
    return {
      background: `linear-gradient(to right, #1a56db 0%, #1a56db ${pct}%, #e8eaed ${pct}%, #e8eaed 100%)`
    };
  };

  return (
    <div className="flex-grow flex flex-col lg:flex-row bg-[#f8f9fb]">

      {/* 1. FILTERS SIDEBAR */}
      <aside className="w-full lg:w-[200px] lg:min-w-[200px] lg:max-w-[200px] bg-white border-r border-[#e8eaed] p-[20px] flex flex-col gap-[16px] select-none">

        {/* Header and Refresh */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[#9aa0aa] text-[10px] tracking-wider font-medium">
            <SlidersHorizontal size={12} className="text-[#1a56db]" />
            <span>Quant filters</span>
          </div>
          <button
            onClick={() => fetchStocks(true)}
            disabled={loading || refreshing}
            className="p-1 rounded bg-[#f8f9fb] border border-[#e8eaed] hover:border-[#1a56db] text-[#888888] hover:text-[#111111] transition-all disabled:opacity-50"
            title="Force refresh raw data"
          >
            <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Quick Filter Presets */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1.5 text-xs">
            <button
              onClick={() => applyPreset('all')}
              className={`py-1.5 px-3 text-left font-medium rounded-[6px] transition-colors select-none ${
                activePreset === 'all'
                  ? 'bg-[#eff4ff] text-[#1a56db]'
                  : 'bg-white text-[#444444] border border-[#e8eaed] hover:bg-[#f8f9fb]'
              }`}
            >
              All stocks
            </button>
            <button
              onClick={() => applyPreset('watchlist')}
              className={`py-1.5 px-3 text-left font-medium rounded-[6px] transition-colors select-none flex items-center justify-between ${
                activePreset === 'watchlist'
                  ? 'bg-[#eff4ff] text-[#1a56db]'
                  : 'bg-white text-[#444444] border border-[#e8eaed] hover:bg-[#f8f9fb]'
              }`}
            >
              <span>Watchlist</span>
              <Bookmark size={11} className={activePreset === 'watchlist' ? 'text-[#1a56db] fill-[#1a56db]' : 'text-[#888888]'} />
            </button>
            <button
              onClick={() => applyPreset('oversold')}
              className={`py-1.5 px-3 text-left font-medium rounded-[6px] transition-colors select-none flex items-center justify-between ${
                activePreset === 'oversold'
                  ? 'bg-[#eff4ff] text-[#1a56db]'
                  : 'bg-white text-[#444444] border border-[#e8eaed] hover:bg-[#f8f9fb]'
              }`}
            >
              <span>Oversold</span>
              <span className={`text-[9px] px-1 py-0.5 rounded font-mono ${activePreset === 'oversold' ? 'bg-[#1a56db]/10' : 'bg-gray-100 text-[#888888]'}`}>&lt;30</span>
            </button>
            <button
              onClick={() => applyPreset('overbought')}
              className={`py-1.5 px-3 text-left font-medium rounded-[6px] transition-colors select-none flex items-center justify-between ${
                activePreset === 'overbought'
                  ? 'bg-[#eff4ff] text-[#1a56db]'
                  : 'bg-white text-[#444444] border border-[#e8eaed] hover:bg-[#f8f9fb]'
              }`}
            >
              <span>Overbought</span>
              <span className={`text-[9px] px-1 py-0.5 rounded font-mono ${activePreset === 'overbought' ? 'bg-[#1a56db]/10' : 'bg-gray-100 text-[#888888]'}`}>&gt;60</span>
            </button>
            <button
              onClick={() => applyPreset('spikes')}
              className={`py-1.5 px-3 text-left font-medium rounded-[6px] transition-colors select-none flex items-center justify-between ${
                activePreset === 'spikes'
                  ? 'bg-[#eff4ff] text-[#1a56db]'
                  : 'bg-white text-[#444444] border border-[#e8eaed] hover:bg-[#f8f9fb]'
              }`}
            >
              <span>Vol spikes</span>
            </button>
            <button
              onClick={() => applyPreset('high')}
              className={`py-1.5 px-3 text-left font-medium rounded-[6px] transition-colors select-none flex items-center justify-between ${
                activePreset === 'high'
                  ? 'bg-[#eff4ff] text-[#1a56db]'
                  : 'bg-white text-[#444444] border border-[#e8eaed] hover:bg-[#f8f9fb]'
              }`}
            >
              <span>Near 52w high</span>
            </button>
          </div>
        </div>

        <hr className="border-[#e8eaed]" />

        {/* Dynamic Sliders List */}
        <div className="flex flex-col gap-[16px]">

          {/* P/E Ratio Slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#444444] font-medium">P/E ratio range</span>
              <span className="font-mono text-[#1a56db] font-bold">0 - {peMax === 150 ? "150+" : peMax}</span>
            </div>
            <input
              type="range"
              min="0"
              max="150"
              value={peMax}
              style={getSliderStyle(peMax, 0, 150)}
              onChange={(e) => {
                setPeMax(parseInt(e.target.value));
                setActivePreset('custom');
              }}
              className="w-full h-1 bg-[#e8eaed] rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#9aa0aa]">
              <span>0</span>
              <span>75</span>
              <span>150+</span>
            </div>
          </div>

          {/* RSI Slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#444444] font-medium">RSI range</span>
              <span className="font-mono text-[#1a56db] font-bold">0 - {rsiMax}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={rsiMax}
              style={getSliderStyle(rsiMax, 0, 100)}
              onChange={(e) => {
                setRsiMax(parseInt(e.target.value));
                setActivePreset('custom');
              }}
              className="w-full h-1 bg-[#e8eaed] rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#9aa0aa]">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
          </div>

          {/* Market Cap Slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#444444] font-medium">Min market cap</span>
              <span className="font-mono text-[#1a56db] font-bold">{minMcap}k Cr</span>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              step="10"
              value={minMcap}
              style={getSliderStyle(minMcap, 0, 200)}
              onChange={(e) => {
                setMinMcap(parseInt(e.target.value));
                setActivePreset('custom');
              }}
              className="w-full h-1 bg-[#e8eaed] rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#9aa0aa]">
              <span>0</span>
              <span>100k Cr</span>
              <span>200k+</span>
            </div>
          </div>

          {/* Proximity Slider Header */}
          <span className="text-[10px] font-medium text-[#9aa0aa] tracking-wider">Proximity ranges</span>

          {/* Proximity to High */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-[#888888]">Max % from 52w High</span>
              <span className="font-mono text-[#111111] font-bold">{proximityHigh === 100 ? "Any" : `${proximityHigh}%`}</span>
            </div>
            <input
              type="range"
              min="2"
              max="100"
              value={proximityHigh}
              style={getSliderStyle(proximityHigh, 2, 100)}
              onChange={(e) => {
                setProximityHigh(parseInt(e.target.value));
                setActivePreset('custom');
              }}
              className="w-full h-1 bg-[#e8eaed] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Proximity to Low */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-[#888888]">Max % from 52w Low</span>
              <span className="font-mono text-[#111111] font-bold">{proximityLow === 100 ? "Any" : `${proximityLow}%`}</span>
            </div>
            <input
              type="range"
              min="2"
              max="100"
              value={proximityLow}
              style={getSliderStyle(proximityLow, 2, 100)}
              onChange={(e) => {
                setProximityLow(parseInt(e.target.value));
                setActivePreset('custom');
              }}
              className="w-full h-1 bg-[#e8eaed] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Volume Spike Toggle */}
          <div className="flex items-center justify-between bg-white border border-[#e8eaed] rounded-md p-3">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-[#111111]">Volume spike</span>
              <span className="text-[10px] text-[#888888]">Today &gt; 2x avg</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={volumeSpikeOnly}
                onChange={(e) => {
                  setVolumeSpikeOnly(e.target.checked);
                  setActivePreset('custom');
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#e8eaed] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-[#888888] after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#1a56db] peer-checked:after:bg-white peer-checked:after:translate-x-4"></div>
            </label>
          </div>

        </div>

      </aside>

      {/* 2. RESULTS TABLE AREA */}
      <section className="flex-grow p-[20px] flex flex-col gap-[16px] overflow-hidden">

        {/* Actions Bar */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">

          {/* Search Input (280px width, #f4f5f7 bg) */}
          <div className="relative w-full md:w-[280px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#888888]" size={14} />
            <input
              type="text"
              placeholder="Search symbol or company..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#f4f5f7] border-0 rounded-lg text-sm text-[#111111] placeholder-[#888888] focus:outline-none focus:ring-1 focus:ring-[#1a56db] transition-all"
            />
          </div>

          {/* Active Filters Summary Right-Aligned */}
          <div className="text-sm text-[#444444] font-medium ml-auto select-none">
            {loading ? (
              <span className="text-[#888888]">Loading stocks…</span>
            ) : (
              <span><strong>{filteredAndSortedStocks.length}</strong> matches</span>
            )}
          </div>

        </div>

        {/* Main Table Card */}
        <div className="flex-1 bg-white border border-[#e8eaed] rounded-lg overflow-x-auto relative min-h-[400px]">

          {/* Interactive Data Table */}
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead className="bg-[#f8f9fb] border-b border-[#e8eaed] text-[#888888] text-[11px] tracking-wider font-medium sticky top-0 z-10 select-none">
              <tr>
                <th className="py-3 px-4 w-12 text-center">
                  <button onClick={() => handleSort('watchlist')} className="hover:text-[#111111] flex items-center gap-1 mx-auto">
                    <Star size={12} className={sortField === 'watchlist' ? 'text-[#1a56db] fill-[#1a56db]' : ''} />
                  </button>
                </th>
                <th className="py-3 px-4">
                  <button onClick={() => handleSort('ticker')} className="hover:text-[#111111] flex items-center gap-1">
                    <span>Ticker</span>
                    <ArrowUpDown size={11} className="opacity-70" />
                  </button>
                </th>
                <th className="py-3 px-4 min-w-[200px]">Company Name</th>
                <th className="py-3 px-4 text-right">
                  <button onClick={() => handleSort('current_price')} className="hover:text-[#111111] flex items-center gap-1 ml-auto">
                    <span>Price</span>
                    <ArrowUpDown size={11} className="opacity-70" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">
                  <button onClick={() => handleSort('pe')} className="hover:text-[#111111] flex items-center gap-1 ml-auto">
                    <span>P/E</span>
                    <ArrowUpDown size={11} className="opacity-70" />
                  </button>
                </th>
                <th className="py-3 px-4 text-center">
                  <button onClick={() => handleSort('rsi')} className="hover:text-[#111111] flex items-center gap-1 mx-auto">
                    <span>14d RSI</span>
                    <ArrowUpDown size={11} className="opacity-70" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">
                  <button onClick={() => handleSort('market_cap')} className="hover:text-[#111111] flex items-center gap-1 ml-auto">
                    <span>Market Cap</span>
                    <ArrowUpDown size={11} className="opacity-70" />
                  </button>
                </th>
                <th className="py-3 px-4 text-center">
                  <button onClick={() => handleSort('one_month_change')} className="hover:text-[#111111] flex items-center gap-1 mx-auto">
                    <span>1m Change</span>
                    <ArrowUpDown size={11} className="opacity-70" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8eaed] bg-white">
              {loading ? (
                /* Skeleton Loading Rows */
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx} className="border-b border-[#e8eaed] h-[44px]">
                    <td className="py-3 px-4 text-center">
                      <div className="w-4 h-4 rounded bg-[#e8eaed] mx-auto shimmer-effect"></div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="w-16 h-4 rounded bg-[#e8eaed] shimmer-effect"></div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="w-36 h-4 rounded bg-[#e8eaed] shimmer-effect"></div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="w-20 h-4 rounded bg-[#e8eaed] ml-auto shimmer-effect"></div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="w-12 h-4 rounded bg-[#e8eaed] ml-auto shimmer-effect"></div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="w-12 h-4 rounded bg-[#e8eaed] mx-auto shimmer-effect"></div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="w-24 h-4 rounded bg-[#e8eaed] ml-auto shimmer-effect"></div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="w-12 h-4 rounded bg-[#e8eaed] mx-auto shimmer-effect"></div>
                    </td>
                  </tr>
                ))
              ) : error ? (
                /* Error display - catch and display custom safe message */
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <p className="text-[#c62828] font-medium mb-2">Market analysis temporarily unavailable.</p>
                    <p className="text-xs text-[#888888] mb-4">Please verify your connection or retry fetching data.</p>
                    <button
                      onClick={() => fetchStocks()}
                      className="px-4 py-2 bg-[#1a56db] hover:opacity-90 rounded-[7px] text-xs font-semibold text-white transition-all"
                    >
                      Retry connection
                    </button>
                  </td>
                </tr>
              ) : filteredAndSortedStocks.length === 0 ? (
                /* Empty matches state */
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <SlidersHorizontal size={36} className="text-[#9aa0aa] mb-3 opacity-60 mx-auto" />
                    <h3 className="font-medium text-[#111111] mb-1">No stocks match active filters</h3>
                    <p className="text-xs text-[#888888] max-w-md mx-auto">Try relaxing your screening filters or search queries.</p>
                    <button
                      onClick={() => applyPreset('all')}
                      className="mt-4 px-4 py-2 bg-[#1a56db] hover:opacity-90 rounded-[7px] text-xs font-semibold text-white transition-colors"
                    >
                      Reset filters
                    </button>
                  </td>
                </tr>
              ) : (
                filteredAndSortedStocks.map((stock) => {
                  const isWatchlisted = watchlist.includes(stock.ticker);
                  const isAvailable = stock.status !== 'data_unavailable';
                  const oneMonthChange = getOneMonthChange(stock);

                  return (
                    <tr
                      key={stock.ticker}
                      onClick={() => navigate(`/stock/${stock.ticker.replace(".NS", "")}`)}
                      className="hover:bg-[#fafbfd] cursor-pointer transition-colors group min-h-[44px]"
                    >
                      {/* Watchlist star */}
                      <td className="py-3 px-4 text-center" onClick={(e) => toggleWatchlist(e, stock.ticker)}>
                        <button className="text-[#d1d5db] hover:text-[#f59e0b] transition-colors">
                          <Star
                            size={14}
                            className={isWatchlisted ? "fill-[#f59e0b] text-[#f59e0b]" : "text-[#d1d5db]"}
                          />
                        </button>
                      </td>

                      {/* Ticker */}
                      <td className="py-3 px-4 font-mono font-medium text-[#111111] text-[13px]">
                        {stock.ticker.replace(".NS", "")}
                      </td>

                      {/* Company Name */}
                      <td className="py-3 px-4 text-xs font-normal text-[#444444] max-w-[220px] truncate">
                        {stock.name}
                      </td>

                      {/* Current Price */}
                      <td className="py-3 px-4 text-right font-mono font-medium text-[#111111] text-[13px]">
                        {isAvailable ? `₹${stock.current_price.toLocaleString('en-IN')}` : '-'}
                      </td>

                      {/* P/E Ratio */}
                      <td className="py-3 px-4 text-right">
                        {isAvailable && stock.pe !== null ? (
                          <div className="flex flex-col items-end leading-tight select-none font-mono">
                            <span className="text-[13px] font-medium text-[#111111]">{stock.pe.toFixed(1)}</span>
                            <span className="text-[10px] text-[#9aa0aa] font-normal font-sans">
                              vs {typeof stock.sector_pe_median === 'number' ? `${stock.sector_pe_median.toFixed(1)} med` : stock.sector_pe_median || '19.6 med'}
                            </span>
                          </div>
                        ) : '-'}
                      </td>

                      {/* RSI indicator */}
                      <td className="py-3 px-4 text-center">
                        {isAvailable && stock.rsi !== null ? (
                          <span className={`inline-block px-2.5 py-0.5 text-xs font-mono font-medium rounded-full ${getRsiBadgeClass(stock.rsi)}`}>
                            {stock.rsi.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-[#888888]">-</span>
                        )}
                      </td>

                      {/* Market Cap */}
                      <td className="py-3 px-4 text-right font-mono font-medium text-[#111111] text-[13px]">
                        {formatMcap(stock.market_cap)}
                      </td>

                      {/* 1-month change percent */}
                      <td className="py-3 px-4 text-center font-mono">
                        {isAvailable && oneMonthChange !== null ? (
                          <span className={`font-medium text-[13px] ${oneMonthChange >= 0 ? 'text-[#2e7d32]' : 'text-[#b45309]'}`}>
                            {oneMonthChange >= 0 ? '+' : ''}{oneMonthChange.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[#888888]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

        </div>

      </section>

    </div>
  );
}
