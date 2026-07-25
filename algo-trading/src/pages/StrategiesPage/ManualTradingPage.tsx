import React, { useState, useEffect } from 'react';
import {
  Plus,
  History,
  BarChart3,
  ArrowRightLeft,
  Wallet
} from 'lucide-react';

import { usePageTitle } from '../../hooks/usePageTitle';
import { useAngelConnection } from '../../shared/angel/AngelConnectionProvider';
import { apiGet } from '../../trading';

type MarginData = {
  net: number;
  available: number;
  used: number;
};

type IndexPriceData = {
  ltp: number;
};

const ManualTradingPage: React.FC = () => {
  usePageTitle('Manual Trading');
  const { connectStatus } = useAngelConnection();

  const [margins, setMargins] = useState<MarginData | null>(null);
  const [indices, setIndices] = useState<Record<string, number>>({
    'NIFTY 50': 0,
    'SENSEX': 0,
    'BANK NIFTY': 0
  });

  // Fetch live account margins
  useEffect(() => {
    if (connectStatus !== 'connected') {
      setMargins(null);
      return;
    }

    let active = true;
    const fetchMargins = async () => {
      try {
        const response = await apiGet<any>('/angel/margins');
        if (!active) return;
        if (response && response.status && response.data) {
          const d = response.data;
          setMargins({
            net: parseFloat(d.net || '0'),
            available: parseFloat(d.availablecash || d.availablelimitmargin || '0'),
            used: parseFloat(d.utiliseddebits || '0')
          });
        }
      } catch (err) {
        console.error('Failed to fetch broker margins:', err);
      }
    };

    fetchMargins();
    const interval = setInterval(fetchMargins, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [connectStatus]);

  // Fetch live index spot prices
  useEffect(() => {
    if (connectStatus !== 'connected') return;

    let active = true;
    const fetchIndices = async () => {
      try {
        const [nifty, sensex, banknifty] = await Promise.all([
          apiGet<IndexPriceData>('/market/index-ltp?underlying=NIFTY').catch(() => ({ ltp: 0 })),
          apiGet<IndexPriceData>('/market/index-ltp?underlying=SENSEX').catch(() => ({ ltp: 0 })),
          apiGet<IndexPriceData>('/market/index-ltp?underlying=BANKNIFTY').catch(() => ({ ltp: 0 }))
        ]);

        if (!active) return;

        setIndices({
          'NIFTY 50': nifty.ltp,
          'SENSEX': sensex.ltp,
          'BANK NIFTY': banknifty.ltp
        });
      } catch (err) {
        console.error('Failed to fetch indices LTP:', err);
      }
    };

    fetchIndices();
    const interval = setInterval(fetchIndices, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [connectStatus]);

  const formatRupees = (val: number) => {
    return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Manual Terminal</h1>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">Execute equity & options orders instantly</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-cyan-500/25">
            <Plus className="w-4 h-4" />
            New Order
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-widest rounded-xl transition-all">
            <History className="w-4 h-4" />
            Order History
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Watchlist Section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Live Watchlist</h3>
              <button className="text-xs font-bold text-cyan-500 hover:underline">Manage</button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {['NIFTY 50', 'SENSEX', 'BANK NIFTY'].map((idx) => (
                <div key={idx} className="p-6 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-white/5 rounded-xl flex items-center justify-center group-hover:bg-cyan-500 transition-colors">
                      <BarChart3 className="w-5 h-5 text-slate-500 group-hover:text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-900 dark:text-white">{idx}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Spot Index</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-900 dark:text-white">
                      {connectStatus === 'connected' && indices[idx] > 0
                        ? formatRupees(indices[idx])
                        : '—'}
                    </p>
                    {connectStatus === 'connected' && indices[idx] > 0 && (
                      <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-tighter">Live</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-6 bg-slate-50/50 dark:bg-white/[0.02] text-center">
              <button className="text-[10px] font-black uppercase text-slate-400 tracking-widest hover:text-cyan-500 transition-colors">View All Instruments</button>
            </div>
          </div>
        </div>

        {/* Account Summary Sidebar */}
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-8 rounded-[2rem] text-white shadow-xl shadow-slate-900/20">
            <div className="flex items-center justify-between mb-8">
              <Wallet className="w-8 h-8 text-cyan-500" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Equity Balance</span>
            </div>
            <p className="text-3xl font-black tracking-tighter">
              {connectStatus === 'connected' && margins ? formatRupees(margins.net) : 'Not Connected'}
            </p>
            <div className="mt-8 flex items-center justify-between py-4 border-t border-white/10">
              <div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Margin Used</p>
                <p className="text-sm font-black mt-1">
                  {connectStatus === 'connected' && margins ? formatRupees(margins.used) : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Available</p>
                <p className="text-sm font-black mt-1">
                  {connectStatus === 'connected' && margins ? formatRupees(margins.available) : '—'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Recent Activity</h3>
            <div className="space-y-4">
              {[1, 2].map(i => (
                <div key={i} className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 group hover:border-slate-200 dark:hover:border-white/10 border border-transparent transition-all">
                  <div className="w-8 h-8 bg-slate-100 dark:bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-black text-slate-900 dark:text-white">NIFTY JUN PE</p>
                      <span className="text-[10px] font-bold text-rose-500">SELL</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter mt-1">20 JUN • ₹145.20</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualTradingPage;
