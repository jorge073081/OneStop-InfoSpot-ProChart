import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { sma, ema, rsi, bollinger, macd, stoch, atr, vwap } from "../lib/ohlcv.js";

const VIEWPORT_KEY = "chart_desk_viewport";
const FUTURE_SLOTS = 150;

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

function getBarStep(bars) {
  if (!bars || bars.length < 2) return 86400;
  return bars[bars.length - 1].time - bars[bars.length - 2].time || 86400;
}

function buildPaddedCandles(bars) {
  const real = bars.map(({ time, open, high, low, close }) => ({
    time,
    open,
    high,
    low,
    close,
  }));
  if (real.length < 2) return real;
  const lastTime = real[real.length - 1].time;
  const step = getBarStep(bars);
  for (let i = 1; i <= FUTURE_SLOTS; i++) {
    real.push({ time: lastTime + i * step });
  }
  return real;
}

export default function CandleChart({
  bars,
  showSma50,
  showSma200,
  showEma9,
  showEma21,
  showEma50,
  showBb,
  showVwap,
  showRsi,
  showMacd,
  showStoch,
  showAtr,
  drawTool = "none",
  drawings = [],
  onAddDrawing,
  trendDraft,
  onTrendDraft,
}) {
  const priceRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);
  const stochRef = useRef(null);
  const atrRef = useRef(null);

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
    ema50: null,
    bbMid: null,
    bbUpper: null,
    bbLower: null,
    vwap: null,
    rsi: null,
    macdLine: null,
    macdSignal: null,
    macdHist: null,
    stochK: null,
    stochD: null,
    atr: null,
    priceLines: [],
    trendSeries: [],
    datasetKey: null,
    _vlineMarkers: [],
    _posMarkers: [],
  });

  const barsRef = useRef(bars);
  const toolRef = useRef(drawTool);
  const draftRef = useRef(trendDraft);
  const drawingsRef = useRef(drawings);
  const onAddRef = useRef(onAddDrawing);
  const onDraftRef = useRef(onTrendDraft);
  const isRestoringRef = useRef(false);

  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);
  useEffect(() => {
    toolRef.current = drawTool;
  }, [drawTool]);
  useEffect(() => {
    draftRef.current = trendDraft;
  }, [trendDraft]);
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);
  useEffect(() => {
    onAddRef.current = onAddDrawing;
  }, [onAddDrawing]);
  useEffect(() => {
    onDraftRef.current = onTrendDraft;
  }, [onTrendDraft]);

  function snapToValidTime(rawTime) {
    const list = barsRef.current;
    if (!list || list.length < 2 || rawTime == null) return rawTime;
    const firstTime = list[0].time;
    const lastTime = list[list.length - 1].time;
    const step = getBarStep(list);

    if (rawTime <= firstTime) return firstTime;
    if (rawTime <= lastTime) {
      let best = list[0].time;
      let bestDiff = Math.abs(rawTime - best);
      for (let i = 1; i < list.length; i++) {
        const diff = Math.abs(rawTime - list[i].time);
        if (diff < bestDiff) {
          best = list[i].time;
          bestDiff = diff;
        }
      }
      return best;
    }

    const offset = Math.max(1, Math.min(FUTURE_SLOTS, Math.round((rawTime - lastTime) / step)));
    return lastTime + offset * step;
  }

  function getClickTime(param, priceChart) {
    if (param && param.time != null) return snapToValidTime(param.time);
    const list = barsRef.current;
    if (!param || !param.point || !list || list.length < 2) return null;

    const logical = priceChart.timeScale().coordinateToLogical(param.point.x);
    if (logical == null || !Number.isFinite(logical)) return null;

    const idx = Math.round(logical);
    const lastIdx = list.length - 1;
    const step = getBarStep(list);

    if (idx < 0) return list[0].time;
    if (idx > lastIdx) {
      const clampedOffset = Math.min(FUTURE_SLOTS, idx - lastIdx);
      return list[lastIdx].time + clampedOffset * step;
    }
    return list[idx].time;
  }

  function applyDrawing(d, s) {
    if (!s.candle || !s.priceChart || !d) return;

    if (d.type === "hline" || d.type === "hline_dot") {
      if (s.priceLines.some((x) => x.id === d.id)) return;
      const line = s.candle.createPriceLine({
        price: d.price,
        color: d.type === "hline_dot" ? "#a78bfa" : COLORS.draw,
        lineWidth: 2,
        lineStyle: d.type === "hline_dot" ? 2 : 0,
        axisLabelVisible: true,
        title: String(Number(d.price).toPrecision(6)),
      });
      s.priceLines.push({ id: d.id, line });
      return;
    }

    if (d.type === "vline") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const t = snapToValidTime(d.time);
      s._vlineMarkers = s._vlineMarkers || [];
      s._vlineMarkers.push({
        time: t,
        position: "aboveBar",
        color: COLORS.draw,
        shape: "arrowDown",
        text: "",
      });
      s._vlineMarkers.push({
        time: t,
        position: "belowBar",
        color: COLORS.draw,
        shape: "arrowUp",
        text: "",
      });
      try {
        const all = [...s._vlineMarkers, ...(s._posMarkers || [])].sort((a, b) =>
          a.time > b.time ? 1 : -1
        );
        s.candle.setMarkers(all);
      } catch (_) {}
      s.trendSeries.push({ id: d.id, series: null, kind: "vline" });
      return;
    }

    if (d.type === "long" || d.type === "short") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const t = snapToValidTime(d.time);
      s._posMarkers = s._posMarkers || [];
      s._posMarkers.push({
        time: t,
        position: d.type === "long" ? "belowBar" : "aboveBar",
        color: d.type === "long" ? "#22c55e" : "#ef4444",
        shape: d.type === "long" ? "arrowUp" : "arrowDown",
        text: d.type === "long" ? "L" : "S",
      });
      try {
        const all = [...(s._vlineMarkers || []), ...s._posMarkers].sort((a, b) =>
          a.time > b.time ? 1 : -1
        );
        s.candle.setMarkers(all);
      } catch (_) {}
      s.trendSeries.push({ id: d.id, series: null, kind: d.type });
      return;
    }

    if (d.type === "trend" || d.type === "ray" || d.type === "extend") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const series = s.priceChart.addLineSeries({
        color: COLORS.draw,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      let t1 = snapToValidTime(d.t1);
      let p1 = d.p1;
      let t2 = snapToValidTime(d.t2);
      let p2 = d.p2;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        const pp = p1;
        p1 = p2;
        p2 = pp;
      }
      if (t1 === t2) {
        t2 = snapToValidTime(t1 + getBarStep(barsRef.current));
      }
      const spanT = t2 - t1 || 1;
      const slope = (p2 - p1) / spanT;
      let pts;
      if (d.type === "ray") {
        const t3 = snapToValidTime(t2 + spanT * 4);
        pts = [
          { time: t1, value: p1 },
          { time: t2, value: p2 },
          ...(t3 > t2 ? [{ time: t3, value: p1 + slope * (t3 - t1) }] : []),
        ];
      } else if (d.type === "extend") {
        const t0 = snapToValidTime(t1 - spanT * 3);
        const t3 = snapToValidTime(t2 + spanT * 3);
        pts = [
          ...(t0 < t1 ? [{ time: t0, value: p1 + slope * (t0 - t1) }] : []),
          { time: t1, value: p1 },
          { time: t2, value: p2 },
          ...(t3 > t2 ? [{ time: t3, value: p1 + slope * (t3 - t1) }] : []),
        ];
      } else {
        pts = [
          { time: t1, value: p1 },
          { time: t2, value: p2 },
        ];
      }
      try {
        series.setData(pts);
      } catch (_) {}
      s.trendSeries.push({ id: d.id, series });
      return;
    }

    if (d.type === "rect") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const hi = Math.max(d.p1, d.p2);
      const lo = Math.min(d.p1, d.p2);
      let tA = snapToValidTime(Math.min(d.t1, d.t2));
      let tB = snapToValidTime(Math.max(d.t1, d.t2));
      if (tA === tB) {
        tB = snapToValidTime(tA + getBarStep(barsRef.current));
      }
      const top = s.priceChart.addLineSeries({
        color: "rgba(34,211,238,0.9)",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const bot = s.priceChart.addLineSeries({
        color: "rgba(34,211,238,0.9)",
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      try {
        top.setData([
          { time: tA, value: hi },
          { time: tB, value: hi },
        ]);
        bot.setData([
          { time: tA, value: lo },
          { time: tB, value: lo },
        ]);
      } catch (_) {}
      const pl1 = s.candle.createPriceLine({
        price: hi,
        color: "rgba(34,211,238,0.45)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "R high",
      });
      const pl2 = s.candle.createPriceLine({
        price: lo,
        color: "rgba(34,211,238,0.45)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "R low",
      });
      s.priceLines.push({ id: d.id + "-h", line: pl1 });
      s.priceLines.push({ id: d.id + "-l", line: pl2 });
      s.trendSeries.push({ id: d.id, series: top, extra: bot });
      return;
    }

    if (d.type === "fib" || d.type === "fibext") {
      if (s.priceLines.some((x) => x.id === d.id + "-0")) return;
      const hi = Math.max(d.p1, d.p2);
      const lo = Math.min(d.p1, d.p2);
      const span = hi - lo;
      if (!(span > 0)) return;
      const levels =
        d.type === "fib"
          ? [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
          : [0, 0.618, 1, 1.272, 1.618, 2.0, 2.618];
      const colors = ["#94a3b8", "#38bdf8", "#22d3ee", "#eab308", "#f97316", "#ef4444", "#a78bfa"];
      levels.forEach((r, i) => {
        const price = d.type === "fib" ? hi - span * r : lo + span * r;
        const line = s.candle.createPriceLine({
          price,
          color: colors[i % colors.length],
          lineWidth: r === 0.5 || r === 0.618 || r === 1.618 ? 2 : 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: d.type === "fib" ? "F " + r : "FE " + r,
        });
        s.priceLines.push({ id: d.id + "-" + r, line });
      });
      return;
    }

    if (d.type === "channel") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const t1 = snapToValidTime(d.t1);
      const p1 = d.p1;
      let t2 = snapToValidTime(d.t2);
      const p2 = d.p2;
      const t3 = snapToValidTime(d.t3);
      const p3 = d.p3;
      if (t1 === t2) t2 = snapToValidTime(t1 + getBarStep(barsRef.current));
      const spanT = t2 - t1 || 1;
      const slope = (p2 - p1) / spanT;
      const expected = p1 + slope * (t3 - t1);
      const offset = p3 - expected;
      const base = s.priceChart.addLineSeries({
        color: COLORS.draw,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const par = s.priceChart.addLineSeries({
        color: "#a78bfa",
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const tA = Math.min(t1, t2, t3);
      const tB = Math.max(t1, t2, t3);
      const tPad = Math.max(getBarStep(barsRef.current), Math.floor((tB - tA) * 0.15));
      const raw = [snapToValidTime(tA - tPad), t1, t2, t3, snapToValidTime(tB + tPad)];
      const ts = raw.filter((v, i, a) => v != null && a.indexOf(v) === i).sort((a, b) => a - b);
      try {
        base.setData(ts.map((t) => ({ time: t, value: p1 + slope * (t - t1) })));
        par.setData(ts.map((t) => ({ time: t, value: p1 + slope * (t - t1) + offset })));
      } catch (_) {}
      s.trendSeries.push({ id: d.id, series: base, extra: par });
      return;
    }

    if (d.type === "measure") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const series = s.priceChart.addLineSeries({
        color: "#eab308",
        lineWidth: 2,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const t1 = snapToValidTime(d.t1);
      let t2 = snapToValidTime(d.t2);
      if (t1 === t2) t2 = snapToValidTime(t1 + getBarStep(barsRef.current));
      const tA = Math.min(t1, t2);
      const tB = Math.max(t1, t2);
      try {
        series.setData([
          { time: tA, value: t1 <= t2 ? d.p1 : d.p2 },
          { time: tB, value: t1 <= t2 ? d.p2 : d.p1 },
        ]);
      } catch (_) {}
      const pct = d.p1 ? ((d.p2 - d.p1) / Math.abs(d.p1)) * 100 : 0;
      s._posMarkers = s._posMarkers || [];
      s._posMarkers.push({
        time: tB,
        position: "aboveBar",
        color: "#eab308",
        shape: "circle",
        text: (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%",
      });
      try {
        const all = [...(s._vlineMarkers || []), ...s._posMarkers].sort((a, b) =>
          a.time > b.time ? 1 : -1
        );
        s.candle.setMarkers(all);
      } catch (_) {}
      s.trendSeries.push({ id: d.id, series });
    }
  }

  // Create charts once when indicator layout changes
  useEffect(() => {
    const container = priceRef.current;
    if (!container) return;

    const priceChart = createChart(container, {
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
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const saveViewport = (range) => {
      if (isRestoringRef.current) return;
      if (range && range.from != null && range.to != null) {
        try {
          localStorage.setItem(VIEWPORT_KEY, JSON.stringify(range));
        } catch (_) {}
      }
    };
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(saveViewport);

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
    const ema9Series = showEma9
      ? priceChart.addLineSeries({ color: COLORS.ema9, lineWidth: 2, title: "EMA 9" })
      : null;
    const ema21Series = showEma21
      ? priceChart.addLineSeries({ color: COLORS.ema21, lineWidth: 2, title: "EMA 21" })
      : null;
    const ema50Series = showEma50
      ? priceChart.addLineSeries({ color: "#34d399", lineWidth: 2, title: "EMA 50" })
      : null;
    const vwapSeries = showVwap
      ? priceChart.addLineSeries({ color: "#f472b6", lineWidth: 2, title: "VWAP" })
      : null;
    const bbMid = showBb
      ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, title: "BB mid" })
      : null;
    const bbUpper = showBb
      ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, lineStyle: 2, title: "BB up" })
      : null;
    const bbLower = showBb
      ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, lineStyle: 2, title: "BB low" })
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
    }

    let macdChart = null;
    let macdLineSeries = null;
    let macdSignalSeries = null;
    let macdHistSeries = null;
    if (showMacd && macdRef.current) {
      macdChart = createChart(macdRef.current, {
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
        width: macdRef.current.clientWidth,
        height: macdRef.current.clientHeight,
      });
      macdHistSeries = macdChart.addHistogramSeries({
        priceFormat: { type: "price", precision: 4 },
      });
      macdLineSeries = macdChart.addLineSeries({ color: COLORS.macd, lineWidth: 2 });
      macdSignalSeries = macdChart.addLineSeries({ color: COLORS.signal, lineWidth: 2 });
    }

    let stochChart = null;
    let stochKSeries = null;
    let stochDSeries = null;
    if (showStoch && stochRef.current) {
      stochChart = createChart(stochRef.current, {
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
        width: stochRef.current.clientWidth,
        height: stochRef.current.clientHeight,
      });
      stochKSeries = stochChart.addLineSeries({ color: "#22d3ee", lineWidth: 2 });
      stochDSeries = stochChart.addLineSeries({ color: "#f59e0b", lineWidth: 2 });
    }

    let atrChart = null;
    let atrSeries = null;
    if (showAtr && atrRef.current) {
      atrChart = createChart(atrRef.current, {
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
        width: atrRef.current.clientWidth,
        height: atrRef.current.clientHeight,
      });
      atrSeries = atrChart.addLineSeries({ color: "#fb7185", lineWidth: 2 });
    }

    const link = (a, b) => {
      if (!a || !b) return;
      a.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) b.timeScale().setVisibleLogicalRange(range);
      });
    };
    const panes = [priceChart, rsiChart, macdChart, stochChart, atrChart].filter(Boolean);
    panes.forEach((a) => panes.forEach((b) => { if (a !== b) link(a, b); }));

    const clickHandler = (param) => {
      const tool = toolRef.current;
      if (tool === "none" || !param || param.point === undefined) return;

      const t = getClickTime(param, priceChart);
      if (t == null) return;

      let p = null;
      try {
        p = candleSeries.coordinateToPrice(param.point.y);
      } catch (_) {}
      if (p == null || !Number.isFinite(p)) {
        const sd = param.seriesData.get(candleSeries);
        if (sd && typeof sd.close === "number") p = sd.close;
      }
      if (p == null || !Number.isFinite(p)) return;

      const pt = { time: t, price: p };

      if (tool === "hline" || tool === "hline_dot") {
        onAddRef.current?.({ id: tool + "-" + Date.now(), type: tool, price: p });
        return;
      }
      if (tool === "vline") {
        onAddRef.current?.({ id: "vl-" + Date.now(), type: "vline", time: t, price: p });
        return;
      }
      if (tool === "long" || tool === "short") {
        onAddRef.current?.({ id: tool + "-" + Date.now(), type: tool, time: t, price: p });
        return;
      }

      const twoClick = ["trend", "ray", "extend", "rect", "fib", "fibext", "measure"];
      const draft = draftRef.current;

      if (twoClick.includes(tool)) {
        if (!draft || !draft.points || draft.points.length === 0) {
          onDraftRef.current?.({ points: [pt] });
        } else {
          const a = draft.points[0];
          onAddRef.current?.({
            id: tool + "-" + Date.now(),
            type: tool,
            t1: a.time,
            p1: a.price,
            t2: t,
            p2: p,
          });
          onDraftRef.current?.(null);
        }
        return;
      }

      if (tool === "channel") {
        if (!draft || !draft.points || draft.points.length === 0) {
          onDraftRef.current?.({ points: [pt] });
        } else if (draft.points.length === 1) {
          onDraftRef.current?.({ points: [...draft.points, pt] });
        } else {
          const a = draft.points[0];
          const b = draft.points[1];
          onAddRef.current?.({
            id: "channel-" + Date.now(),
            type: "channel",
            t1: a.time,
            p1: a.price,
            t2: b.time,
            p2: b.price,
            t3: t,
            p3: p,
          });
          onDraftRef.current?.(null);
        }
      }
    };

    priceChart.subscribeClick(clickHandler);

    // Double-click -> reset saved zoom & frame candles + 20 future bar slots
    const dblHandler = () => {
      try {
        localStorage.removeItem(VIEWPORT_KEY);
        const totalBars = barsRef.current?.length || 100;
        priceChart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, totalBars - 120),
          to: totalBars + 20,
        });
        priceChart.priceScale("right").applyOptions({ autoScale: true });
      } catch (_) {}
    };
    try {
      priceChart.subscribeDblClick(dblHandler);
    } catch (_) {}
    container.addEventListener("dblclick", dblHandler);

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
      ema50: ema50Series,
      bbMid,
      bbUpper,
      bbLower,
      vwap: vwapSeries,
      rsi: rsiSeries,
      macdLine: macdLineSeries,
      macdSignal: macdSignalSeries,
      macdHist: macdHistSeries,
      stochK: stochKSeries,
      stochD: stochDSeries,
      atr: atrSeries,
      stochChart,
      atrChart,
      priceLines: [],
      trendSeries: [],
      datasetKey: null,
      _vlineMarkers: [],
      _posMarkers: [],
    };
    seriesRef.current = s;

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
      if (macdChart && macdRef.current) {
        macdChart.applyOptions({
          width: macdRef.current.clientWidth,
          height: macdRef.current.clientHeight,
        });
      }
      if (stochChart && stochRef.current) {
        stochChart.applyOptions({
          width: stochRef.current.clientWidth,
          height: stochRef.current.clientHeight,
        });
      }
      if (atrChart && atrRef.current) {
        atrChart.applyOptions({
          width: atrRef.current.clientWidth,
          height: atrRef.current.clientHeight,
        });
      }
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    window.addEventListener("resize", onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      container.removeEventListener("dblclick", dblHandler);
      try {
        priceChart.timeScale().unsubscribeVisibleLogicalRangeChange(saveViewport);
      } catch (_) {}
      try {
        priceChart.unsubscribeClick(clickHandler);
      } catch (_) {}
      try {
        priceChart.unsubscribeDblClick(dblHandler);
      } catch (_) {}
      priceChart.remove();
      if (rsiChart) rsiChart.remove();
      if (macdChart) macdChart.remove();
      if (stochChart) stochChart.remove();
      if (atrChart) atrChart.remove();
      seriesRef.current = {
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
        _vlineMarkers: [],
        _posMarkers: [],
      };
    };
  }, [showSma50, showSma200, showEma9, showEma21, showEma50, showBb, showVwap, showRsi, showMacd, showStoch, showAtr]);

  // Sync drawings list
  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candle || !bars || bars.length === 0) return;

    const live = drawings.map((d) => d.id);
    const keepPrice = (id) => live.some((lid) => id === lid || String(id).startsWith(lid + "-"));

    s.priceLines = s.priceLines.filter(({ id, line }) => {
      if (keepPrice(id)) return true;
      try {
        s.candle.removePriceLine(line);
      } catch (_) {}
      return false;
    });

    s.trendSeries = s.trendSeries.filter((entry) => {
      if (live.includes(entry.id)) return true;
      try {
        if (entry.series) s.priceChart.removeSeries(entry.series);
      } catch (_) {}
      try {
        if (entry.extra) s.priceChart.removeSeries(entry.extra);
      } catch (_) {}
      return false;
    });

    s._vlineMarkers = [];
    s._posMarkers = [];
    drawings.forEach((d) => {
      if (d.type === "vline") {
        const t = snapToValidTime(d.time);
        s._vlineMarkers.push({
          time: t,
          position: "aboveBar",
          color: COLORS.draw,
          shape: "arrowDown",
          text: "",
        });
        s._vlineMarkers.push({
          time: t,
          position: "belowBar",
          color: COLORS.draw,
          shape: "arrowUp",
          text: "",
        });
      }
      if (d.type === "long" || d.type === "short") {
        const t = snapToValidTime(d.time);
        s._posMarkers.push({
          time: t,
          position: d.type === "long" ? "belowBar" : "aboveBar",
          color: d.type === "long" ? "#22c55e" : "#ef4444",
          shape: d.type === "long" ? "arrowUp" : "arrowDown",
          text: d.type === "long" ? "L" : "S",
        });
      }
      if (d.type === "measure") {
        const tB = snapToValidTime(Math.max(d.t1, d.t2));
        const pct = d.p1 ? ((d.p2 - d.p1) / Math.abs(d.p1)) * 100 : 0;
        s._posMarkers.push({
          time: tB,
          position: "aboveBar",
          color: "#eab308",
          shape: "circle",
          text: (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%",
        });
      }
    });
    try {
      const all = [...s._vlineMarkers, ...s._posMarkers].sort((a, b) => (a.time > b.time ? 1 : -1));
      s.candle.setMarkers(all);
    } catch (_) {}

    drawings.forEach((d) => applyDrawing(d, s));
  }, [drawings, bars]);

  // Bars / live updates
  useEffect(() => {
    const s = seriesRef.current;
    if (!s.candle || !bars || bars.length === 0) return;

    const first = bars[0];
    const second = bars[1];
    const currentKey =
      String(first.time) + "_" + String(second ? second.time : 0) + "_" + String(first.open);

    if (s.datasetKey !== currentKey) {
      isRestoringRef.current = true;
      s.candle.setData(buildPaddedCandles(bars));
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
      if (s.ema50) s.ema50.setData(ema(bars, 50));
      if (s.vwap) s.vwap.setData(vwap(bars));
      if (s.bbMid) {
        const bb = bollinger(bars, 20, 2);
        s.bbMid.setData(bb.mid);
        s.bbUpper.setData(bb.upper);
        s.bbLower.setData(bb.lower);
      }
      if (s.rsi) s.rsi.setData(rsi(bars, 14));
      if (s.stochK) {
        const st = stoch(bars, 14, 3);
        s.stochK.setData(st.k);
        s.stochD.setData(st.d);
      }
      if (s.atr) s.atr.setData(atr(bars, 14));
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

      // Restore saved zoom/pan or frame candles + 20 future slots
      let restored = false;
      try {
        const saved = localStorage.getItem(VIEWPORT_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.from != null && parsed.to != null) {
            s.priceChart.timeScale().setVisibleLogicalRange(parsed);
            restored = true;
          }
        }
      } catch (_) {}

      if (!restored) {
        s.priceChart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, bars.length - 120),
          to: bars.length + 20,
        });
      }

      s.datasetKey = currentKey;
      setTimeout(() => {
        isRestoringRef.current = false;
      }, 50);

      // Re-apply drawings now that padded candles exist
      (drawingsRef.current || []).forEach((d) => applyDrawing(d, s));
    } else {
      // Safe live update that preserves trailing future whitespace slots
      // and keeps the user's pan/zoom (do not fitContent on every tick)
      let prevRange = null;
      try {
        prevRange = s.priceChart.timeScale().getVisibleLogicalRange();
      } catch (_) {}

      s.candle.setData(buildPaddedCandles(bars));

      if (prevRange) {
        try {
          s.priceChart.timeScale().setVisibleLogicalRange(prevRange);
        } catch (_) {}
      }

      const last = bars[bars.length - 1];
      try {
        s.volume.update({
          time: last.time,
          value: last.volume,
          color: last.close >= last.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
        });
      } catch (_) {}
      if (s.sma50) {
        const d = sma(bars, 50);
        if (d.length) try { s.sma50.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.sma200) {
        const d = sma(bars, 200);
        if (d.length) try { s.sma200.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.ema9) {
        const d = ema(bars, 9);
        if (d.length) try { s.ema9.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.ema21) {
        const d = ema(bars, 21);
        if (d.length) try { s.ema21.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.ema50) {
        const d = ema(bars, 50);
        if (d.length) try { s.ema50.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.vwap) {
        const d = vwap(bars);
        if (d.length) try { s.vwap.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.stochK) {
        const st = stoch(bars, 14, 3);
        if (st.k.length) try { s.stochK.update(st.k[st.k.length - 1]); } catch (_) {}
        if (st.d.length) try { s.stochD.update(st.d[st.d.length - 1]); } catch (_) {}
      }
      if (s.atr) {
        const d = atr(bars, 14);
        if (d.length) try { s.atr.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.rsi) {
        const d = rsi(bars, 14);
        if (d.length) try { s.rsi.update(d[d.length - 1]); } catch (_) {}
      }
      if (s.macdLine) {
        const m = macd(bars);
        if (m.macdLine.length) try { s.macdLine.update(m.macdLine[m.macdLine.length - 1]); } catch (_) {}
        if (m.signalLine.length) try { s.macdSignal.update(m.signalLine[m.signalLine.length - 1]); } catch (_) {}
        if (m.hist.length) {
          const h = m.hist[m.hist.length - 1];
          try {
            s.macdHist.update({
              time: h.time,
              value: h.value,
              color: h.value >= 0 ? COLORS.histUp : COLORS.histDown,
            });
          } catch (_) {}
        }
      }
    }
  }, [bars, showSma50, showSma200, showEma9, showEma21, showEma50, showBb, showVwap, showRsi, showMacd, showStoch, showAtr]);

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
      {showStoch ? (
        <div className="chart-panel rsi">
          <div className="chart-el" ref={stochRef} />
        </div>
      ) : null}
      {showAtr ? (
        <div className="chart-panel rsi">
          <div className="chart-el" ref={atrRef} />
        </div>
      ) : null}
    </>
  );
}
