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
      const markers = (s._vlineMarkers = s._vlineMarkers || []);
      markers.push({ time: d.time, position: "aboveBar", color: COLORS.draw, shape: "arrowDown", text: "" });
      markers.push({ time: d.time, position: "belowBar", color: COLORS.draw, shape: "arrowUp", text: "" });
      try {
        const pos = s._posMarkers || [];
        s.candle.setMarkers([...markers, ...pos].sort((a, b) => (a.time > b.time ? 1 : -1)));
      } catch {}
      s.trendSeries.push({ id: d.id, series: null, kind: "vline" });
      return;
    }

    if (d.type === "long" || d.type === "short") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const markers = (s._posMarkers = s._posMarkers || []);
      markers.push({
        time: d.time,
        position: d.type === "long" ? "belowBar" : "aboveBar",
        color: d.type === "long" ? "#22c55e" : "#ef4444",
        shape: d.type === "long" ? "arrowUp" : "arrowDown",
        text: d.type === "long" ? "L" : "S",
      });
      try {
        const all = [...(s._vlineMarkers || []), ...markers].sort((a, b) => (a.time > b.time ? 1 : -1));
        s.candle.setMarkers(all);
      } catch {}
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
      let t1 = d.t1, p1 = d.p1, t2 = d.t2, p2 = d.p2;
      if (t1 > t2) {
        const tt = t1; t1 = t2; t2 = tt;
        const pp = p1; p1 = p2; p2 = pp;
      }
      const spanT = t2 - t1 || 1;
      const slope = (p2 - p1) / spanT;
      let pts;
      if (d.type === "ray") {
        const t3 = t2 + spanT * 3;
        pts = [
          { time: t1, value: p1 },
          { time: t2, value: p2 },
          { time: t3, value: p1 + slope * (t3 - t1) },
        ];
      } else if (d.type === "extend") {
        const t0 = t1 - spanT * 2;
        const t3 = t2 + spanT * 2;
        pts = [
          { time: t0, value: p1 + slope * (t0 - t1) },
          { time: t1, value: p1 },
          { time: t2, value: p2 },
          { time: t3, value: p1 + slope * (t3 - t1) },
        ].sort((a, b) => a.time - b.time);
      } else {
        pts = [{ time: t1, value: p1 }, { time: t2, value: p2 }];
      }
      try { series.setData(pts); } catch {}
      s.trendSeries.push({ id: d.id, series });
      return;
    }

    if (d.type === "rect") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const hi = Math.max(d.p1, d.p2);
      const lo = Math.min(d.p1, d.p2);
      const tA = Math.min(d.t1, d.t2);
      const tB = Math.max(d.t1, d.t2);
      const top = s.priceChart.addLineSeries({ color: "rgba(34,211,238,0.9)", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      const bot = s.priceChart.addLineSeries({ color: "rgba(34,211,238,0.9)", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      top.setData([{ time: tA, value: hi }, { time: tB, value: hi }]);
      bot.setData([{ time: tA, value: lo }, { time: tB, value: lo }]);
      const pl1 = s.candle.createPriceLine({ price: hi, color: "rgba(34,211,238,0.45)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "R high" });
      const pl2 = s.candle.createPriceLine({ price: lo, color: "rgba(34,211,238,0.45)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "R low" });
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
      const levels = d.type === "fib"
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
          title: d.type === "fib" ? `F ${r}` : `FE ${r}`,
        });
        s.priceLines.push({ id: d.id + "-" + r, line });
      });
      return;
    }

    if (d.type === "channel") {
      if (s.trendSeries.some((x) => x.id === d.id)) return;
      const { t1, p1, t2, p2, t3, p3 } = d;
      const spanT = (t2 - t1) || 1;
      const slope = (p2 - p1) / spanT;
      const expected = p1 + slope * (t3 - t1);
      const offset = p3 - expected;
      const base = s.priceChart.addLineSeries({ color: COLORS.draw, lineWidth: 2, lastValueVisible: false, priceLineVisible: false });
      const par = s.priceChart.addLineSeries({ color: "#a78bfa", lineWidth: 2, lastValueVisible: false, priceLineVisible: false });
      const tA = Math.min(t1, t2, t3);
      const tB = Math.max(t1, t2, t3);
      const tPad = Math.max(1, Math.floor((tB - tA) * 0.15) || 1);
      const ts = [tA - tPad, t1, t2, t3, tB + tPad].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
      base.setData(ts.map((t) => ({ time: t, value: p1 + slope * (t - t1) })));
      par.setData(ts.map((t) => ({ time: t, value: p1 + slope * (t - t1) + offset })));
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
      const tA = Math.min(d.t1, d.t2);
      const tB = Math.max(d.t1, d.t2);
      series.setData([
        { time: tA, value: d.t1 <= d.t2 ? d.p1 : d.p2 },
        { time: tB, value: d.t1 <= d.t2 ? d.p2 : d.p1 },
      ]);
      const pct = d.p1 ? ((d.p2 - d.p1) / Math.abs(d.p1)) * 100 : 0;
      const markers = (s._posMarkers = s._posMarkers || []);
      markers.push({
        time: tB,
        position: "aboveBar",
        color: "#eab308",
        shape: "circle",
        text: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      });
      try {
        const all = [...(s._vlineMarkers || []), ...markers].sort((a, b) => (a.time > b.time ? 1 : -1));
        s.candle.setMarkers(all);
      } catch {}
      s.trendSeries.push({ id: d.id, series });
      return;
    }
  }

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
      const pt = { time: t, price: p };

      if (tool === "hline" || tool === "hline_dot") {
        onAddDrawing?.({ id: `${tool}-${Date.now()}`, type: tool, price: p });
        return;
      }
      if (tool === "vline") {
        onAddDrawing?.({ id: `vl-${Date.now()}`, type: "vline", time: t, price: p });
        return;
      }
      if (tool === "long" || tool === "short") {
        onAddDrawing?.({ id: `${tool}-${Date.now()}`, type: tool, time: t, price: p });
        return;
      }

      // multi-click tools: trend, ray, extend, rect, fib, fibext, measure (2 pts), channel (3 pts)
      const twoClick = ["trend", "ray", "extend", "rect", "fib", "fibext", "measure"];
      const draft = draftRef.current;

      if (twoClick.includes(tool)) {
        if (!draft || !draft.points || draft.points.length === 0) {
          onTrendDraft?.({ points: [pt] });
        } else {
          const a = draft.points[0];
          onAddDrawing?.({
            id: `${tool}-${Date.now()}`,
            type: tool,
            t1: a.time,
            p1: a.price,
            t2: t,
            p2: p,
          });
          onTrendDraft?.(null);
        }
        return;
      }

      if (tool === "channel") {
        if (!draft || !draft.points || draft.points.length === 0) {
          onTrendDraft?.({ points: [pt] });
        } else if (draft.points.length === 1) {
          onTrendDraft?.({ points: [...draft.points, pt] });
        } else {
          const [a, b] = draft.points;
          onAddDrawing?.({
            id: `channel-${Date.now()}`,
            type: "channel",
            t1: a.time,
            p1: a.price,
            t2: b.time,
            p2: b.price,
            t3: t,
            p3: p,
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
    // Keep price lines whose id starts with a live drawing id (fib uses id-0.5 etc.)
    const live = drawings.map((d) => d.id);
    const keepPrice = (id) => live.some((lid) => id === lid || id.startsWith(lid + "-"));
    s.priceLines = s.priceLines.filter(({ id, line }) => {
      if (keepPrice(id)) return true;
      try { s.candle.removePriceLine(line); } catch {}
      return false;
    });
    s.trendSeries = s.trendSeries.filter((entry) => {
      const { id, series, extra, kind } = entry;
      if (live.includes(id)) return true;
      try { if (series) s.priceChart.removeSeries(series); } catch {}
      try { if (extra) s.priceChart.removeSeries(extra); } catch {}
      return false;
    });
    // Rebuild vline markers from remaining vline drawings
    const markers = [];
    drawings.forEach((d) => {
      if (d.type === "vline") {
        markers.push({ time: d.time, position: "aboveBar", color: COLORS.draw, shape: "arrowDown", text: "" });
        markers.push({ time: d.time, position: "belowBar", color: COLORS.draw, shape: "arrowUp", text: "" });
      }
    });
    s._vlineMarkers = markers;
    try {
      s.candle.setMarkers(markers.sort((a, b) => (a.time > b.time ? 1 : -1)));
    } catch {}
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
