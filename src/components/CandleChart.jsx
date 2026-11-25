import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { sma, ema, rsi, bollinger, macd } from "../lib/ohlcv.js";

const COLORS = {
  bg: "#0b0e11",
  text: "#d1d4dc",
  grid: "#1e222d",
  up: "#26a69a",
  down: "#ef5350",
  sma50: "#f5d76e",
  sma200: "#e67e22",
  ema9: "#3498db",
  ema21: "#9b59b6",
  bb: "#7f8c8d",
  rsi: "#e74c3c",
  macd: "#3498db",
  signal: "#e67e22",
  draw: "#00e5ff",
};

export default function CandleChart(props) {
  const bars = props.bars || [];
  const showSma50 = !!props.showSma50;
  const showSma200 = !!props.showSma200;
  const showEma9 = !!props.showEma9;
  const showEma21 = !!props.showEma21;
  const showBb = !!props.showBb;
  const showRsi = !!props.showRsi;
  const showMacd = !!props.showMacd;
  const drawTool = props.drawTool || "none";
  const drawings = props.drawings || [];
  const onAddDrawing = props.onAddDrawing;
  const trendDraft = props.trendDraft;
  const onTrendDraft = props.onTrendDraft;

  const priceRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);
  const seriesRef = useRef({});
  const drawToolRef = useRef(drawTool);
  const draftRef = useRef(trendDraft);
  const onAddRef = useRef(onAddDrawing);
  const onDraftRef = useRef(onTrendDraft);

  useEffect(function () {
    drawToolRef.current = drawTool;
  }, [drawTool]);
  useEffect(function () {
    draftRef.current = trendDraft;
  }, [trendDraft]);
  useEffect(function () {
    onAddRef.current = onAddDrawing;
  }, [onAddDrawing]);
  useEffect(function () {
    onDraftRef.current = onTrendDraft;
  }, [onTrendDraft]);

  // Create charts
  useEffect(
    function () {
      if (!priceRef.current) return;

      const priceChart = createChart(priceRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: COLORS.bg },
          textColor: COLORS.text,
        },
        grid: {
          vertLines: { color: COLORS.grid },
          horzLines: { color: COLORS.grid },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true },
        width: priceRef.current.clientWidth,
        height: priceRef.current.clientHeight,
      });

      const candleSeries = priceChart.addCandlestickSeries({
        upColor: COLORS.up,
        downColor: COLORS.down,
        borderVisible: false,
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
      const bbMid = showBb
        ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, title: "BB mid" })
        : null;
      const bbUpper = showBb
        ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, lineStyle: 2 })
        : null;
      const bbLower = showBb
        ? priceChart.addLineSeries({ color: COLORS.bb, lineWidth: 1, lineStyle: 2 })
        : null;

      let rsiChart = null;
      let rsiSeries = null;
      if (showRsi && rsiRef.current) {
        rsiChart = createChart(rsiRef.current, {
          layout: {
            background: { type: ColorType.Solid, color: COLORS.bg },
            textColor: COLORS.text,
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

      function link(a, b) {
        if (!a || !b) return;
        a.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
          if (range) b.timeScale().setVisibleLogicalRange(range);
        });
      }
      link(priceChart, rsiChart);
      link(rsiChart, priceChart);
      link(priceChart, macdChart);
      link(macdChart, priceChart);

      function clickHandler(param) {
        const tool = drawToolRef.current;
        if (!tool || tool === "none") return;
        if (!param || param.time == null || !param.point) return;
        const price = candleSeries.coordinateToPrice(param.point.y);
        if (price == null || !Number.isFinite(price)) return;
        const time = param.time;
        const draft = draftRef.current;

        if (tool === "hline") {
          if (onAddRef.current) onAddRef.current({ type: "hline", price: price });
          return;
        }
        if (tool === "long" || tool === "short") {
          if (onAddRef.current)
            onAddRef.current({ type: tool, time: time, price: price });
          return;
        }
        if (tool === "trend" || tool === "ray" || tool === "fib" || tool === "rect") {
          if (!draft || !draft.points || !draft.points.length) {
            if (onDraftRef.current)
              onDraftRef.current({ points: [{ time: time, price: price }] });
            return;
          }
          const p0 = draft.points[0];
          if (onAddRef.current) {
            onAddRef.current({
              type: tool,
              t1: p0.time,
              p1: p0.price,
              t2: time,
              p2: price,
            });
          }
          if (onDraftRef.current) onDraftRef.current(null);
        }
      }

      priceChart.subscribeClick(clickHandler);

      function dblHandler() {
        try {
          priceChart.timeScale().fitContent();
        } catch (e) {}
      }
      if (typeof priceChart.subscribeDblClick === "function") {
        try {
          priceChart.subscribeDblClick(dblHandler);
        } catch (e) {}
      }

      seriesRef.current = {
        priceChart: priceChart,
        candle: candleSeries,
        volume: volumeSeries,
        sma50: sma50Series,
        sma200: sma200Series,
        ema9: ema9Series,
        ema21: ema21Series,
        bbMid: bbMid,
        bbUpper: bbUpper,
        bbLower: bbLower,
        rsi: rsiSeries,
        macdLine: macdLineSeries,
        macdSignal: macdSignalSeries,
        macdHist: macdHistSeries,
        rsiChart: rsiChart,
        macdChart: macdChart,
        drawSeries: [],
      };

      function onResize() {
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
      }
      window.addEventListener("resize", onResize);

      return function () {
        window.removeEventListener("resize", onResize);
        try {
          priceChart.unsubscribeClick(clickHandler);
        } catch (e) {}
        if (typeof priceChart.unsubscribeDblClick === "function") {
          try {
            priceChart.unsubscribeDblClick(dblHandler);
          } catch (e) {}
        }
        priceChart.remove();
        if (rsiChart) rsiChart.remove();
        if (macdChart) macdChart.remove();
        seriesRef.current = {};
      };
    },
    [showSma50, showSma200, showEma9, showEma21, showBb, showRsi, showMacd]
  );

  // Apply drawings
  useEffect(
    function () {
      const s = seriesRef.current;
      if (!s.candle || !s.priceChart) return;

      // clear previous draw series
      if (s.drawSeries && s.drawSeries.length) {
        for (let i = 0; i < s.drawSeries.length; i++) {
          try {
            s.priceChart.removeSeries(s.drawSeries[i]);
          } catch (e) {}
        }
      }
      s.drawSeries = [];

      // clear price lines by recreating - use createPriceLine on candle
      // lightweight-charts price lines: remove via series
      // store price line refs
      if (s.priceLines) {
        for (let i = 0; i < s.priceLines.length; i++) {
          try {
            s.candle.removePriceLine(s.priceLines[i]);
          } catch (e) {}
        }
      }
      s.priceLines = [];

      for (let i = 0; i < drawings.length; i++) {
        const d = drawings[i];
        if (d.type === "hline") {
          const pl = s.candle.createPriceLine({
            price: d.price,
            color: COLORS.draw,
            lineWidth: 1,
            lineStyle: 0,
            axisLabelVisible: true,
          });
          s.priceLines.push(pl);
        } else if (d.type === "trend" || d.type === "ray") {
          const line = s.priceChart.addLineSeries({
            color: COLORS.draw,
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          const data = [
            { time: d.t1, value: d.p1 },
            { time: d.t2, value: d.p2 },
          ];
          data.sort(function (a, b) {
            return a.time - b.time;
          });
          line.setData(data);
          s.drawSeries.push(line);
        } else if (d.type === "fib") {
          const hi = Math.max(d.p1, d.p2);
          const lo = Math.min(d.p1, d.p2);
          const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
          for (let j = 0; j < levels.length; j++) {
            const price = hi - (hi - lo) * levels[j];
            const pl = s.candle.createPriceLine({
              price: price,
              color: COLORS.draw,
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: (levels[j] * 100).toFixed(1) + "%",
            });
            s.priceLines.push(pl);
          }
        } else if (d.type === "long" || d.type === "short") {
          const pl = s.candle.createPriceLine({
            price: d.price,
            color: d.type === "long" ? COLORS.up : COLORS.down,
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: d.type.toUpperCase(),
          });
          s.priceLines.push(pl);
        }
      }
    },
    [drawings]
  );

  // Update bar data
  useEffect(
    function () {
      const s = seriesRef.current;
      if (!s.candle || !bars.length) return;

      const candleData = bars.map(function (b) {
        return {
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        };
      });
      const volData = bars.map(function (b) {
        return {
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)",
        };
      });

      s.candle.setData(candleData);
      if (s.volume) s.volume.setData(volData);
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
        const m = macd(bars, 12, 26, 9);
        s.macdLine.setData(m.macdLine);
        s.macdSignal.setData(m.signal);
        s.macdHist.setData(m.hist);
      }

      try {
        s.priceChart.timeScale().fitContent();
      } catch (e) {}
    },
    [bars, showSma50, showSma200, showEma9, showEma21, showBb, showRsi, showMacd]
  );

  return (
    <>
      <div className="chart-panel main">
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
