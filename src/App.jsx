import { useCallback, useEffect, useMemo, useState } from "react";
import CandleChart from "./components/CandleChart.jsx";
import { fetchOHLCV } from "./lib/ohlcv.js";
import { INTERVALS, displaySymbol, normalizeSymbol } from "./lib/symbols.js";

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

/**
 * Chart Desk v0.2 — live WebSocket stack ($0):
 * - React + Vite (open source)
 * - Lightweight Charts (Apache-2.0)
 * - Binance.US public klines REST + live WebSocket stream (no API key)
 */
export default function App() {
  const initial = useMemo(() => readParams(), []);
  const [symbolInput, setSymbolInput] = useState(displaySymbol(initial.symbol));
  const [symbol, setSymbol] = useState(initial.symbol);
  const [interval, setInterval] = useState(initial.interval);
  const [bars, setBars] = useState([]);
  const [status, setStatus] = useState("Loading…");
  const [liveState, setLiveState] = useState("Connecting…");
  const [error, setError] = useState("");
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(false);
  const [showRsi, setShowRsi] = useState(true);

  const load = useCallback(async (sym, tf) => {
    setStatus("Loading…");
    setError("");
    try {
      const binanceInterval = INTERVALS.find((i) => i.id === tf)?.binance || "1d";
      const data = await fetchOHLCV(sym, binanceInterval, 500);
      setBars(data);
      writeParams(sym, tf);
      const last = data[data.length - 1];
      const prev = data[data.length - 2];
      const chg = prev ? ((last.close / prev.close - 1) * 100).toFixed(2) : "0.00";
      setStatus(
        `${displaySymbol(sym)} · ${tf.toUpperCase()} · last ${last.close} (${Number(chg) >= 0 ? "+" : ""}${chg}%)`
      );
    } catch (e) {
      setBars([]);
      setError(e.message || String(e));
      setStatus("Failed to load");
    }
  }, []);

  useEffect(() => {
    load(symbol, interval);
  }, [symbol, interval, load]);

  // Live Binance.US WebSocket stream for the active symbol & interval
  useEffect(() => {
    const binanceInterval = INTERVALS.find((i) => i.id === interval)?.binance || "1d";
    const streamName = `${symbol.toLowerCase()}@kline_${binanceInterval}`;
    const wsUrl = `wss://stream.binance.us:9443/ws/${streamName}`;

    let ws;
    let reconnectTimer;
    let isCancelled = false;

    const connect = () => {
      if (isCancelled) return;
      setLiveState("Connecting…");
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!isCancelled) setLiveState("● LIVE");
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
            // Update current candle if timestamps match; append new candle if interval rolled over
            if (lastBar.time === liveBar.time) {
              const updated = [...prevBars];
              updated[updated.length - 1] = liveBar;
              return updated;
            } else if (liveBar.time > lastBar.time) {
              return [...prevBars.slice(1), liveBar];
            }
            return prevBars;
          });
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!isCancelled) setLiveState("Reconnecting…");
      };

      ws.onclose = () => {
        if (!isCancelled) {
          setLiveState("Reconnecting…");
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      isCancelled = true;
      clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [symbol, interval]);

  const onSubmit = (e) => {
    e.preventDefault();
    const next = normalizeSymbol(symbolInput);
    setSymbol(next);
    setSymbolInput(displaySymbol(next));
  };

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const chgPct = last && prev ? ((last.close / prev.close - 1) * 100) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">CHART DESK</div>

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

        <label className="hint">
          <input type="checkbox" checked={showSma50} onChange={(e) => setShowSma50(e.target.checked)} /> SMA 50
        </label>
        <label className="hint">
          <input type="checkbox" checked={showSma200} onChange={(e) => setShowSma200(e.target.checked)} /> SMA 200
        </label>
        <label className="hint">
          <input type="checkbox" checked={showRsi} onChange={(e) => setShowRsi(e.target.checked)} /> RSI
        </label>

        <div className="meta">
          {last ? (
            <>
              <strong>{last.close}</strong>{" "}
              {chgPct != null && (
                <span className={chgPct >= 0 ? "up" : "down"}>
                  {chgPct >= 0 ? "+" : ""}
                  {chgPct.toFixed(2)}%
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </div>
      </header>

      <main className="chart-wrap">
        {bars.length > 0 ? (
          <CandleChart bars={bars} showSma50={showSma50} showSma200={showSma200} showRsi={showRsi} />
        ) : (
          <div className="chart-panel" style={{ display: "grid", placeItems: "center", color: "#8b9bb4" }}>
            {error || "No data"}
          </div>
        )}
      </main>

      <footer className={`status${error ? " error" : ""}`}>
        {error || (
          <>
            <span style={{ color: liveState === "● LIVE" ? "#26a69a" : "#8b9bb4", fontWeight: 600 }}>
              {liveState}
            </span>
            {" · "}
            {last
              ? `${displaySymbol(symbol)} · ${interval.toUpperCase()} · last ${last.close} (${
                  chgPct >= 0 ? "+" : ""
                }${chgPct != null ? chgPct.toFixed(2) : "0.00"}%)`
              : status}
          </>
        )}
        <span className="hint"> · $0 stack: React + Lightweight Charts + Binance.US WebSocket</span>
      </footer>
    </div>
  );
}
