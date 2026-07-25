import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  BarChart3
} from 'lucide-react';

import { apiGet } from '../../trading';
import { usePageTitle } from '../../hooks/usePageTitle';
import TradingViewChart, {
  type CandleItem,
  type LineSeriesItem,
  type MarkerItem,
  type PriceLineItem,
  type LayerToggles
} from '../../components/chart/TradingViewChart';
import { ChartToolbar } from '../../components/chart/ChartToolbar';
import { computeLocalEMA, computeLocalJMA } from '../../utils/indicatorUtils';

type IndexConfig = {
  id: string;
  name: string;
  underlying: string;
  exchange: string;
};

const INDICES_CONFIG: IndexConfig[] = [
  { id: 'nifty', name: 'NIFTY 50', underlying: 'NIFTY', exchange: 'NSE' },
  { id: 'sensex', name: 'SENSEX', underlying: 'SENSEX', exchange: 'BSE' },
  { id: 'banknifty', name: 'BANKNIFTY', underlying: 'BANKNIFTY', exchange: 'NSE' },
  { id: 'finnifty', name: 'FINNIFTY', underlying: 'FINNIFTY', exchange: 'NSE' },
];

type IndexData = {
  ltp: number | null;
  close: number | null;
  isOffline: boolean;
};

type IndexFetchResult = {
  id: string;
  ltp?: number;
  close?: number;
  isOffline: boolean;
};

type IndexPriceResponse = {
  ltp: number;
  close?: number;
  open?: number;
};

type ChartDataResponse = {
  underlying: string;
  date: string;
  interval: string;
  candles: CandleItem[];
  indicators: {
    ema: LineSeriesItem[];
    jma: LineSeriesItem[];
    modifiedHa: CandleItem[];
  };
  tradeOverlays: {
    markers: MarkerItem[];
    priceLines: PriceLineItem[];
  };
};

const DashboardPage: React.FC = () => {
  usePageTitle('Dashboard');

  // Selected Chart Controls
  const [selectedUnderlying, setSelectedUnderlying] = useState<string>('NIFTY');
  const [timeframe, setTimeframe] = useState<string>('5m');
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  // Transient Chart-Only Indicator Settings (Never saved to localStorage/DB)
  const [emaPeriod, setEmaPeriod] = useState<number>(20);
  const [jmaLength, setJmaLength] = useState<number>(7);

  // Layer Toggles
  const [toggles, setToggles] = useState<LayerToggles>({
    showEma: true,
    showJma: true,
    showMha: false,
    showMarkers: true,
    showPriceLines: true,
  });

  // Chart Data State
  const [chartData, setChartData] = useState<ChartDataResponse | null>(null);
  const [chartLoading, setChartLoading] = useState<boolean>(false);

  // Live indices state mapping key -> IndexData
  const [indicesData, setIndicesData] = useState<Record<string, IndexData>>({
    nifty: { ltp: null, close: null, isOffline: false },
    sensex: { ltp: null, close: null, isOffline: false },
    banknifty: { ltp: null, close: null, isOffline: false },
    finnifty: { ltp: null, close: null, isOffline: false },
  });

  // Poll live indices data every 2 seconds with error resilience
  useEffect(() => {
    let active = true;

    const fetchLiveIndices = async () => {
      const fetchPromises: Promise<IndexFetchResult>[] = INDICES_CONFIG.map(async (cfg): Promise<IndexFetchResult> => {
        try {
          const res = await apiGet<IndexPriceResponse>(`/market/index-ltp?underlying=${encodeURIComponent(cfg.underlying)}`);
          if (res && typeof res.ltp === 'number' && res.ltp > 0) {
            return {
              id: cfg.id,
              ltp: res.ltp,
              close: res.close && res.close > 0 ? res.close : (res.open && res.open > 0 ? res.open : res.ltp),
              isOffline: false
            };
          }
          throw new Error('Invalid LTP');
        } catch {
          return { id: cfg.id, isOffline: true };
        }
      });

      const results: IndexFetchResult[] = await Promise.all(fetchPromises);
      if (!active) return;

      setIndicesData((prev) => {
        const updated: Record<string, IndexData> = { ...prev };
        results.forEach((item: IndexFetchResult) => {
          const prevItem = prev[item.id] || { ltp: null, close: null, isOffline: false };
          if (item.isOffline) {
            updated[item.id] = {
              ...prevItem,
              isOffline: true
            };
          } else if (item.ltp !== undefined) {
            updated[item.id] = {
              ltp: item.ltp,
              close: item.close !== undefined ? item.close : prevItem.close,
              isOffline: false
            };
          }
        });
        return updated;
      });
    };

    fetchLiveIndices();
    const interval = setInterval(fetchLiveIndices, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch Chart Market Data from Backend
  useEffect(() => {
    let active = true;
    const fetchChart = async () => {
      setChartLoading(true);
      try {
        const url = `/chart/market-data?underlying=${encodeURIComponent(selectedUnderlying)}&date=${encodeURIComponent(selectedDate)}&interval=${encodeURIComponent(timeframe)}`;
        const res = await apiGet<{ data: ChartDataResponse }>(url);
        if (active && res && res.data) {
          setChartData(res.data);
        }
      } catch (err) {
        console.error('Failed to fetch chart data:', err);
      } finally {
        if (active) setChartLoading(false);
      }
    };

    fetchChart();
    return () => { active = false; };
  }, [selectedUnderlying, timeframe, selectedDate]);

  // Client-Side Visualization Indicator Computation (< 1ms recalculation)
  const localEma = useMemo(() => {
    return computeLocalEMA(chartData?.candles || [], emaPeriod);
  }, [chartData?.candles, emaPeriod]);

  const localJma = useMemo(() => {
    return computeLocalJMA(chartData?.candles || [], jmaLength);
  }, [chartData?.candles, jmaLength]);

  const handleToggleChange = (key: keyof LayerToggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleApplyParams = (newEma: number, newJma: number) => {
    setEmaPeriod(newEma);
    setJmaLength(newJma);
  };

  const formatNumber = (val: number | null) => {
    if (val === null || val <= 0) return '—';
    return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">System Overview</h1>
        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">Live market overview &amp; real-time analytics</p>
      </div>

      {/* Top Section: Live Indian Market Indices Bar (Angel One Inspired) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {INDICES_CONFIG.map((cfg) => {
          const data = indicesData[cfg.id] || { ltp: null, close: null, isOffline: false };
          const ltp = data.ltp;
          const close = data.close;

          let absChange = 0;
          let pctChange = 0;
          let isPositive = true;

          if (ltp !== null && close !== null && close > 0) {
            absChange = ltp - close;
            pctChange = (absChange / close) * 100;
            isPositive = absChange >= 0;
          }

          const hasData = ltp !== null && ltp > 0;
          const isSelected = selectedUnderlying === cfg.underlying;

          return (
            <div
              key={cfg.id}
              onClick={() => setSelectedUnderlying(cfg.underlying)}
              className={`p-5 rounded-3xl border shadow-sm transition-all duration-300 cursor-pointer group relative overflow-hidden ${
                isSelected
                  ? 'bg-cyan-500/10 border-cyan-500 shadow-lg shadow-cyan-500/10'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/5 hover:border-cyan-500/50'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-black tracking-tight ${isSelected ? 'text-cyan-500' : 'text-slate-900 dark:text-white'}`}>
                    {cfg.name}
                  </span>
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-400">
                    {cfg.exchange}
                  </span>
                </div>

                {data.isOffline ? (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    Syncing
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                )}
              </div>

              <div className="flex items-baseline justify-between">
                <h3 className="text-xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                  {formatNumber(ltp)}
                </h3>

                {hasData && (
                  <div className={`flex items-center gap-1 text-xs font-bold font-mono ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {isPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    <span>{isPositive ? '+' : ''}{absChange.toFixed(2)}</span>
                    <span className="text-[10px] font-black">({isPositive ? '+' : ''}{pctChange.toFixed(2)}%)</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Layout: 100% Full-Width Priority Chart */}
      <div className="w-full bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-500">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                {selectedUnderlying} Market Chart
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Live Historical Replay &amp; Strategy Overlays
              </p>
            </div>
          </div>
        </div>

        {/* Toolbar with Indicators Settings Panel */}
        <ChartToolbar
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          toggles={toggles}
          onToggleChange={handleToggleChange}
          emaPeriod={emaPeriod}
          jmaLength={jmaLength}
          onApplyParams={handleApplyParams}
        />

        {/* 100% Full-Width Chart Container */}
        <div className="w-full flex-1 h-[620px] relative">
          {chartLoading && (
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
              <RefreshCw className="w-8 h-8 text-cyan-500 animate-spin" />
            </div>
          )}

          <TradingViewChart
            key={`${selectedUnderlying}-${selectedDate}-${timeframe}`}
            candles={chartData?.candles || []}
            emaSeries={localEma}
            jmaSeries={localJma}
            modifiedHaSeries={chartData?.indicators?.modifiedHa || []}
            markers={chartData?.tradeOverlays?.markers || []}
            priceLines={chartData?.tradeOverlays?.priceLines || []}
            toggles={toggles}
            isDarkMode={false}
          />
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
