import { useCallback, useEffect, useMemo, useState } from "react";
import CandleChart from "./components/CandleChart.jsx";
import { fetchOHLCV, toCoinbaseProduct } from "./lib/ohlcv.js";
import { INTERVALS, displaySymbol, normalizeSymbol } from "./lib/symbols.js";

const INTERVAL_SECONDS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** Multi-TF bias from close vs SMA20. Returns "bull" | "bear" | "neutral" | null */
function tfBias(bars) {
  if (!bars || bars.length < 25) return null;
  let sum = 0;
  const n = 20;
  for (let i = bars.length - n; i < bars.length; i++) sum += bars[i].close;
  const sma = sum / n;
  const close = bars[bars.length - 1].close;
  if (close > sma * 1.001) return "bull";
  if (close < sma * 0.999) return "bear";
  return "neutral";
}

function alignmentSummary(b15, b1h, b4h) {
  const parts = [
    { tf: "15m", bias: b15 },
    { tf: "1H", bias: b1h },
    { tf: "4H", bias: b4h },
  ];
  const known = parts.filter((p) => p.bias);
  if (!known.length) {
    return { label: "TF —", title: "Alignment loading or unavailable", tone: "muted" };
  }
  const bulls = known.filter((p) => p.bias === "bull").length;
  const bears = known.filter((p) => p.bias === "bear").length;
  const detail = parts
    .map((p) => {
      const arrow = p.bias === "bull" ? "↑" : p.bias === "bear" ? "↓" : p.bias === "neutral" ? "→" : "·";
      return p.tf + arrow;
    })
    .join(" ");
  if (bulls === known.length && bulls >= 2) {
    return { label: "ALIGNED ↑", title: detail + " (all bullish vs SMA20)", tone: "up" };
  }
  if (bears === known.length && bears >= 2) {
    return { label: "ALIGNED ↓", title: detail + " (all bearish vs SMA20)", tone: "down" };
  }
  if (bulls >= 2) {
    return { label: "LEAN ↑", title: detail, tone: "up" };
  }
  if (bears >= 2) {
    return { label: "LEAN ↓", title: detail, tone: "down" };
  }
  return { label: "MIXED", title: detail, tone: "muted" };
}


function readParams() {
  const q = new URLSearchParams(window.location.search);
  const symbol = normalizeSymbol(q.get("symbol") || q.get("ticker") || "BTCUSDT");
  const interval = q.get("interval") || q.get("tf") || "1d";
  const valid = INTERVALS.some((i) => i.id === interval) ? interval : "1d";
  return { symbol, interval: valid };
}

function writeParams(symbol, interval) {
  const q = new URLSearchParams();
  q.set("symbol", symbol);
  q.set("interval", interval);
  const url = `${window.location.pathname}?${q.toString()}`;
  window.history.replaceState({}, "", url);
}

const TOOL_GROUPS = [
  [
    {
      id: "none",
      label: "Crosshair / Navigate",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 2v20M2 12h20" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      ),
    },
  ],
  [
    {
      id: "hline",
      label: "Horizontal Line",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="3" y1="12" x2="21" y2="12" />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: "hline_dot",
      label: "Dashed Horizontal Level",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3">
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      ),
    },
    {
      id: "vline",
      label: "Vertical Line",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="12" y1="3" x2="12" y2="21" />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
        </svg>
      ),
    },
  ],
  [
    {
      id: "trend",
      label: "Trend Line",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="4" y1="19" x2="20" y2="5" />
          <circle cx="4" cy="19" r="2.2" fill="currentColor" />
          <circle cx="20" cy="5" r="2.2" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: "ray",
      label: "Ray (Forward Extension)",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="4" y1="19" x2="21" y2="4" />
          <circle cx="4" cy="19" r="2.2" fill="currentColor" />
          <circle cx="13" cy="11" r="2" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: "extend",
      label: "Extended Line",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="2" y1="21" x2="22" y2="3" />
          <circle cx="8" cy="15.5" r="2" fill="currentColor" />
          <circle cx="16" cy="8.5" r="2" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: "channel",
      label: "Parallel Channel",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="3" y1="15" x2="18" y2="4" />
          <line x1="6" y1="20" x2="21" y2="9" />
        </svg>
      ),
    },
  ],
  [
    {
      id: "rect",
      label: "Rectangle / Zone",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="6" width="16" height="12" rx="1.5" fill="currentColor" fillOpacity="0.12" />
        </svg>
      ),
    },
    {
      id: "fib",
      label: "Fibonacci Retracement",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <line x1="3" y1="5" x2="21" y2="5" />
          <line x1="3" y1="10" x2="21" y2="10" strokeDasharray="2 2" />
          <line x1="3" y1="14.5" x2="21" y2="14.5" strokeDasharray="2 2" />
          <line x1="3" y1="19" x2="21" y2="19" />
        </svg>
      ),
    },
    {
      id: "fibext",
      label: "Fibonacci Extension",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M4 18L11 9L16 13" />
          <line x1="12" y1="4" x2="21" y2="4" />
          <line x1="12" y1="8" x2="21" y2="8" strokeDasharray="2 2" />
          <line x1="12" y1="19" x2="21" y2="19" />
        </svg>
      ),
    },
    {
      id: "measure",
      label: "Price & % Measure",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="8" width="18" height="8" rx="1.5" />
          <line x1="7" y1="8" x2="7" y2="11" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="17" y1="8" x2="17" y2="11" />
        </svg>
      ),
    },
  ],
  [
    {
      id: "long",
      label: "Long Entry Marker",
      extraClass: "long-btn",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
        </svg>
      ),
    },
    {
      id: "short",
      label: "Short Entry Marker",
      extraClass: "short-btn",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M12 5v14" />
          <path d="M6 13l6 6 6-6" />
        </svg>
      ),
    },
  ],
];

export default function App() {
  const initial = useMemo(() => readParams(), []);
  const [symbolInput, setSymbolInput] = useState(displaySymbol(initial.symbol));
  const [symbol, setSymbol] = useState(initial.symbol);
  const [interval, setInterval] = useState(initial.interval);
  const [bars, setBars] = useState([]);
  const [dataSource, setDataSource] = useState("coinbase");
  const [status, setStatus] = useState("Loading…");
  const [liveState, setLiveState] = useState("Connecting…");
  const [error, setError] = useState("");
  const [alignInfo, setAlignInfo] = useState({ label: "TF —", title: "Multi-TF alignment", tone: "muted" });
  const [showIndBox, setShowIndBox] = useState(false);
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(false);
  const [showEma9, setShowEma9] = useState(false);
  const [showEma21, setShowEma21] = useState(false);
  const [showEma50, setShowEma50] = useState(false);
  const [showBb, setShowBb] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);
  const [showStoch, setShowStoch] = useState(false);
  const [showAtr, setShowAtr] = useState(false);

  const [drawTool, setDrawTool] = useState("none");
  const [drawings, setDrawings] = useState(() => {
    try {
      const saved = localStorage.getItem(`chart_desk_drawings_${initial.symbol}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [trendDraft, setTrendDraft] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(`chart_desk_drawings_${symbol}`, JSON.stringify(drawings));
    } catch {}
  }, [drawings, symbol]);

  const load = useCallback(async (sym, tf) => {
    setStatus("Loading…");
    setError("");
    setTrendDraft(null);
    setDrawTool("none");
    try {
      const saved = localStorage.getItem(`chart_desk_drawings_${sym}`);
      setDrawings(saved ? JSON.parse(saved) : []);
    } catch {
      setDrawings([]);
    }

    try {
      const binanceInterval = INTERVALS.find((i) => i.id === tf)?.binance || "1d";
      const { bars: data, source } = await fetchOHLCV(sym, binanceInterval, 500);
      setBars(data);
      setDataSource(source);
      writeParams(sym, tf);
      const last = data[data.length - 1];
      const prev = data[data.length - 2];
      const chg = prev ? ((last.close / prev.close - 1) * 100).toFixed(2) : "0.00";
      const sign = Number(chg) >= 0 ? "+" : "";
      setStatus(`${displaySymbol(sym)} · ${tf.toUpperCase()} · last ${last.close} (${sign}${chg}%)`);
    } catch (e) {
      setBars([]);
      setError(e.message || String(e));
      setStatus("Failed to load");
    }
  }, []);

  useEffect(() => {
    load(symbol, interval);
  }, [symbol, interval, load]);


  // Multi-TF alignment badge (15m / 1H / 4H). Independent of main chart bars.
  // Failures never clear the chart — only update the badge.
  // Refreshes on symbol change and every 3 minutes while the tab is open.
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const run = async (isInitial) => {
      if (cancelled) return;
      if (isInitial) {
        setAlignInfo({ label: "TF …", title: "Loading 15m / 1H / 4H bias", tone: "muted" });
      }
      try {
        const [r15, r1h, r4h] = await Promise.all([
          fetchOHLCV(symbol, "15m", 80).catch(() => null),
          fetchOHLCV(symbol, "1h", 80).catch(() => null),
          fetchOHLCV(symbol, "4h", 80).catch(() => null),
        ]);
        if (cancelled) return;
        const b15 = r15 && r15.bars ? tfBias(r15.bars) : null;
        const b1h = r1h && r1h.bars ? tfBias(r1h.bars) : null;
        const b4h = r4h && r4h.bars ? tfBias(r4h.bars) : null;
        setAlignInfo(alignmentSummary(b15, b1h, b4h));
      } catch (_) {
        if (!cancelled && isInitial) {
          setAlignInfo({ label: "TF —", title: "Alignment unavailable", tone: "muted" });
        }
        // On background refresh failure: keep the last good badge (no flicker / no chart touch)
      }
    };

    run(true);
    timer = setInterval(() => {
      run(false);
    }, 3 * 60 * 1000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [symbol]);


  useEffect(() => {
    if (!bars.length) return;

    let ws;
    let reconnectTimer;
    let isCancelled = false;

    const connectCoinbase = () => {
      if (isCancelled) return;
      setLiveState("Connecting…");
      const product = toCoinbaseProduct(symbol);
      const bucketSec = INTERVAL_SECONDS[interval] || 86400;

      ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

      ws.onopen = () => {
        if (isCancelled) return;
        ws.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [product],
            channels: ["ticker"],
          })
        );
        setLiveState("● LIVE (Coinbase)");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== "ticker" || !msg.price) return;

          const price = parseFloat(msg.price);
          const tradeSize = parseFloat(msg.last_size || 0);
          const tradeTime = msg.time ? Math.floor(new Date(msg.time).getTime() / 1000) : Math.floor(Date.now() / 1000);
          const candleStart = Math.floor(tradeTime / bucketSec) * bucketSec;

          setBars((prevBars) => {
            if (!prevBars.length) return prevBars;
            const lastBar = prevBars[prevBars.length - 1];

            if (candleStart === lastBar.time) {
              const updatedBar = {
                ...lastBar,
                high: Math.max(lastBar.high, price),
                low: Math.min(lastBar.low, price),
                close: price,
                volume: lastBar.volume + tradeSize,
              };
              const updated = [...prevBars];
              updated[updated.length - 1] = updatedBar;
              return updated;
            } else if (candleStart > lastBar.time) {
              const newBar = {
                time: candleStart,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: tradeSize,
              };
              return [...prevBars.slice(1), newBar];
            }
            return prevBars;
          });
        } catch {}
      };

      ws.onerror = () => {
        if (!isCancelled) setLiveState("Reconnecting…");
      };

      ws.onclose = () => {
        if (!isCancelled) {
          setLiveState("Reconnecting…");
          reconnectTimer = setTimeout(connectCoinbase, 3000);
        }
      };
    };

    const connectBinance = () => {
      if (isCancelled) return;
      setLiveState("Connecting…");
      const binanceInterval = INTERVALS.find((i) => i.id === interval)?.binance || "1d";
      const streamName = `${symbol.toLowerCase()}@kline_${binanceInterval}`;
      ws = new WebSocket(`wss://stream.binance.us:9443/ws/${streamName}`);

      ws.onopen = () => {
        if (!isCancelled) setLiveState("● LIVE (Binance.US)");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg.k) return;
          const k = msg.k;
          const liveBar = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };

          setBars((prevBars) => {
            if (!prevBars.length) return prevBars;
            const lastBar = prevBars[prevBars.length - 1];
            if (lastBar.time === liveBar.time) {
              const updated = [...prevBars];
              updated[updated.length - 1] = liveBar;
              return updated;
            } else if (liveBar.time > lastBar.time) {
              return [...prevBars.slice(1), liveBar];
            }
            return prevBars;
          });
        } catch {}
      };

      ws.onerror = () => {
        if (!isCancelled) setLiveState("Reconnecting…");
      };

      ws.onclose = () => {
        if (!isCancelled) {
          setLiveState("Reconnecting…");
          reconnectTimer = setTimeout(connectBinance, 3000);
        }
      };
    };

    if (dataSource === "coinbase") {
      connectCoinbase();
    } else {
      connectBinance();
    }

    return () => {
      isCancelled = true;
      clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [symbol, interval, dataSource, bars.length > 0]);

  const onSubmit = (e) => {
    e.preventDefault();
    const next = normalizeSymbol(symbolInput);
    setSymbol(next);
    setSymbolInput(displaySymbol(next));
  };

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const chgPct = last && prev ? ((last.close / prev.close - 1) * 100) : null;
  const chgSign = chgPct != null && chgPct >= 0 ? "+" : "";
  const chgText = chgPct != null ? chgPct.toFixed(2) : "0.00";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">OneStop-InfoSpot ProChart</div>

        <form className="symbol-form" onSubmit={onSubmit}>
          <input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="BTC-USD or BTCUSDT"
            aria-label="Symbol"
          />
          <button type="submit">Load</button>
        </form>

        <div className="intervals">
          {INTERVALS.map((i) => (
            <button
              key={i.id}
              type="button"
              className={`interval-btn${interval === i.id ? " active" : ""}`}
              onClick={() => setInterval(i.id)}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="intervals">
          <button
            type="button"
            className={`interval-btn${showIndBox ? " active" : ""}`}
            onClick={() => setShowIndBox((v) => !v)}
          >
            {showIndBox ? "Hide indicators" : "Indicators"}
          </button>
        </div>

        
        <div
          className="intervals"
          title={alignInfo.title}
          style={{ alignItems: "center" }}
        >
          <span
            className={
              "interval-btn" +
              (alignInfo.tone === "up" ? " active" : "")
            }
            style={{
              cursor: "default",
              pointerEvents: "none",
              opacity: 0.95,
              color:
                alignInfo.tone === "up"
                  ? "#22c55e"
                  : alignInfo.tone === "down"
                    ? "#ef4444"
                    : undefined,
              borderColor:
                alignInfo.tone === "up"
                  ? "rgba(34,197,94,0.45)"
                  : alignInfo.tone === "down"
                    ? "rgba(239,68,68,0.45)"
                    : undefined,
              fontSize: "0.78rem",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            {alignInfo.label}
          </span>
        </div>

        {showIndBox ? (
          <div className="intervals" style={{ flexWrap: "wrap", maxWidth: 560 }}>
            {[
              ["SMA 50", showSma50, setShowSma50],
              ["SMA 200", showSma200, setShowSma200],
              ["EMA 9", showEma9, setShowEma9],
              ["EMA 21", showEma21, setShowEma21],
              ["EMA 50", showEma50, setShowEma50],
              ["BB", showBb, setShowBb],
              ["VWAP", showVwap, setShowVwap],
              ["RSI", showRsi, setShowRsi],
              ["MACD", showMacd, setShowMacd],
              ["Stoch", showStoch, setShowStoch],
              ["ATR", showAtr, setShowAtr],
            ].map(([label, val, set]) => (
              <label key={label} className="hint" style={{ marginRight: 6 }}>
                <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} /> {label}
              </label>
            ))}
          </div>
        ) : null}

        <div className="meta">
          {last ? (
            <>
              <strong>{last.close}</strong>{" "}
              {chgPct != null && (
                <span className={chgPct >= 0 ? "up" : "down"}>
                  {chgSign}
                  {chgText}%
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="draw-sidebar" aria-label="Drawing Tools">
          {TOOL_GROUPS.map((group, gi) => (
            <div key={gi} style={{ display: "contents" }}>
              {gi > 0 && <div className="draw-divider" />}
              {group.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.label}
                  aria-label={t.label}
                  className={`tool-btn ${t.extraClass || ""}${drawTool === t.id ? " active" : ""}`}
                  onClick={() => {
                    setDrawTool(t.id);
                    setTrendDraft(null);
                  }}
                >
                  {t.icon}
                </button>
              ))}
            </div>
          ))}

          <div className="draw-divider" />

          <button
            type="button"
            title="Clear All Drawings"
            aria-label="Clear All Drawings"
            className="tool-btn danger"
            onClick={() => {
              setDrawings([]);
              setTrendDraft(null);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </aside>

        <main className="chart-wrap">
          {drawTool !== "none" ? (
            <div className="draw-banner">
              <span>
                {{
                  hline: "Horizontal Line: Click anywhere on chart to place",
                  hline_dot: "Dashed Level: Click anywhere on chart to place",
                  vline: "Vertical Marker: Click any bar or future space to place",
                  trend: trendDraft ? "Trend Line: Click 2nd point" : "Trend Line: Click 1st point",
                  ray: trendDraft ? "Ray: Click direction point" : "Ray: Click start point",
                  extend: trendDraft ? "Extended Line: Click 2nd point" : "Extended Line: Click 1st point",
                  rect: trendDraft ? "Rectangle Zone: Click opposite corner" : "Rectangle Zone: Click first corner",
                  fib: trendDraft ? "Fibonacci Retracement: Click 2nd swing" : "Fibonacci Retracement: Click 1st swing",
                  fibext: trendDraft ? "Fibonacci Extension: Click 2nd swing" : "Fibonacci Extension: Click 1st swing",
                  channel: !trendDraft
                    ? "Parallel Channel: Click point 1 (base start)"
                    : trendDraft.points?.length === 1
                      ? "Parallel Channel: Click point 2 (base end)"
                      : "Parallel Channel: Click point 3 (channel width)",
                  measure: trendDraft ? "Measure: Click end point" : "Measure: Click start point",
                  long: "Long Marker: Click on chart to place entry",
                  short: "Short Marker: Click on chart to place entry",
                }[drawTool] || "Draw mode"}
                {drawings.length ? ` · ${drawings.length} saved` : ""}
              </span>
              <button
                type="button"
                onClick={() => {
                  setDrawTool("none");
                  setTrendDraft(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  textDecoration: "underline",
                }}
              >
                Done
              </button>
            </div>
          ) : null}

          {bars.length > 0 ? (
            <CandleChart
              bars={bars}
              showSma50={showSma50}
              showSma200={showSma200}
              showEma9={showEma9}
              showEma21={showEma21}
              showEma50={showEma50}
              showBb={showBb}
              showVwap={showVwap}
              showRsi={showRsi}
              showMacd={showMacd}
              showStoch={showStoch}
              showAtr={showAtr}
              drawTool={drawTool}
              drawings={drawings}
              onAddDrawing={(d) => setDrawings((prev) => [...prev, d])}
              trendDraft={trendDraft}
              onTrendDraft={setTrendDraft}
            />
          ) : (
            <div className="chart-panel" style={{ display: "grid", placeItems: "center", color: "#8b9bb4" }}>
              {error || "No data"}
            </div>
          )}
        </main>
      </div>

      <footer className={`status${error ? " error" : ""}`}>
        {error || (
          <>
            <span style={{ color: liveState.startsWith("● LIVE") ? "#26a69a" : "#8b9bb4", fontWeight: 600 }}>
              {liveState}
            </span>
            {" · "}
            {last
              ? `${displaySymbol(symbol)} · ${interval.toUpperCase()} · last ${last.close} (${chgSign}${chgText}%)`
              : status}
          </>
        )}
        <span className="hint"> · Double-click chart to fit · $0 stack: LWC + Coinbase / Binance.US</span>
      </footer>
    </div>
  );
}
