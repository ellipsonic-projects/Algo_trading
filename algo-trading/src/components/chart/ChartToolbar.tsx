import React, { useState } from 'react';
import { Calendar, Eye, EyeOff, SlidersHorizontal, RotateCcw, Check } from 'lucide-react';
import type { LayerToggles } from './TradingViewChart';

type ChartToolbarProps = {
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  selectedDate: string;
  onDateChange: (date: string) => void;
  toggles: LayerToggles;
  onToggleChange: (key: keyof LayerToggles) => void;
  emaPeriod: number;
  jmaLength: number;
  onApplyParams: (emaPeriod: number, jmaLength: number) => void;
};

export const ChartToolbar: React.FC<ChartToolbarProps> = ({
  timeframe,
  onTimeframeChange,
  selectedDate,
  onDateChange,
  toggles,
  onToggleChange,
  emaPeriod,
  jmaLength,
  onApplyParams,
}) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [tempEma, setTempEma] = useState<number>(emaPeriod);
  const [tempJma, setTempJma] = useState<number>(jmaLength);

  const timeframes = [
    { label: '1m', value: '1m' },
    { label: '5m', value: '5m' },
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
  ];

  const handleApply = () => {
    onApplyParams(Math.max(1, tempEma), Math.max(1, tempJma));
    setPanelOpen(false);
  };

  const handleReset = () => {
    setTempEma(20);
    setTempJma(7);
    onApplyParams(20, 7);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/5 mb-4 relative">
      {/* Timeframe & Date */}
      <div className="flex items-center gap-4">
        {/* Timeframe Selector */}
        <div className="flex items-center bg-slate-200 dark:bg-slate-800 p-1 rounded-xl">
          {timeframes.map((tf) => (
            <button
              key={tf.value}
              onClick={() => onTimeframeChange(tf.value)}
              className={`px-3 py-1 text-xs font-black rounded-lg transition-all ${
                timeframe === tf.value
                  ? 'bg-cyan-500 text-white shadow-md'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Date Picker */}
        <div className="flex items-center gap-2 bg-slate-200 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
          <Calendar className="w-3.5 h-3.5 text-cyan-500" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="bg-transparent text-xs font-bold text-slate-900 dark:text-white outline-none border-none cursor-pointer"
          />
        </div>
      </div>

      {/* Indicators Panel Button & Controls */}
      <div className="relative flex items-center gap-3">
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all border shadow-sm ${
            panelOpen
              ? 'bg-cyan-500 text-white border-cyan-500'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-white/10 hover:border-cyan-500'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Indicators &amp; Settings</span>
        </button>

        {/* Indicators Popover Panel */}
        {panelOpen && (
          <div className="absolute right-0 top-12 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl rounded-2xl p-5 z-50 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-3">
              <h4 className="text-xs font-black uppercase text-slate-900 dark:text-white tracking-wider">
                Chart Indicators
              </h4>
              <span className="text-[10px] font-bold text-slate-400">Visualization Only</span>
            </div>

            {/* EMA Settings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onToggleChange('showEma')}
                  className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200"
                >
                  {toggles.showEma ? <Eye className="w-3.5 h-3.5 text-cyan-500" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                  <span>Exponential Moving Avg (EMA)</span>
                </button>
              </div>
              <div className="flex items-center gap-3 pl-6">
                <label className="text-[10px] font-bold uppercase text-slate-400">Length:</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={tempEma}
                  onChange={(e) => setTempEma(parseInt(e.target.value) || 20)}
                  className="w-20 px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-xs font-mono font-bold outline-none border border-slate-200 dark:border-white/10 focus:border-cyan-500"
                />
              </div>
            </div>

            {/* JMA Settings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onToggleChange('showJma')}
                  className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200"
                >
                  {toggles.showJma ? <Eye className="w-3.5 h-3.5 text-purple-500" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                  <span>Jurik Moving Avg (JMA)</span>
                </button>
              </div>
              <div className="flex items-center gap-3 pl-6">
                <label className="text-[10px] font-bold uppercase text-slate-400">Length:</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={tempJma}
                  onChange={(e) => setTempJma(parseInt(e.target.value) || 7)}
                  className="w-20 px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-xs font-mono font-bold outline-none border border-slate-200 dark:border-white/10 focus:border-purple-500"
                />
              </div>
            </div>

            {/* Mod HA & Trades Toggles */}
            <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-2">
              <button
                onClick={() => onToggleChange('showMha')}
                className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200 w-full"
              >
                {toggles.showMha ? <Eye className="w-3.5 h-3.5 text-blue-500" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                <span>Modified Heiken Ashi Candles</span>
              </button>

              <button
                onClick={() => onToggleChange('showMarkers')}
                className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200 w-full"
              >
                {toggles.showMarkers ? <Eye className="w-3.5 h-3.5 text-emerald-500" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                <span>Buy / Sell Trade Markers</span>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-white/5">
              <button
                onClick={handleReset}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl transition-all"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
              <button
                onClick={handleApply}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-bold rounded-xl shadow-md transition-all"
              >
                <Check className="w-3 h-3" /> Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
