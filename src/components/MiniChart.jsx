import { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

/**
 * Read-only mini pane for multi-TF split view.
 * No drawings / no live WS — parent passes bars.
 */
export default function MiniChart({ bars, label, height }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;

    const chart = createChart(ref.current, {
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
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      width: ref.current.clientWidth,
      height: height || ref.current.clientHeight || 160,
    });

    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartRef.current = { chart, series };

    const ro = new ResizeObserver(() => {
      if (!ref.current || !chartRef.current) return;
      chart.applyOptions({
        width: ref.current.clientWidth,
        height: ref.current.clientHeight || height || 160,
      });
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

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
    } catch (_) {}
  }, [bars]);

  return (
    <div className="mini-tf-pane">
      <div className="mini-tf-label">{label}</div>
      <div className="mini-tf-el" ref={ref} />
    </div>
  );
}
