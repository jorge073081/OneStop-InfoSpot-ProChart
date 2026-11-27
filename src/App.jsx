import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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


function encodeDrawings(drawings) {
  try {
    if (!drawings || !drawings.length) return "";
    const json = JSON.stringify(drawings);
    // base64url
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return "";
  }
}

function decodeDrawings(raw) {
  try {
    if (!raw) return null;
    let b64 = String(raw).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(escape(atob(b64)));
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function readParams() {
  const q = new URLSearchParams(window.location.search);
  const symbol = normalizeSymbol(q.get("symbol") || q.get("ticker") || "BTCUSDT");
  const interval = q.get("interval") || q.get("tf") || "1d";
  const valid = INTERVALS.some((i) => i.id === interval) ? interval : "1d";
  const fromUrl = decodeDrawings(q.get("d") || q.get("drawings") || "");
  return { symbol, interval: valid, drawingsFromUrl: fromUrl };
}

function writeParams(symbol, interval, drawings) {
  const q = new URLSearchParams();
  q.set("symbol", symbol);
  q.set("interval", interval);
  const enc = encodeDrawings(drawings);
  // keep URLs usable — skip drawings payload if huge
  if (enc && enc.length < 1800) q.set("d", enc);
  const url = window.location.pathname + "?" + q.toString();
  window.history.replaceState({}, "", url);
  return window.location.origin + url;
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


async function fetchOrderBook(symbol) {
  // Coinbase level-2 book (free, no key)
  const product = (() => {
    const s = String(symbol || "").toUpperCase();
    if (s.includes("-")) return s;
    if (s.endsWith("USDT")) return s.slice(0, -4) + "-USD";
    return s + "-USD";
  })();
  try {
    const res = await fetch(
      "https://api.exchange.coinbase.com/products/" +
        encodeURIComponent(product) +
        "/book?level=2"
    );
    if (!res.ok) throw new Error("Coinbase book " + res.status);
    const data = await res.json();
    const bids = (data.bids || []).slice(0, 24).map((r) => ({
      price: parseFloat(r[0]),
      size: parseFloat(r[1]),
    }));
    const asks = (data.asks || []).slice(0, 24).map((r) => ({
      price: parseFloat(r[0]),
      size: parseFloat(r[1]),
    }));
    return { bids, asks, source: "coinbase" };
  } catch (e1) {
    // Binance.US depth fallback
    const sym = String(symbol || "BTCUSDT").toUpperCase().replace("-USD", "USDT");
    const res = await fetch(
      "https://api.binance.us/api/v3/depth?symbol=" +
        encodeURIComponent(sym) +
        "&limit=20"
    );
    if (!res.ok) throw new Error("Book unavailable");
    const data = await res.json();
    const bids = (data.bids || []).map((r) => ({
      price: parseFloat(r[0]),
      size: parseFloat(r[1]),
    }));
    const asks = (data.asks || []).map((r) => ({
      price: parseFloat(r[0]),
      size: parseFloat(r[1]),
    }));
    return { bids, asks, source: "binance" };
  }
}

function bookHeatRows(book) {
  if (!book || !book.bids || !book.asks) return [];
  const maxSize = Math.max(
    0.0001,
    ...book.bids.map((b) => b.size),
    ...book.asks.map((a) => a.size)
  );
  // asks high→low (top), then bids high→low
  const asks = book.asks
    .slice()
    .sort((a, b) => b.price - a.price)
    .map((a) => ({
      side: "ask",
      price: a.price,
      size: a.size,
      pct: Math.min(100, (a.size / maxSize) * 100),
    }));
  const bids = book.bids
    .slice()
    .sort((a, b) => b.price - a.price)
    .map((b) => ({
      side: "bid",
      price: b.price,
      size: b.size,
      pct: Math.min(100, (b.size / maxSize) * 100),
    }));
  return asks.concat(bids);
}



function isBtcSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();
  return s === "BTCUSDT" || s === "BTC-USD" || s === "BTCUSD" || s === "BTC";
}

/** Align asset & BTC bars by time; return relative strength stats (accurate price math). */
function vsBtcStats(assetBars, btcBars) {
  if (!assetBars?.length || !btcBars?.length) return null;
  const btcMap = new Map(btcBars.map((b) => [b.time, b.close]));
  const pairs = [];
  for (let i = 0; i < assetBars.length; i++) {
    const c = btcMap.get(assetBars[i].time);
    if (c != null && c > 0 && assetBars[i].close > 0) {
      pairs.push({
        time: assetBars[i].time,
        asset: assetBars[i].close,
        btc: c,
        ratio: assetBars[i].close / c,
      });
    }
  }
  if (pairs.length < 2) return null;
  const first = pairs[0];
  const last = pairs[pairs.length - 1];
  const assetPct = ((last.asset / first.asset) - 1) * 100;
  const btcPct = ((last.btc / first.btc) - 1) * 100;
  const rel = assetPct - btcPct;
  const ratioPct = ((last.ratio / first.ratio) - 1) * 100;
  return {
    ratio: last.ratio,
    assetPct,
    btcPct,
    rel,
    ratioPct,
    points: pairs.length,
  };
}



function toFuturesSymbol(symbol) {
  let s = String(symbol || "BTCUSDT").toUpperCase().replace(/\s+/g, "");
  if (s.endsWith("-USD")) s = s.replace("-USD", "USDT");
  if (s.endsWith("-USDT")) s = s.replace("-USDT", "USDT");
  if (!s.endsWith("USDT")) s = s + "USDT";
  return s;
}

async function fetchFundingRate(symbol) {
  const sym = toFuturesSymbol(symbol);

  // Prefer same-origin Vercel proxy (avoids browser CORS)
  try {
    const res = await fetch(
      "/api/funding?symbol=" + encodeURIComponent(sym)
    );
    if (res.status === 404) {
      throw new Error("API not deployed");
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        (data && data.error) ||
          "Funding API " + res.status
      );
    }
    if (data && typeof data.ratePct === "number") return data;
    if (data && typeof data.rate === "number") {
      return { ...data, ratePct: data.rate * 100 };
    }
    throw new Error("Bad funding payload");
  } catch (proxyErr) {
    // Direct public endpoints (may fail CORS in browser)
    const errors = [proxyErr.message || String(proxyErr)];
    try {
      const res = await fetch(
        "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=" +
          encodeURIComponent(sym)
      );
      if (!res.ok) throw new Error("Binance " + res.status);
      const data = await res.json();
      const rate = parseFloat(data.lastFundingRate);
      if (!Number.isFinite(rate)) throw new Error("Binance no rate");
      return {
        symbol: sym,
        rate,
        ratePct: rate * 100,
        mark: parseFloat(data.markPrice) || null,
        nextFundingTime: data.nextFundingTime
          ? Number(data.nextFundingTime)
          : null,
        source: "Binance Futures",
      };
    } catch (e) {
      errors.push(e.message || String(e));
    }
    try {
      const res = await fetch(
        "https://api.bybit.com/v5/market/tickers?category=linear&symbol=" +
          encodeURIComponent(sym)
      );
      if (!res.ok) throw new Error("Bybit " + res.status);
      const data = await res.json();
      const row = data && data.result && data.result.list && data.result.list[0];
      if (!row) throw new Error("Bybit empty");
      const rate = parseFloat(row.fundingRate);
      if (!Number.isFinite(rate)) throw new Error("Bybit no rate");
      return {
        symbol: sym,
        rate,
        ratePct: rate * 100,
        mark: parseFloat(row.markPrice) || null,
        nextFundingTime: row.nextFundingTime
          ? Number(row.nextFundingTime)
          : null,
        source: "Bybit",
      };
    } catch (e) {
      errors.push(e.message || String(e));
    }
    throw new Error(errors.join(" · "));
  }
}




/** London 08:00 UTC & New York 13:30 UTC session opens as vline overlays (not saved). */
function buildSessionMarkers(bars) {
  if (!bars || bars.length < 2) return [];
  const tFirst = bars[0].time;
  const tLast = bars[bars.length - 1].time;
  const out = [];

  const d0 = new Date(tFirst * 1000);
  let day = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) / 1000;
  const end = tLast + 86400;

  while (day <= end) {
    const london = day + 8 * 3600;
    const ny = day + 13 * 3600 + 30 * 60;
    if (london >= tFirst - 3600 && london <= tLast + 3600) {
      out.push({
        id: "sess-lon-" + day,
        type: "vline",
        time: london,
        price: 0,
        session: "London",
      });
    }
    if (ny >= tFirst - 3600 && ny <= tLast + 3600) {
      out.push({
        id: "sess-ny-" + day,
        type: "vline",
        time: ny,
        price: 0,
        session: "NY",
      });
    }
    day += 86400;
  }
  return out;
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
  const [alignInfo, setAlignInfo] = useState({ label: "TF —", title: "Multi-TF alignment", tone: "muted" });
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const raw = localStorage.getItem("chart_desk_watchlist");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });
  const [showWatch, setShowWatch] = useState(false);
  const [showLiq, setShowLiq] = useState(false);
  const [book, setBook] = useState(null);
  const [bookStatus, setBookStatus] = useState("");
  const [showVsBtc, setShowVsBtc] = useState(false);
  const [vsBtc, setVsBtc] = useState(null);
  const [vsBtcStatus, setVsBtcStatus] = useState("");
  const [showFunding, setShowFunding] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [funding, setFunding] = useState(null);
  const [fundingStatus, setFundingStatus] = useState("");
  const [alertsOn, setAlertsOn] = useState(() => {
    try {
      return localStorage.getItem("chart_desk_alerts_on") === "1";
    } catch {
      return false;
    }
  });
  const [alertLog, setAlertLog] = useState([]);
  const lastPriceRef = useRef(null);
  const firedRef = useRef({});

  useEffect(() => {
    try {
      localStorage.setItem("chart_desk_watchlist", JSON.stringify(watchlist));
    } catch {}
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem("chart_desk_alerts_on", alertsOn ? "1" : "0");
    } catch {}
  }, [alertsOn]);

  const addToWatchlist = () => {
    const sym = symbol;
    if (!sym) return;
    setWatchlist((prev) => {
      if (prev.includes(sym)) return prev;
      return prev.concat([sym]).slice(-30); // cap 30
    });
  };

  const removeFromWatchlist = (sym) => {
    setWatchlist((prev) => prev.filter((s) => s !== sym));
  };

  const openWatchSymbol = (sym) => {
    const next = normalizeSymbol(sym);
    setSymbol(next);
    setSymbolInput(displaySymbol(next));
    setShowWatch(false);
  };
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
    if (initial.drawingsFromUrl && initial.drawingsFromUrl.length) {
      return initial.drawingsFromUrl;
    }
    try {
      const saved = localStorage.getItem(`chart_desk_drawings_${initial.symbol}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [shareHint, setShareHint] = useState("");
  const [trendDraft, setTrendDraft] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(`chart_desk_drawings_${symbol}`, JSON.stringify(drawings));
    } catch {}
    try {
      writeParams(symbol, interval, drawings);
    } catch {}
  }, [drawings, symbol, interval]);

  // Order book liquidity panel — only while open; never touches chart bars
  useEffect(() => {
    if (!showLiq) return undefined;
    let cancelled = false;
    let timer = null;

    const run = async () => {
      if (cancelled) return;
      try {
        const data = await fetchOrderBook(symbol);
        if (cancelled) return;
        setBook(data);
        setBookStatus((data.source || "book") + " · " + new Date().toLocaleTimeString());
      } catch (e) {
        if (!cancelled) setBookStatus(e.message || "Book unavailable");
      }
    };

    run();
    timer = window.setInterval(function () {
      run();
    }, 12 * 1000);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, [showLiq, symbol]);


  // Price alerts on horizontal drawings — uses live last price; never mutates bars
  useEffect(() => {
    if (!alertsOn || !bars.length) return;
    const price = bars[bars.length - 1].close;
    if (price == null || !Number.isFinite(price)) return;

    const prev = lastPriceRef.current;
    lastPriceRef.current = price;
    if (prev == null || !Number.isFinite(prev) || prev === price) return;

    const levels = drawings.filter(
      (d) => (d.type === "hline" || d.type === "hline_dot") && Number.isFinite(d.price)
    );
    if (!levels.length) return;

    const symLabel = displaySymbol(symbol);
    const fired = firedRef.current;

    levels.forEach((d) => {
      const level = d.price;
      const key = String(d.id || level);
      // re-arm when price moves away ~0.15% from level
      const away = Math.abs(price - level) / level > 0.0015;
      if (away && fired[key]) {
        delete fired[key];
      }

      const crossUp = prev < level && price >= level;
      const crossDown = prev > level && price <= level;
      if (!crossUp && !crossDown) return;
      if (fired[key]) return;
      fired[key] = true;

      const dir = crossUp ? "↑ tag" : "↓ tag";
      const msg =
        symLabel +
        " " +
        dir +
        " " +
        level +
        " @ " +
        price;
      const entry = {
        id: key + "-" + Date.now(),
        text: msg,
        at: new Date().toLocaleTimeString(),
      };
      setAlertLog((log) => [entry].concat(log).slice(0, 12));

      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Chart Desk alert", { body: msg, tag: key });
        }
      } catch (_) {}
    });
  }, [bars, drawings, alertsOn, symbol]);

  // vs BTC — fetch BTC same TF; compare to chart bars (does not clear chart)
  useEffect(() => {
    if (!showVsBtc) return undefined;

    if (isBtcSymbol(symbol)) {
      setVsBtc(null);
      setVsBtcStatus("This chart is already BTC");
      return undefined;
    }

    let cancelled = false;
    setVsBtcStatus("Loading BTC…");

    (async () => {
      try {
        const binanceInterval =
          (INTERVALS.find((i) => i.id === interval) || {}).binance || "1d";
        const btcRes = await fetchOHLCV("BTCUSDT", binanceInterval, 500);
        if (cancelled) return;

        let assetBars = bars;
        if (!assetBars || assetBars.length < 2) {
          const assetRes = await fetchOHLCV(symbol, binanceInterval, 500);
          if (cancelled) return;
          assetBars = assetRes.bars;
        }

        const stats = vsBtcStats(assetBars, btcRes.bars);
        if (cancelled) return;
        if (!stats) {
          setVsBtc(null);
          setVsBtcStatus("No overlapping candles with BTC");
          return;
        }
        setVsBtc(stats);
        setVsBtcStatus(
          (btcRes.source || "exchange") + " · " + stats.points + " matched bars"
        );
      } catch (e) {
        if (!cancelled) {
          setVsBtc(null);
          setVsBtcStatus(e.message || "Failed to load BTC");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showVsBtc, symbol, interval, bars]);

  // Funding rate panel — public futures APIs; never touches chart bars
  useEffect(() => {
    if (!showFunding) return undefined;
    let cancelled = false;
    let timer = null;

    const run = async (isInitial) => {
      if (cancelled) return;
      if (isInitial) setFundingStatus("Loading funding...");
      try {
        const data = await fetchFundingRate(symbol);
        if (cancelled) return;
        setFunding(data);
        setFundingStatus(data.source + " · " + new Date().toLocaleTimeString());
      } catch (e) {
        if (!cancelled) {
          setFunding(null);
          setFundingStatus(e.message || "Funding unavailable");
        }
      }
    };

    run(true);
    timer = window.setInterval(function () {
      run(false);
    }, 60 * 1000);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, [showFunding, symbol]);





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
      writeParams(sym, tf, undefined);
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
  // NOTE: chart timeframe state is also named setInterval — always use window.setInterval here.
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
        const summary = alignmentSummary(b15, b1h, b4h);
        const when = new Date().toLocaleTimeString();
        setAlignInfo({
          ...summary,
          title: (summary.title || "") + " · refreshed " + when,
        });
      } catch (_) {
        if (!cancelled && isInitial) {
          setAlignInfo({ label: "TF —", title: "Alignment unavailable", tone: "muted" });
        }
      }
    };

    run(true);
    // 60s so you can verify; still light on free APIs (3 small requests/min)
    timer = window.setInterval(function () {
      run(false);
    }, 60 * 1000);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
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
  const sessionOverlay = useMemo(() => {
    if (!showSessions) return [];
    return buildSessionMarkers(bars);
  }, [showSessions, bars]);

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

        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (showIndBox ? " active" : "")}
            onClick={() => {
              setShowIndBox((v) => !v);
              if (!showIndBox) {
                setShowWatch(false);
                setShowLiq(false);
                setShowVsBtc(false);
                setShowFunding(false);
              }
            }}
            title="Indicators"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
          >
            Indicators
          </button>
          {showIndBox ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 80,
                width: 168,
                maxHeight: 280,
                overflowY: "auto",
                padding: "6px",
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "#0f141c",
                boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#6b7c93",
                  padding: "2px 6px 6px",
                }}
              >
                Indicators
              </div>
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
                <label
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    marginBottom: 2,
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: "0.72rem",
                    color: val ? "#22d3ee" : "#c5d0e0",
                    fontWeight: val ? 600 : 500,
                    background: val ? "rgba(34, 211, 238, 0.12)" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={val}
                    onChange={(e) => set(e.target.checked)}
                    style={{ accentColor: "#22d3ee", margin: 0 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        
                                <button
          type="button"
          className="interval-btn"
          title="Copy shareable chart link"
          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
          onClick={async () => {
            const url = writeParams(symbol, interval, drawings);
            try {
              await navigator.clipboard.writeText(url);
              setShareHint("Link copied");
            } catch {
              try {
                window.prompt("Copy link:", url);
                setShareHint("Copy the link");
              } catch {
                setShareHint("Share failed");
              }
            }
            window.setTimeout(function () {
              setShareHint("");
            }, 2000);
          }}
        >
          {shareHint || "Share"}
        </button>

<div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (alertsOn ? " active" : "")}
            title="Price alerts on horizontal lines"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
            onClick={async () => {
              if (!alertsOn) {
                try {
                  if (typeof Notification !== "undefined" && Notification.permission === "default") {
                    await Notification.requestPermission();
                  }
                } catch (_) {}
                firedRef.current = {};
                lastPriceRef.current = bars.length ? bars[bars.length - 1].close : null;
                setAlertsOn(true);
              } else {
                setAlertsOn(false);
              }
            }}
          >
            {alertsOn ? "Alerts on" : "Alerts"}
          </button>
          {alertsOn && alertLog.length ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 80,
                width: 220,
                maxHeight: 200,
                overflowY: "auto",
                padding: "8px",
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "#0f141c",
                boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
                fontSize: "0.68rem",
                color: "#c5d0e0",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#6b7c93",
                  padding: "2px 4px 6px",
                }}
              >
                Recent alerts
              </div>
              {alertLog.map((a) => (
                <div key={a.id} style={{ padding: "4px 4px", borderBottom: "1px solid rgba(148,163,184,0.08)" }}>
                  <div>{a.text}</div>
                  <div style={{ color: "#6b7c93" }}>{a.at}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

                        <button
          type="button"
          className={"interval-btn" + (showSessions ? " active" : "")}
          title="Session markers: London 08:00 UTC, NY 13:30 UTC"
          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
          onClick={() => setShowSessions((v) => !v)}
        >
          Sessions
        </button>

<div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (showFunding ? " active" : "")}
            title="Perp funding rate"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
            onClick={() => {
              setShowFunding((v) => !v);
              if (!showFunding) {
                setShowIndBox(false);
                setShowWatch(false);
                setShowLiq(false);
                setShowVsBtc(false);
              }
            }}
          >
            Funding
          </button>
          {showFunding ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 120,
                width: 220,
                minHeight: 72,
                padding: "8px",
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "#0f141c",
                boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
                fontSize: "0.72rem",
                color: "#c5d0e0",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#6b7c93",
                  padding: "2px 4px 8px",
                }}
              >
                Funding rate
              </div>
              {!funding ? (
                <div style={{ color: "#8b9bb4", padding: "8px 4px", lineHeight: 1.4 }}>
                  {fundingStatus || "Loading…"}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 6, padding: "0 4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Symbol</span>
                    <span>{funding.symbol}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                    <span style={{ color: "#8b9bb4" }}>Rate</span>
                    <span
                      style={{
                        color: funding.ratePct >= 0 ? "#4ade80" : "#f87171",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(funding.ratePct >= 0 ? "+" : "") + funding.ratePct.toFixed(4)}%
                    </span>
                  </div>
                  {funding.mark != null ? (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#8b9bb4" }}>Mark</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {funding.mark < 1
                          ? funding.mark.toPrecision(5)
                          : funding.mark.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                    </div>
                  ) : null}
                  {funding.nextFundingTime ? (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#8b9bb4" }}>Next</span>
                      <span style={{ fontSize: "0.68rem" }}>
                        {new Date(funding.nextFundingTime).toLocaleTimeString()}
                      </span>
                    </div>
                  ) : null}
                  <div style={{ fontSize: "0.62rem", color: "#6b7c93", marginTop: 4 }}>
                    {fundingStatus}
                    <br />
                    Perp funding (not spot). + = longs pay shorts.
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

<div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (showVsBtc ? " active" : "")}
            title="vs BTC relative strength"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
            onClick={() => {
              setShowVsBtc((v) => !v);
              if (!showVsBtc) {
                setShowIndBox(false);
                setShowWatch(false);
                setShowLiq(false);
                setShowFunding(false);
              }
            }}
          >
            vs BTC
          </button>
          {showVsBtc ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 120,
                width: 220,
                minHeight: 72,
                padding: "8px",
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "#0f141c",
                boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
                fontSize: "0.72rem",
                color: "#c5d0e0",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#6b7c93",
                  padding: "2px 4px 8px",
                }}
              >
                vs BTC
              </div>
              {!vsBtc ? (
                <div style={{ color: "#8b9bb4", padding: "8px 4px", lineHeight: 1.4 }}>
                  {vsBtcStatus || "Open this menu to load vs BTC…"}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 6, padding: "0 4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Ratio</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {vsBtc.ratio < 0.0001
                        ? vsBtc.ratio.toExponential(3)
                        : vsBtc.ratio.toPrecision(5)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Asset</span>
                    <span
                      style={{
                        color: vsBtc.assetPct >= 0 ? "#4ade80" : "#f87171",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(vsBtc.assetPct >= 0 ? "+" : "") + vsBtc.assetPct.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>BTC</span>
                    <span
                      style={{
                        color: vsBtc.btcPct >= 0 ? "#4ade80" : "#f87171",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(vsBtc.btcPct >= 0 ? "+" : "") + vsBtc.btcPct.toFixed(2)}%
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 4,
                      paddingTop: 6,
                      borderTop: "1px solid rgba(148,163,184,0.12)",
                      fontWeight: 600,
                    }}
                  >
                    <span>Relative</span>
                    <span
                      style={{
                        color: vsBtc.rel >= 0 ? "#22d3ee" : "#fbbf24",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(vsBtc.rel >= 0 ? "+" : "") + vsBtc.rel.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ fontSize: "0.62rem", color: "#6b7c93", marginTop: 4 }}>
                    Same window as chart · ratio Δ{" "}
                    {(vsBtc.ratioPct >= 0 ? "+" : "") + vsBtc.ratioPct.toFixed(2)}%
                    {vsBtcStatus ? " · " + vsBtcStatus : ""}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

<div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (showLiq ? " active" : "")}
            onClick={() => {
              setShowLiq((v) => !v);
              if (!showLiq) {
                setShowIndBox(false);
                setShowWatch(false);
                setShowVsBtc(false);
                setShowFunding(false);
              }
            }}
            title="Order book liquidity heatmap"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
          >
            Liquidity
          </button>
          {showLiq ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 80,
                width: 220,
                maxHeight: 340,
                overflowY: "auto",
                padding: "8px",
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "#0f141c",
                boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#6b7c93",
                  padding: "2px 4px 6px",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>Liquidity</span>
                <span style={{ textTransform: "none", letterSpacing: 0 }}>{bookStatus}</span>
              </div>
              {!book ? (
                <div style={{ fontSize: "0.72rem", color: "#8b9bb4", padding: 8 }}>
                  Loading book…
                </div>
              ) : (
                bookHeatRows(book).map((row, i) => (
                  <div
                    key={row.side + "-" + row.price + "-" + i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "64px 1fr 52px",
                      gap: 6,
                      alignItems: "center",
                      marginBottom: 3,
                      fontSize: "0.68rem",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span style={{ color: row.side === "ask" ? "#f87171" : "#4ade80" }}>
                      {row.price < 1
                        ? row.price.toPrecision(4)
                        : row.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 3,
                        background: "rgba(148,163,184,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: row.pct + "%",
                          borderRadius: 3,
                          background:
                            row.side === "ask"
                              ? "linear-gradient(90deg, rgba(239,68,68,0.15), rgba(239,68,68,0.85))"
                              : "linear-gradient(90deg, rgba(34,197,94,0.15), rgba(34,197,94,0.85))",
                        }}
                      />
                    </div>
                    <span style={{ color: "#8b9bb4", textAlign: "right" }}>
                      {row.size >= 1000
                        ? (row.size / 1000).toFixed(1) + "k"
                        : row.size < 1
                          ? row.size.toPrecision(3)
                          : row.size.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
              <div
                style={{
                  marginTop: 6,
                  fontSize: "0.62rem",
                  color: "#6b7c93",
                  padding: "4px 2px 0",
                }}
              >
                Asks (red) · Bids (green) · depth size
              </div>
            </div>
          ) : null}
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

        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className={"interval-btn" + (showWatch ? " active" : "")}
            onClick={() => {
              setShowWatch((v) => !v);
              if (!showWatch) {
                setShowIndBox(false);
                setShowLiq(false);
                setShowVsBtc(false);
                setShowFunding(false);
              }
            }}
            title="Watchlist"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
          >
            ★ {watchlist.length || ""}
          </button>
          <button
            type="button"
            className="interval-btn"
            onClick={addToWatchlist}
            title={"Add " + displaySymbol(symbol)}
            style={{ fontSize: "0.72rem", padding: "4px 8px", minWidth: 28 }}
          >
            +
          </button>
          {showWatch ? (
            <div
              role="listbox"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 80,
                width: 168,
                maxHeight: 220,
                overflowY: "auto",
                padding: "6px",
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.22)",
                background: "#0f141c",
                boxShadow: "0 12px 28px rgba(0,0,0,0.55)",
              }}
            >
              <div
                style={{
                  fontSize: "0.65rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#6b7c93",
                  padding: "2px 6px 6px",
                }}
              >
                Watchlist
              </div>
              {watchlist.length === 0 ? (
                <div style={{ fontSize: "0.72rem", color: "#8b9bb4", padding: "6px" }}>
                  No tickers yet
                </div>
              ) : (
                watchlist.map((sym) => (
                  <div
                    key={sym}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      marginBottom: 2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => openWatchSymbol(sym)}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        fontSize: "0.72rem",
                        padding: "5px 8px",
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        background: symbol === sym ? "rgba(34, 211, 238, 0.15)" : "transparent",
                        color: symbol === sym ? "#22d3ee" : "#c5d0e0",
                        fontWeight: symbol === sym ? 600 : 500,
                      }}
                      onMouseEnter={(e) => {
                        if (symbol !== sym) e.currentTarget.style.background = "rgba(148,163,184,0.1)";
                      }}
                      onMouseLeave={(e) => {
                        if (symbol !== sym) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {displaySymbol(sym)}
                    </button>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => removeFromWatchlist(sym)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#6b7c93",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                        padding: "2px 6px",
                        lineHeight: 1,
                        borderRadius: 4,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>



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
              drawings={showSessions ? drawings.concat(sessionOverlay) : drawings}
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
