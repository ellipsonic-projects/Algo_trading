import React, { useState, useEffect } from 'react';
import {
  History,
  BarChart2,
  ArrowRightLeft,
  Wallet,
  Activity,
  Lock
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

type TradeData = {
  _id: string;
  premium: string;
  index: string;
  qty: number;
  buyPrice: number;
  exitPrice?: number;
  status: string;
  exitReason?: string;
  createdAt: string;
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
  const [recentTrades, setRecentTrades] = useState<TradeData[]>([]);

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

  // Fetch recent trades from backend
  useEffect(() => {
    let active = true;
    const fetchTrades = async () => {
      try {
        const response = await apiGet<any>('/trades?limit=5');
        if (!active) return;
        if (response && response.status === 'success' && response.data?.trades) {
          setRecentTrades(response.data.trades);
        }
      } catch (err) {
        console.error('Failed to fetch recent trades:', err);
      }
    };

    fetchTrades();
    const interval = setInterval(fetchTrades, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const formatRupees = (val: number) => {
    return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-4 select-none">
      {/* Top Action Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded border border-[#E0E3EB] shadow-sm">
        <div>
          <h1 className="text-sm font-bold text-[#1E222D] tracking-tight">Manual Execution Terminal</h1>
          <p className="text-[10px] font-medium text-[#787B86]">Direct Equity & Options Order Placement</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button 
              disabled
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#90A4AE] text-white text-xs font-semibold rounded shadow-sm cursor-not-allowed opacity-75"
              title="Manual order entry is locked for security"
            >
              <Lock className="w-3 h-3" />
              Place Order (Locked)
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:block bg-[#1E222D] text-white text-[9px] font-bold p-1.5 rounded shadow-lg whitespace-nowrap z-55">
              Locked to prevent interference with running strategies
            </div>
          </div>
          <button 
            onClick={() => window.location.href = '/trades'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F0F3FA] hover:bg-[#E0E3EB] border border-[#E0E3EB] text-[#434651] text-xs font-semibold rounded transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            Order Ledger
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Watchlist Section */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded border border-[#E0E3EB] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E0E3EB] flex items-center justify-between bg-[#F8F9FA]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1E222D]">Spot Watchlist</h3>
              <span className="text-[10px] font-semibold text-[#787B86]">LTP via Broker Stream</span>
            </div>
            <div className="divide-y divide-[#E0E3EB]">
              {['NIFTY 50', 'SENSEX', 'BANK NIFTY'].map((idx) => (
                <div key={idx} className="px-4 py-3 flex items-center justify-between hover:bg-[#F8F9FA] transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#F0F3FA] rounded flex items-center justify-center group-hover:bg-[#0052FF] transition-colors">
                      <BarChart2 className="w-4 h-4 text-[#787B86] group-hover:text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#1E222D]">{idx}</p>
                      <p className="text-[10px] text-[#787B86] font-medium uppercase">Spot Index</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-[#1E222D] tabular-nums">
                      {connectStatus === 'connected' && indices[idx] > 0
                        ? formatRupees(indices[idx])
                        : '—'}
                    </p>
                    {connectStatus === 'connected' && indices[idx] > 0 && (
                      <span className="text-[9px] text-[#089981] font-bold uppercase">LIVE</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 bg-[#F8F9FA] border-t border-[#E0E3EB] text-center">
              <span className="text-[10px] font-bold uppercase text-[#787B86]">Direct Broker Feed Enabled</span>
            </div>
          </div>
        </div>

        {/* Account Summary Sidebar */}
        <div className="space-y-4">
          <div className="bg-[#1E222D] p-5 rounded border border-[#1E222D] text-white shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[#0052FF]" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#787B86]">Equity Funds</span>
              </div>
              <Activity className="w-3.5 h-3.5 text-[#089981]" />
            </div>
            <p className="text-2xl font-bold tabular-nums tracking-tight">
              {connectStatus === 'connected' && margins ? formatRupees(margins.net) : 'Broker Disconnected'}
            </p>
            <div className="mt-4 flex items-center justify-between pt-3 border-t border-[#434651]/40 text-xs">
              <div>
                <p className="text-[10px] font-medium text-[#787B86] uppercase">Margin Used</p>
                <p className="font-bold tabular-nums mt-0.5">
                  {connectStatus === 'connected' && margins ? formatRupees(margins.used) : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium text-[#787B86] uppercase">Available Cash</p>
                <p className="font-bold tabular-nums mt-0.5">
                  {connectStatus === 'connected' && margins ? formatRupees(margins.available) : '—'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded border border-[#E0E3EB] shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1E222D] mb-3">Live Execution Stream</h3>
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {recentTrades.length === 0 ? (
                <p className="text-[10px] font-medium text-[#787B86] text-center py-4">No recent trade executions</p>
              ) : (
                recentTrades.map(trade => (
                  <div key={trade._id} className="flex gap-3 p-2.5 rounded bg-[#F8F9FA] border border-[#E0E3EB] hover:border-[#0052FF] transition-colors">
                    <div className="w-7 h-7 bg-[#F0F3FA] rounded flex items-center justify-center flex-shrink-0">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-[#787B86]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-bold text-[#1E222D] truncate" title={trade.premium}>{trade.premium}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${
                          trade.status === 'CLOSED' ? 'bg-[#E8F5E9] text-[#2E7D32]' :
                          trade.status === 'REJECTED' ? 'bg-[#FFEBEE] text-[#C62828]' :
                          'bg-[#E3F2FD] text-[#1565C0]'
                        }`}>
                          {trade.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[9px] text-[#787B86] font-medium">
                        <span>Qty: {trade.qty} @ ₹{trade.buyPrice}</span>
                        <span>
                          {trade.status === 'CLOSED' && trade.exitPrice ? `Exit: ₹${trade.exitPrice}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualTradingPage;
