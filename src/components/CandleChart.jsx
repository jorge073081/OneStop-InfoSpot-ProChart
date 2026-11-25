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

export default function CandleChart({ bars, showSma50, showSma200, showRsi }) {
  const priceRef = useRef(null);
  const rsiRef = useRef(null);

  const seriesRef = useRef({
    priceChart: null,
    rsiChart: null,
    candle: null,
    volume: null,
    sma50: null,
    sma200: null,
    rsi: null,
    datasetKey: null,
  });

  useEffect(() => {
    if (!priceRef.current) return;

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

    const volumeSeries = priceChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    priceChart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const sma50Series = showSma50
      ? priceChart.addLineSeries({ color: COLORS.sma50, lineWidth: 2, title: "SMA 50" })
      : null;

    const sma200Series = showSma200
      ? priceChart.addLineSeries({ color: COLORS.sma200, lineWidth: 2, title: "SMA 200" })
      : null;

    let rsiChart = null;
    let rsiSeries = null;
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
      rsiSeries = rsiChart.addLineSeries({ color: COLORS.rsi, lineWidth: 2 });
      rsiChart.priceScale("right").applyOptions({ autoScale: true });

      priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) priceChart.timeScale().setVisibleLogicalRange(range);
      });
    }

    seriesRef.current = {
      priceChart,
      rsiChart,
      candle: candleSeries,
      volume: volumeSeries,
      sma50: sma50Series,
      sma200: sma200Series,
      rsi: rsiSeries,
      datasetKey: null,
    };

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
      seriesRef.current = {
        priceChart: null,
        rsiChart: null,
        candle: null,
        volume: null,
        sma50: null,
        sma200: null,
        rsi: null,
        datasetKey: null,
      };
    };
  }, [showSma50, showSma200, showRsi]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candle || !bars || bars.length === 0) return;

    const first = bars[0];
    const second = bars[1];
    const currentKey = String(first.time) + "_" + String(second ? second.time : 0) + "_" + String(first.open);

    if (s.datasetKey !== currentKey) {
      s.candle.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      s.volume.setData(
        bars.map((b) => ({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
        }))
      );
      if (s.sma50) s.sma50.setData(sma(bars, 50));
      if (s.sma200) s.sma200.setData(sma(bars, 200));
      if (s.rsi) s.rsi.setData(rsi(bars, 14));

      s.priceChart.timeScale().fitContent();
      s.datasetKey = currentKey;
    } else {
      const last = bars[bars.length - 1];
      s.candle.update({
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
      s.volume.update({
        time: last.time,
        value: last.volume,
        color: last.close >= last.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
      });
      if (s.sma50) {
        const sma50Data = sma(bars, 50);
        if (sma50Data.length) s.sma50.update(sma50Data[sma50Data.length - 1]);
      }
      if (s.sma200) {
        const sma200Data = sma(bars, 200);
        if (sma200Data.length) s.sma200.update(sma200Data[sma200Data.length - 1]);
      }
      if (s.rsi) {
        const rsiData = rsi(bars, 14);
        if (rsiData.length) s.rsi.update(rsiData[rsiData.length - 1]);
      }
    }
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
