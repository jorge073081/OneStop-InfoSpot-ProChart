import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

/**
 * Read-only mini pane for multi-TF split view.
 * Bars update from parent (live + poll).
 */
export default function MiniChart({ bars, label }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;

    const el = ref.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#12161c" },
        textColor: "#8b9bb4",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      width: Math.max(el.clientWidth || 200, 100),
      height: Math.max(el.clientHeight || 160, 120),
    });

    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartRef.current = { chart, series };

    const applySize = () => {
      if (!ref.current || !chartRef.current) return;
      const w = ref.current.clientWidth;
      const h = ref.current.clientHeight;
      if (w > 0 && h > 0) {
        chartRef.current.chart.applyOptions({ width: w, height: h });
      }
    };

    const ro = new ResizeObserver(() => applySize());
    ro.observe(el);
    // second tick after layout
    const t1 = window.setTimeout(applySize, 50);
    const t2 = window.setTimeout(applySize, 250);

    return () => {
      ro.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = chartRef.current;
    if (!s || !bars || !bars.length) return;
    try {
      s.series.setData(
        bars.map((b) => ({
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
      s.chart.timeScale().fitContent();
      if (ref.current) {
        const w = ref.current.clientWidth;
        const h = ref.current.clientHeight;
        if (w > 0 && h > 0) s.chart.applyOptions({ width: w, height: h });
      }
    } catch (_) {}
  }, [bars]);

  return (
    <div className="mini-tf-pane">
      <div className="mini-tf-label">{label || "TF"}</div>
      <div className="mini-tf-el" ref={ref} />
    </div>
  );
}
