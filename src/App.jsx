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

const DRAW_TOOLS = [
  ["none", "Navigate"],
  ["hline", "H-Line"],
  ["trend", "Trend"],
  ["ray", "Ray"],
  ["fib", "Fib"],
  ["rect", "Rect"],
  ["long", "Long"],
  ["short", "Short"],
];

function readParams() {
  const q = new URLSearchParams(window.location.search);
  const symbol = normalizeSymbol(q.get("symbol") || q.get("ticker") || "BTCUSDT");
  const interval = q.get("interval") || q.get("tf") || "1d";
  const valid = INTERVALS.some(function (i) {
    return i.id === interval;
  })
    ? interval
    : "1d";
  return { symbol: symbol, interval: valid };
}

function writeParams(symbol, interval) {
  const q = new URLSearchParams();
  q.set("symbol", symbol);
  q.set("interval", interval);
  window.history.replaceState({}, "", window.location.pathname + "?" + q.toString());
}

export default function App() {
  const initial = useMemo(function () {
    return readParams();
  }, []);

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
  const [showBb, setShowBb] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);

  const [showDrawBox, setShowDrawBox] = useState(false);
  const [drawTool, setDrawTool] = useState("none");
  const [drawings, setDrawings] = useState([]);
  const [trendDraft, setTrendDraft] = useState(null);

  const load = useCallback(async function (sym, tf) {
    setStatus("Loading...");
    setError("");
    setDrawings([]);
    setTrendDraft(null);
    setDrawTool("none");
    try {
      const found = INTERVALS.find(function (i) {
        return i.id === tf;
      });
      const binanceInterval = (found && found.binance) || "1d";
      const result = await fetchOHLCV(sym, binanceInterval, 500);
      setBars(result.bars);
      setDataSource(result.source);
      writeParams(sym, tf);
      const last = result.bars[result.bars.length - 1];
      const prev = result.bars[result.bars.length - 2];
      const chg = prev ? ((last.close / prev.close - 1) * 100).toFixed(2) : "0.00";
      const sign = Number(chg) >= 0 ? "+" : "";
      setStatus(
        displaySymbol(sym) + " | " + tf.toUpperCase() + " | last " + last.close + " (" + sign + chg + "%)"
      );
    } catch (e) {
      setBars([]);
      setError(e.message || String(e));
      setStatus("Failed to load");
    }
  }, []);

  useEffect(
    function () {
      load(symbol, interval);
    },
    [symbol, interval, load]
  );

  useEffect(
    function () {
      if (!bars.length) return;

      let ws;
      let reconnectTimer;
      let isCancelled = false;

      function connectCoinbase() {
        if (isCancelled) return;
        setLiveState("Connecting...");
        const product = toCoinbaseProduct(symbol);
        const bucketSec = INTERVAL_SECONDS[interval] || 86400;
        ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
        ws.onopen = function () {
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
        ws.onmessage = function (event) {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type !== "ticker" || !msg.price) return;
            const price = parseFloat(msg.price);
            const tradeSize = parseFloat(msg.last_size || 0);
            const tradeTime = msg.time
              ? Math.floor(new Date(msg.time).getTime() / 1000)
              : Math.floor(Date.now() / 1000);
            const candleStart = Math.floor(tradeTime / bucketSec) * bucketSec;
            setBars(function (prevBars) {
              if (!prevBars.length) return prevBars;
              const lastBar = prevBars[prevBars.length - 1];
              if (candleStart === lastBar.time) {
                const updated = prevBars.slice();
                updated[updated.length - 1] = {
                  time: lastBar.time,
                  open: lastBar.open,
                  high: Math.max(lastBar.high, price),
                  low: Math.min(lastBar.low, price),
                  close: price,
                  volume: lastBar.volume + tradeSize,
                };
                return updated;
              }
              if (candleStart > lastBar.time) {
                return prevBars.slice(1).concat([
                  {
                    time: candleStart,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: tradeSize,
                  },
                ]);
              }
              return prevBars;
            });
          } catch (err) {}
        };
        ws.onerror = function () {
          if (!isCancelled) setLiveState("Reconnecting...");
        };
        ws.onclose = function () {
          if (!isCancelled) {
            setLiveState("Reconnecting...");
            reconnectTimer = setTimeout(connectCoinbase, 3000);
          }
        };
      }

      function connectBinance() {
        if (isCancelled) return;
        setLiveState("Connecting...");
        const found = INTERVALS.find(function (i) {
          return i.id === interval;
        });
        const binanceInterval = (found && found.binance) || "1d";
        const streamName = symbol.toLowerCase() + "@kline_" + binanceInterval;
        ws = new WebSocket("wss://stream.binance.us:9443/ws/" + streamName);
        ws.onopen = function () {
          if (!isCancelled) setLiveState("LIVE (Binance.US)");
        };
        ws.onmessage = function (event) {
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
            setBars(function (prevBars) {
              if (!prevBars.length) return prevBars;
              const lastBar = prevBars[prevBars.length - 1];
              if (lastBar.time === liveBar.time) {
                const updated = prevBars.slice();
                updated[updated.length - 1] = liveBar;
                return updated;
              }
              if (liveBar.time > lastBar.time) {
                return prevBars.slice(1).concat([liveBar]);
              }
              return prevBars;
            });
          } catch (err) {}
        };
        ws.onerror = function () {
          if (!isCancelled) setLiveState("Reconnecting...");
        };
        ws.onclose = function () {
          if (!isCancelled) {
            setLiveState("Reconnecting...");
            reconnectTimer = setTimeout(connectBinance, 3000);
          }
        };
      }

      if (dataSource === "coinbase") connectCoinbase();
      else connectBinance();

      return function () {
        isCancelled = true;
        clearTimeout(reconnectTimer);
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          ws.close();
        }
      };
    },
    [symbol, interval, dataSource, bars.length]
  );

  function onSubmit(e) {
    e.preventDefault();
    const next = normalizeSymbol(symbolInput);
    setSymbol(next);
    setSymbolInput(displaySymbol(next));
  }

  const last = bars.length ? bars[bars.length - 1] : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const chgPct = last && prevBar ? (last.close / prevBar.close - 1) * 100 : null;
  const chgSign = chgPct != null && chgPct >= 0 ? "+" : "";
  const chgText = chgPct != null ? chgPct.toFixed(2) : "0.00";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">CHART DESK</div>

        <form className="symbol-form" onSubmit={onSubmit}>
          <input
            value={symbolInput}
            onChange={function (e) {
              setSymbolInput(e.target.value);
            }}
            placeholder="BTC-USD or BTCUSDT"
            aria-label="Symbol"
          />
          <button type="submit">Load</button>
        </form>

        <div className="intervals">
          {INTERVALS.map(function (i) {
            return (
              <button
                key={i.id}
                type="button"
                className={interval === i.id ? "interval-btn active" : "interval-btn"}
                onClick={function () {
                  setTf(i.id);
                }}
              >
                {i.label}
              </button>
            );
          })}
        </div>

        <div className="intervals">
          <button
            type="button"
            className={showIndBox ? "interval-btn active" : "interval-btn"}
            onClick={function () {
              setShowIndBox(function (v) {
                return !v;
              });
            }}
          >
            {showIndBox ? "Hide indicators" : "Indicators"}
          </button>
        </div>

        {showIndBox ? (
          <div className="intervals" style={{ flexWrap: "wrap", maxWidth: 480 }}>
            <label className="hint">
              <input
                type="checkbox"
                checked={showSma50}
                onChange={function (e) {
                  setShowSma50(e.target.checked);
                }}
              />{" "}
              SMA 50
            </label>
            <label className="hint">
              <input
                type="checkbox"
                checked={showSma200}
                onChange={function (e) {
                  setShowSma200(e.target.checked);
                }}
              />{" "}
              SMA 200
            </label>
            <label className="hint">
              <input
                type="checkbox"
                checked={showEma9}
                onChange={function (e) {
                  setShowEma9(e.target.checked);
                }}
              />{" "}
              EMA 9
            </label>
            <label className="hint">
              <input
                type="checkbox"
                checked={showEma21}
                onChange={function (e) {
                  setShowEma21(e.target.checked);
                }}
              />{" "}
              EMA 21
            </label>
            <label className="hint">
              <input
                type="checkbox"
                checked={showBb}
                onChange={function (e) {
                  setShowBb(e.target.checked);
                }}
              />{" "}
              BB
            </label>
            <label className="hint">
              <input
                type="checkbox"
                checked={showRsi}
                onChange={function (e) {
                  setShowRsi(e.target.checked);
                }}
              />{" "}
              RSI
            </label>
            <label className="hint">
              <input
                type="checkbox"
                checked={showMacd}
                onChange={function (e) {
                  setShowMacd(e.target.checked);
                }}
              />{" "}
              MACD
            </label>
          </div>
        ) : null}

        <div className="intervals">
          <button
            type="button"
            className={showDrawBox ? "interval-btn active" : "interval-btn"}
            onClick={function () {
              setShowDrawBox(function (v) {
                return !v;
              });
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
          <div className="intervals" style={{ flexWrap: "wrap", maxWidth: 480 }}>
            {DRAW_TOOLS.map(function (pair) {
              return (
                <button
                  key={pair[0]}
                  type="button"
                  className={drawTool === pair[0] ? "interval-btn active" : "interval-btn"}
                  onClick={function () {
                    setDrawTool(pair[0]);
                    setTrendDraft(null);
                  }}
                >
                  {pair[1]}
                </button>
              );
            })}
            <button
              type="button"
              className="interval-btn"
              onClick={function () {
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
            <span>
              <strong>{last.close}</strong>{" "}
              {chgPct != null ? (
                <span className={chgPct >= 0 ? "up" : "down"}>
                  {chgSign}
                  {chgText}%
                </span>
              ) : null}
            </span>
          ) : (
            "-"
          )}
        </div>
      </header>

      <main className="chart-wrap">
        {bars.length > 0 ? (
          <CandleChart
            bars={bars}
            showSma50={showSma50}
            showSma200={showSma200}
            showEma9={showEma9}
            showEma21={showEma21}
            showBb={showBb}
            showRsi={showRsi}
            showMacd={showMacd}
            drawTool={drawTool}
            drawings={drawings}
            onAddDrawing={function (d) {
              setDrawings(function (prev) {
                return prev.concat([d]);
              });
            }}
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

      <footer className={error ? "status error" : "status"}>
        {error ? (
          error
        ) : (
          <span>
            <span
              style={{
                color: liveState.indexOf("LIVE") === 0 ? "#26a69a" : "#8b9bb4",
                fontWeight: 600,
              }}
            >
              {liveState}
            </span>
            {" | "}
            {last
              ? displaySymbol(symbol) +
                " | " +
                interval.toUpperCase() +
                " | last " +
                last.close +
                " (" +
                chgSign +
                chgText +
                "%)"
              : status}
          </span>
        )}
        <span className="hint"> | Double-click chart to fit | crypto only</span>
      </footer>
    </div>
  );
}
