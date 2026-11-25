import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { sma, ema, rsi, bollinger, macd } from "../lib/ohlcv.js";

const COLORS = {
  bg: "#12161c",
  text: "#8b9bb4",
  grid: "rgba(148,163,184,0.12)",
  up: "#22c55e",
  down: "#ef4444",
  sma50: "#38bdf8",
  sma200: "#f59e0b",
  ema9: "#f472b6",
  ema21: "#c084fc",
  bb: "rgba(148,163,184,0.55)",
  rsi: "#a78bfa",
  macd: "#22d3ee",
  signal: "#f59e0b",
  histUp: "rgba(34,197,94,0.5)",
  histDown: "rgba(239,68,68,0.5)",
  draw: "#22d3ee",
};

export default function CandleChart({
  bars,
  showSma50,
  showSma200,
  showEma9,
  showEma21,
  showBb,
  showRsi,
  showMacd,
  drawTool = "none",
  drawings = [],
  onAddDrawing,
  trendDraft,
  onTrendDraft,
}) {
  const priceRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);

  const seriesRef = useRef({
    priceChart: null,
    rsiChart: null,
    macdChart: null,
    candle: null,
    volume: null,
    sma50: null,
    sma200: null,
    ema9: null,
    ema21: null,
    bbMid: null,
    bbUpper: null,
    bbLower: null,
    rsi: null,
    macdLine: null,
    macdSignal: null,
    macdHist: null,
    priceLines: [],
    trendSeries: [],
    datasetKey: null,
  });

  const toolRef = useRef(drawTool);
  const draftRef = useRef(trendDraft);
  const drawingsRef = useRef(drawings);
  useEffect(() => { toolRef.current = drawTool; }, [drawTool]);
  useEffect(() => { draftRef.current = trendDraft; }, [trendDraft]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);

  function applyDrawing(d, s) {
    if (!s.candle || !s.priceChart) return;
    if (d.type === "hline") {
      if (s.priceLines.some((x) => x.id === d.id)) return;
      const line = s.candle.createPriceLine({
        price: d.price,
        color: COLORS.draw,
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: String(Number(d.price).toPrecision(6)),
      });
      s.priceLines.push({ id: d.id, line });
    } else if (d.type === "trend") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const series = s.priceChart.addLineSeries({
        color: COLORS.draw,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const pts =
        d.t1 <= d.t2
          ? [{ time: d.t1, value: d.p1 }, { time: d.t2, value: d.p2 }]
          : [{ time: d.t2, value: d.p2 }, { time: d.t1, value: d.p1 }];
      series.setData(pts);
      s.trendSeries.push({ id: d.id, series });
    }
  }

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
    priceChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const sma50Series = showSma50 ? priceChart.addLineSeries({ color: COLORS.sma50, lineWidth: 2, title: "SMA 50" }) : null;
    const sma200Series = showSma200 ? priceChart.addLineSeries({ color: COLORS.sma200, lineWidth: 2, title: "SMA 200" }) : null;
    const ema9Series = showEma9 ? priceChart.addLineSeries({ color: COLORS.ema9, lineWidth: 2, title: "EMA 9" }) : null;
    const ema21Series = showEma21 ? priceChart.addLineSeries({ color: COLORS.ema21, lineWidth: 2, title: "EMA 21" }) : null;
    const bbMid = showBb ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, title: "BB mid" }) : null;
    const bbUpper = showBb ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, lineStyle: 2, title: "BB up" }) : null;
    const bbLower = showBb ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, lineStyle: 2, title: "BB low" }) : null;

    let rsiChart = null;
    let rsiSeries = null;
    if (showRsi && rsiRef.current) {
      rsiChart = createChart(rsiRef.current, {
        layout: { background: { type: ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text, fontFamily: "IBM Plex Sans, system-ui, sans-serif" },
        grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, visible: false },
        width: rsiRef.current.clientWidth,
        height: rsiRef.current.clientHeight,
      });
      rsiSeries = rsiChart.addLineSeries({ color: COLORS.rsi, lineWidth: 2 });
      rsiChart.priceScale("right").applyOptions({ autoScale: true });
    }

    let macdChart = null;
    let macdLineSeries = null;
    let macdSignalSeries = null;
    let macdHistSeries = null;
    if (showMacd && macdRef.current) {
      macdChart = createChart(macdRef.current, {
        layout: { background: { type: ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text, fontFamily: "IBM Plex Sans, system-ui, sans-serif" },
        grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, visible: false },
        width: macdRef.current.clientWidth,
        height: macdRef.current.clientHeight,
      });
      macdHistSeries = macdChart.addHistogramSeries({ priceFormat: { type: "price", precision: 4 } });
      macdLineSeries = macdChart.addLineSeries({ color: COLORS.macd, lineWidth: 2 });
      macdSignalSeries = macdChart.addLineSeries({ color: COLORS.signal, lineWidth: 2 });
    }

    const link = (a, b) => {
      if (!a || !b) return;
      a.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) b.timeScale().setVisibleLogicalRange(range);
      });
    };
    link(priceChart, rsiChart);
    link(rsiChart, priceChart);
    link(priceChart, macdChart);
    link(macdChart, priceChart);
    link(rsiChart, macdChart);
    link(macdChart, rsiChart);

    const clickHandler = (param) => {
      const tool = toolRef.current;
      if (tool === "none" || !param || param.point === undefined || !param.time) return;
      let p = null;
      try {
        p = candleSeries.coordinateToPrice(param.point.y);
      } catch {}
      if (p == null || !Number.isFinite(p)) {
        const sd = param.seriesData.get(candleSeries);
        if (sd && typeof sd.close === "number") p = sd.close;
      }
      if (p == null || !Number.isFinite(p)) return;
      const t = param.time;

      if (tool === "hline") {
        onAddDrawing?.({ id: `hl-${Date.now()}`, type: "hline", price: p });
        return;
      }
      if (tool === "trend") {
        const draft = draftRef.current;
        if (!draft) {
          onTrendDraft?.({ time: t, price: p });
        } else {
          onAddDrawing?.({
            id: `tr-${Date.now()}`,
            type: "trend",
            t1: draft.time,
            p1: draft.price,
            t2: t,
            p2: p,
          });
          onTrendDraft?.(null);
        }
      }
    };
    priceChart.subscribeClick(clickHandler);

    const s = {
      priceChart,
      rsiChart,
      macdChart,
      candle: candleSeries,
      volume: volumeSeries,
      sma50: sma50Series,
      sma200: sma200Series,
      ema9: ema9Series,
      ema21: ema21Series,
      bbMid,
      bbUpper,
      bbLower,
      rsi: rsiSeries,
      macdLine: macdLineSeries,
      macdSignal: macdSignalSeries,
      macdHist: macdHistSeries,
      priceLines: [],
      trendSeries: [],
      datasetKey: null,
    };
    seriesRef.current = s;
    drawingsRef.current.forEach((d) => applyDrawing(d, s));

    const onResize = () => {
      if (priceRef.current) {
        priceChart.applyOptions({ width: priceRef.current.clientWidth, height: priceRef.current.clientHeight });
      }
      if (rsiChart && rsiRef.current) {
        rsiChart.applyOptions({ width: rsiRef.current.clientWidth, height: rsiRef.current.clientHeight });
      }
      if (macdChart && macdRef.current) {
        macdChart.applyOptions({ width: macdRef.current.clientWidth, height: macdRef.current.clientHeight });
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try { priceChart.unsubscribeClick(clickHandler); } catch {}
      priceChart.remove();
      if (rsiChart) rsiChart.remove();
      if (macdChart) macdChart.remove();
      seriesRef.current = {
        priceChart: null, rsiChart: null, macdChart: null,
        candle: null, volume: null, sma50: null, sma200: null,
        ema9: null, ema21: null, bbMid: null, bbUpper: null, bbLower: null,
        rsi: null, macdLine: null, macdSignal: null, macdHist: null,
        priceLines: [], trendSeries: [], datasetKey: null,
      };
    };
  }, [showSma50, showSma200, showEma9, showEma21, showBb, showRsi, showMacd]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candle) return;
    const ids = new Set(drawings.map((d) => d.id));
    s.priceLines = s.priceLines.filter(({ id, line }) => {
      if (ids.has(id)) return true;
      try { s.candle.removePriceLine(line); } catch {}
      return false;
    });
    s.trendSeries = s.trendSeries.filter(({ id, series }) => {
      if (ids.has(id)) return true;
      try { s.priceChart.removeSeries(series); } catch {}
      return false;
    });
    drawings.forEach((d) => applyDrawing(d, s));
  }, [drawings]);

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
      if (s.ema9) s.ema9.setData(ema(bars, 9));
      if (s.ema21) s.ema21.setData(ema(bars, 21));
      if (s.bbMid) {
        const bb = bollinger(bars, 20, 2);
        s.bbMid.setData(bb.mid);
        s.bbUpper.setData(bb.upper);
        s.bbLower.setData(bb.lower);
      }
      if (s.rsi) s.rsi.setData(rsi(bars, 14));
      if (s.macdLine) {
        const m = macd(bars);
        s.macdLine.setData(m.macdLine);
        s.macdSignal.setData(m.signalLine);
        s.macdHist.setData(
          m.hist.map((h) => ({
            time: h.time,
            value: h.value,
            color: h.value >= 0 ? COLORS.histUp : COLORS.histDown,
          }))
        );
      }
      s.priceChart.timeScale().fitContent();
      s.datasetKey = currentKey;
    } else {
      const last = bars[bars.length - 1];
      s.candle.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close });
      s.volume.update({
        time: last.time,
        value: last.volume,
        color: last.close >= last.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
      });
      if (s.sma50) { const d = sma(bars, 50); if (d.length) s.sma50.update(d[d.length - 1]); }
      if (s.sma200) { const d = sma(bars, 200); if (d.length) s.sma200.update(d[d.length - 1]); }
      if (s.ema9) { const d = ema(bars, 9); if (d.length) s.ema9.update(d[d.length - 1]); }
      if (s.ema21) { const d = ema(bars, 21); if (d.length) s.ema21.update(d[d.length - 1]); }
      if (s.rsi) { const d = rsi(bars, 14); if (d.length) s.rsi.update(d[d.length - 1]); }
      if (s.macdLine) {
        const m = macd(bars);
        if (m.macdLine.length) s.macdLine.update(m.macdLine[m.macdLine.length - 1]);
        if (m.signalLine.length) s.macdSignal.update(m.signalLine[m.signalLine.length - 1]);
        if (m.hist.length) {
          const h = m.hist[m.hist.length - 1];
          s.macdHist.update({ time: h.time, value: h.value, color: h.value >= 0 ? COLORS.histUp : COLORS.histDown });
        }
      }
    }
  }, [bars, showSma50, showSma200, showEma9, showEma21, showBb, showRsi, showMacd]);

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
      {showMacd ? (
        <div className="chart-panel rsi">
          <div className="chart-el" ref={macdRef} />
        </div>
      ) : null}
    </>
  );
}
