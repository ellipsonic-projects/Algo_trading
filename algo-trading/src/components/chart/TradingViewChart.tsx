import React, { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type SeriesMarker,
  type Time,
  ColorType,
  LineStyle,
} from 'lightweight-charts';

export type CandleItem = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type LineSeriesItem = {
  time: number;
  value: number;
};

export type MarkerItem = {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
};

export type PriceLineItem = {
  title: string;
  price: number;
  color: string;
  lineStyle?: number;
};

export type LayerToggles = {
  showEma: boolean;
  showJma: boolean;
  showMha: boolean;
  showMarkers: boolean;
  showPriceLines: boolean;
};

type TradingViewChartProps = {
  candles: CandleItem[];
  emaSeries?: LineSeriesItem[];
  jmaSeries?: LineSeriesItem[];
  modifiedHaSeries?: CandleItem[];
  markers?: MarkerItem[];
  priceLines?: PriceLineItem[];
  toggles: LayerToggles;
  isDarkMode?: boolean;
};

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  candles,
  emaSeries = [],
  jmaSeries = [],
  modifiedHaSeries = [],
  markers = [],
  priceLines = [],
  toggles,
  isDarkMode = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const jmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const mhaSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  // Initialize Chart Container
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 620;

    const chart = createChart(containerRef.current, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: isDarkMode ? '#0f172a' : '#ffffff' },
        textColor: isDarkMode ? '#94a3b8' : '#334155',
      },
      grid: {
        vertLines: { color: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)' },
        horzLines: { color: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
      },
      rightPriceScale: {
        borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
      },
    });

    chartRef.current = chart;

    // Layer 1: Base Candlesticks
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    // Layer 2: EMA (Cyan)
    const emaSeries = chart.addLineSeries({
      color: '#06b6d4',
      lineWidth: 2,
      title: 'EMA',
    });
    emaSeriesRef.current = emaSeries;

    // Layer 3: JMA (Purple)
    const jmaSeries = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 2,
      title: 'JMA',
    });
    jmaSeriesRef.current = jmaSeries;

    // Layer 4: Modified Heiken Ashi
    const mhaSeries = chart.addCandlestickSeries({
      upColor: 'rgba(56, 189, 248, 0.6)',
      downColor: 'rgba(244, 63, 94, 0.6)',
      borderVisible: false,
      wickUpColor: 'rgba(56, 189, 248, 0.6)',
      wickDownColor: 'rgba(244, 63, 94, 0.6)',
    });
    mhaSeriesRef.current = mhaSeries;

    // ResizeObserver for reliable canvas dimensions & instant auto-fitting
    const resizeObserver = new ResizeObserver((entries) => {
      if (!chartRef.current || entries.length === 0) return;
      const { width: w, height: h } = entries[0].contentRect;
      if (w > 0 && h > 0) {
        requestAnimationFrame(() => {
          chartRef.current?.applyOptions({ width: w, height: h });
          chartRef.current?.timeScale().fitContent();
        });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [isDarkMode]);

  // Update Data & Layers dynamically
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;

    // Layer 1: Base Candles
    if (candles && candles.length > 0) {
      const formattedCandles: CandlestickData<Time>[] = candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      candleSeriesRef.current.setData(formattedCandles);
    }

    // Layer 2: EMA
    if (emaSeriesRef.current) {
      if (toggles.showEma && emaSeries.length > 0) {
        const formattedEma: LineData<Time>[] = emaSeries.map((e) => ({
          time: e.time as Time,
          value: e.value,
        }));
        emaSeriesRef.current.setData(formattedEma);
      } else {
        emaSeriesRef.current.setData([]);
      }
    }

    // Layer 3: JMA
    if (jmaSeriesRef.current) {
      if (toggles.showJma && jmaSeries.length > 0) {
        const formattedJma: LineData<Time>[] = jmaSeries.map((j) => ({
          time: j.time as Time,
          value: j.value,
        }));
        jmaSeriesRef.current.setData(formattedJma);
      } else {
        jmaSeriesRef.current.setData([]);
      }
    }

    // Layer 4: Modified HA
    if (mhaSeriesRef.current) {
      if (toggles.showMha && modifiedHaSeries.length > 0) {
        const formattedMha: CandlestickData<Time>[] = modifiedHaSeries.map((m) => ({
          time: m.time as Time,
          open: m.open,
          high: m.high,
          low: m.low,
          close: m.close,
        }));
        mhaSeriesRef.current.setData(formattedMha);
      } else {
        mhaSeriesRef.current.setData([]);
      }
    }

    // Layer 5: Markers (BUY / SELL)
    if (candleSeriesRef.current) {
      if (toggles.showMarkers && markers.length > 0) {
        const formattedMarkers: SeriesMarker<Time>[] = markers.map((m) => ({
          time: m.time as Time,
          position: m.position,
          color: m.color,
          shape: m.shape,
          text: m.text,
        }));
        candleSeriesRef.current.setMarkers(formattedMarkers);
      } else {
        candleSeriesRef.current.setMarkers([]);
      }
    }

    // Layer 6: Horizontal Price Lines (Entry, SL, Target, Trailing SL)
    if (candleSeriesRef.current && toggles.showPriceLines && priceLines.length > 0) {
      priceLines.forEach((pl) => {
        candleSeriesRef.current?.createPriceLine({
          price: pl.price,
          color: pl.color,
          lineWidth: 1,
          lineStyle: pl.lineStyle !== undefined ? pl.lineStyle : LineStyle.Dashed,
          axisLabelVisible: true,
          title: pl.title,
        });
      });
    }

    // Fit Content & Reset Price Scale to ensure autoscale on index/dataset change
    if (candles && candles.length > 0) {
      requestAnimationFrame(() => {
        if (!chartRef.current) return;
        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        chartRef.current.timeScale().resetTimeScale();
        chartRef.current.timeScale().fitContent();
      });
    }
  }, [candles, emaSeries, jmaSeries, modifiedHaSeries, markers, priceLines, toggles]);

  return (
    <div className="w-full h-full relative group">
      <div ref={containerRef} className="w-full h-full min-h-[550px] rounded-2xl overflow-hidden" />
    </div>
  );
};

export default TradingViewChart;
