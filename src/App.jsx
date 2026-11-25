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
  const url = window.location.pathname + "?" + q.toString();
  window.history.replaceState({}, "", url);
}

function toolHintText(drawTool, trendDraft) {
  const points = trendDraft && trendDraft.points ? trendDraft.points.length : 0;
  switch (drawTool) {
    case "hline":
      return "Click to place solid horizontal line";
    case "hline_dot":
      return "Click to place dashed horizontal line";
    case "vline":
      return "Click to place vertical marker";
    case "trend":
      return points ? "Click 2nd point - trend line" : "Click 1st point - trend line";
    case "ray":
      return points ? "Click direction point - ray" : "Click start of ray";
    case "extend":
      return points ? "Click 2nd point - extended line" : "Click 1st point - extended line";
    case "rect":
      return points ? "Click opposite corner - rectangle" : "Click first corner - rectangle";
    case "fib":
      return points ? "Click 2nd swing - Fib retracement" : "Click 1st swing - Fib";
    case "fibext":
      return points ? "Click 2nd swing - Fib extension" : "Click 1st swing - Fib Ext";
    case "channel":
      if (!points) return "Channel: click point 1 (base start)";
      if (points === 1) return "Channel: click point 2 (base end)";
      return "Channel: click point 3 (parallel width)";
    case "measure":
      return points ? "Click end - measure % move" : "Click start - measure tool";
    case "long":
      return "Click to mark long / buy";
    case "short":
      return "Click to mark short / sell";
    default:
      return "Draw mode";
  }
}

const DRAW_TOOLS = [
  ["none", "Navigate"],
  ["hline", "H-Line"],
  ["hline_dot", "H-Dash"],
  ["vline", "V-Line"],
  ["trend", "Trend"],
  ["ray", "Ray"],
  ["extend", "Extend"],
  ["rect", "Rect"],
  ["fib", "Fib"],
  ["fibext", "Fib Ext"],
  ["channel", "Channel"],
  ["measure", "Measure"],
  ["long", "Long"],
  ["short", "Short"],
];

export default function App() {
  const initial = useMemo(() => readParams(), []);
  const [symbolInput, setSymbolInput] = useState(displaySymbol(initial.symbol));
  const [symbol, setSymbol] = useState(initial.symbol);
  const [interval, setTf] = useState(initial.interval);
  const [bars, setBars] = useState([]);
  const [dataSource, setDataSource] = useState("coinbase");
  const [status, setStatus] = useState("Loading...");
  const [liveState, setLiveState] = useState("Connecting...");
  const [error, setError] = useState("");

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

  const [showDrawBox, setShowDrawBox] = useState(false);
  const [drawTool, setDrawTool] = useState("none");
  const [drawings, setDrawings] = useState([]);
  const [trendDraft, setTrendDraft] = useState(null);

  const load = useCallback(async (sym, tf) => {
    setStatus("Loading...");
    setError("");
    setDrawings([]);
    setTrendDraft(null);
    setDrawTool("none");
    try {
      const binanceInterval = INTERVALS.find((i) => i.id === tf)?.binance || "1d";
      const result = await fetchOHLCV(sym, binanceInterval, 500);
      const data = result.bars;
      const source = result.source;
      setBars(data);
      setDataSource(source);
      writeParams(sym, tf);
      const last = data[data.length - 1];
      const prev = data[data.length - 2];
      const chg = prev ? ((last.close / prev.close - 1) * 100).toFixed(2) : "0.00";
      const sign = Number(chg) >= 0 ? "+" : "";
      setStatus(displaySymbol(sym) + " · " + tf.toUpperCase() + " · last " + last.close + " (" + sign + chg + "%)");
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
      setLiveState("Connecting...");
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
        setLiveState("LIVE (Coinbase)");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== "ticker" || !msg.price) return;

          const price = parseFloat(msg.price);
          const tradeSize = parseFloat(msg.last_size || 0);
          const tradeTime = msg.time
            ? Math.floor(new Date(msg.time).getTime() / 1000)
            : Math.floor(Date.now() / 1000);
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
              const updated = prevBars.slice();
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
              return prevBars.slice(1).concat([newBar]);
            }
            return prevBars;
          });
        } catch (_) {}
      };

      ws.onerror = () => {
        if (!isCancelled) setLiveState("Reconnecting...");
      };

      ws.onclose = () => {
        if (!isCancelled) {
          setLiveState("Reconnecting...");
          reconnectTimer = setTimeout(connectCoinbase, 3000);
        }
      };
    };

    const connectBinance = () => {
      if (isCancelled) return;
      setLiveState("Connecting...");
      const binanceInterval = INTERVALS.find((i) => i.id === interval)?.binance || "1d";
      const streamName = symbol.toLowerCase() + "@kline_" + binanceInterval;
      ws = new WebSocket("wss://stream.binance.us:9443/ws/" + streamName);

      ws.onopen = () => {
        if (!isCancelled) setLiveState("LIVE (Binance.US)");
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
              const updated = prevBars.slice();
              updated[updated.length - 1] = liveBar;
              return updated;
            } else if (liveBar.time > lastBar.time) {
              return prevBars.slice(1).concat([liveBar]);
            }
            return prevBars;
          });
        } catch (_) {}
      };

      ws.onerror = () => {
        if (!isCancelled) setLiveState("Reconnecting...");
      };

      ws.onclose = () => {
        if (!isCancelled) {
          setLiveState("Reconnecting...");
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
  const chgPct = last && prev ? (last.close / prev.close - 1) * 100 : null;
  const chgSign = chgPct != null && chgPct >= 0 ? "+" : "";
  const chgText = chgPct != null ? chgPct.toFixed(2) : "0.00";

  const indicatorItems = [
    { label: "SMA 50", val: showSma50, set: setShowSma50 },
    { label: "SMA 200", val: showSma200, set: setShowSma200 },
    { label: "EMA 9", val: showEma9, set: setShowEma9 },
    { label: "EMA 21", val: showEma21, set: setShowEma21 },
    { label: "EMA 50", val: showEma50, set: setShowEma50 },
    { label: "BB", val: showBb, set: setShowBb },
    { label: "VWAP", val: showVwap, set: setShowVwap },
    { label: "RSI", val: showRsi, set: setShowRsi },
    { label: "MACD", val: showMacd, set: setShowMacd },
    { label: "Stoch", val: showStoch, set: setShowStoch },
    { label: "ATR", val: showAtr, set: setShowAtr },
  ];

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
              className={"interval-btn" + (interval === i.id ? " active" : "")}
              onClick={() => setTf(i.id)}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="intervals">
          <button
            type="button"
            className={"interval-btn" + (showIndBox ? " active" : "")}
            onClick={() => setShowIndBox((v) => !v)}
          >
            {showIndBox ? "Hide indicators" : "Indicators"}
          </button>
        </div>

        {showIndBox ? (
          <div className="intervals" style={{ flexWrap: "wrap", maxWidth: 560 }}>
            {indicatorItems.map((item) => (
              <label key={item.label} className="hint" style={{ marginRight: 6 }}>
                <input
                  type="checkbox"
                  checked={item.val}
                  onChange={(e) => item.set(e.target.checked)}
                />{" "}
                {item.label}
              </label>
            ))}
          </div>
        ) : null}

        <div className="intervals">
          <button
            type="button"
            className={"interval-btn" + (showDrawBox ? " active" : "")}
            onClick={() => {
              setShowDrawBox((v) => !v);
              if (showDrawBox) {
                setDrawTool("none");
                setTrendDraft(null);
              }
            }}
          >
            {showDrawBox ? "Hide tools" : "Draw tools"}
          </button>
        </div>

        {showDrawBox ? (
          <div className="intervals" style={{ flexWrap: "wrap", maxWidth: 520 }}>
            {DRAW_TOOLS.map((pair) => {
              const id = pair[0];
              const label = pair[1];
              return (
                <button
                  key={id}
                  type="button"
                  className={"interval-btn" + (drawTool === id ? " active" : "")}
                  onClick={() => {
                    setDrawTool(id);
                    setTrendDraft(null);
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              className="interval-btn"
              onClick={() => {
                setDrawings([]);
                setTrendDraft(null);
              }}
            >
              Clear all
            </button>
          </div>
        ) : null}

        <div className="meta">
          {last ? (
            <>
              <strong>{last.close}</strong>{" "}
              {chgPct != null ? (
                <span className={chgPct >= 0 ? "up" : "down"}>
                  {chgSign}
                  {chgText}%
                </span>
              ) : null}
            </>
          ) : (
            "-"
          )}
        </div>
      </header>

      {showDrawBox && drawTool !== "none" ? (
        <div className="status" style={{ borderTop: "none", paddingTop: 4, paddingBottom: 4 }}>
          {toolHintText(drawTool, trendDraft)}
          {drawings.length ? " · " + drawings.length + " object(s)" : ""}
        </div>
      ) : null}

      <main className="chart-wrap">
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
            onAddDrawing={(d) => setDrawings((prev) => prev.concat([d]))}
            trendDraft={trendDraft}
            onTrendDraft={setTrendDraft}
          />
        ) : (
          <div
            className="chart-panel"
            style={{ display: "grid", placeItems: "center", color: "#8b9bb4" }}
          >
            {error || "No data"}
          </div>
        )}
      </main>

      <footer className={"status" + (error ? " error" : "")}>
        {error ? (
          error
        ) : (
          <>
            <span
              style={{
                color: liveState.indexOf("LIVE") === 0 ? "#26a69a" : "#8b9bb4",
                fontWeight: 600,
              }}
            >
              {liveState}
            </span>
            {" · "}
            {last
              ? displaySymbol(symbol) +
                " · " +
                interval.toUpperCase() +
                " · last " +
                last.close +
                " (" +
                chgSign +
                chgText +
                "%)"
              : status}
          </>
        )}
        <span className="hint"> · Double-click chart to fit · free stack</span>
      </footer>
    </div>
  );
}
