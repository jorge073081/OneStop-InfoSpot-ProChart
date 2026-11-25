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
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(false);
  const [showRsi, setShowRsi] = useState(true);

  const load = useCallback(async (sym, tf) => {
    setStatus("Loading…");
    setError("");
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
            <span style={{ color: liveState.startsWith("● LIVE") ? "#26a69a" : "#8b9bb4", fontWeight: 600 }}>
              {liveState}
            </span>
            {" · "}
            {last
              ? `${displaySymbol(symbol)} · ${interval.toUpperCase()} · last ${last.close} (${chgSign}${chgText}%)`
              : status}
          </>
        )}
        <span className="hint"> · $0 stack: React + Lightweight Charts + Coinbase / Binance.US</span>
      </footer>
    </div>
  );
}
