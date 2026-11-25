import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { sma, rsi } from "../lib/ohlcv.js";

const COLORS = {
  bg: "#12161c",
  text: "#8b9bb4",
  grid: "rgba(148,163,184,0.12)",
  up: "#22c55e",
  down: "#ef4444",
  sma50: "#38bdf8",
  sma200: "#f59e0b",
  rsi: "#a78bfa",
};

/**
 * Free chart surface — Lightweight Charts (Apache-2.0) + your OHLCV.
 * No TradingView widget / no paid data.
 */
export default function CandleChart({ bars, showSma50, showSma200, showRsi }) {
  const priceRef = useRef(null);
  const rsiRef = useRef(null);
  const priceChartRef = useRef(null);
  const rsiChartRef = useRef(null);

  useEffect(() => {
    if (!priceRef.current || !bars?.length) return;

    const priceChart = createChart(priceRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: "IBM Plex Sans, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      width: priceRef.current.clientWidth,
      height: priceRef.current.clientHeight,
    });

    const candleSeries = priceChart.addCandlestickSeries({
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });
    candleSeries.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

    const volumeSeries = priceChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    priceChart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(
      bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
      }))
    );

    if (showSma50) {
      const s = priceChart.addLineSeries({ color: COLORS.sma50, lineWidth: 2, title: "SMA 50" });
      s.setData(sma(bars, 50));
    }
    if (showSma200) {
      const s = priceChart.addLineSeries({ color: COLORS.sma200, lineWidth: 2, title: "SMA 200" });
      s.setData(sma(bars, 200));
    }

    priceChart.timeScale().fitContent();
    priceChartRef.current = priceChart;

    let rsiChart = null;
    if (showRsi && rsiRef.current) {
      rsiChart = createChart(rsiRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: COLORS.bg },
          textColor: COLORS.text,
          fontFamily: "IBM Plex Sans, system-ui, sans-serif",
        },
        grid: {
          vertLines: { color: COLORS.grid },
          horzLines: { color: COLORS.grid },
        },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, visible: false },
        width: rsiRef.current.clientWidth,
        height: rsiRef.current.clientHeight,
      });
      const rsiSeries = rsiChart.addLineSeries({ color: COLORS.rsi, lineWidth: 2 });
      rsiSeries.setData(rsi(bars, 14));
      // 30 / 70 guides via line series baselines — simple markers using area optional
      rsiChart.priceScale("right").applyOptions({ autoScale: true });
      rsiChartRef.current = rsiChart;

      // Sync time scales
      priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) priceChart.timeScale().setVisibleLogicalRange(range);
      });
    }

    const onResize = () => {
      if (priceRef.current) {
        priceChart.applyOptions({
          width: priceRef.current.clientWidth,
          height: priceRef.current.clientHeight,
        });
      }
      if (rsiChart && rsiRef.current) {
        rsiChart.applyOptions({
          width: rsiRef.current.clientWidth,
          height: rsiRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      priceChart.remove();
      if (rsiChart) rsiChart.remove();
      priceChartRef.current = null;
      rsiChartRef.current = null;
    };
  }, [bars, showSma50, showSma200, showRsi]);

  return (
    <>
      <div className="chart-panel">
        <div className="chart-el" ref={priceRef} />
      </div>
      {showRsi ? (
        <div className="chart-panel rsi">
          <div className="chart-el" ref={rsiRef} />
        </div>
      ) : null}
    </>
  );
}
