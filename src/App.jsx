import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CandleChart from "./components/CandleChart.jsx";
import MiniChart from "./components/MiniChart.jsx";
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




/** London 08:00 UTC & NY 13:30 UTC — intraday only; snapped to real bars (safe on 1D/1W). */
function buildSessionMarkers(bars, interval) {
  if (!bars || bars.length < 2) return [];
  // Daily/weekly: session opens are not meaningful as intraday vlines and can crash markers
  if (interval === "1d" || interval === "1w") return [];

  const times = bars.map(function (b) {
    return b.time;
  });
  const tFirst = times[0];
  const tLast = times[times.length - 1];

  function nearestBarTime(target) {
    let best = times[0];
    let bestD = Math.abs(times[0] - target);
    for (let i = 1; i < times.length; i++) {
      const d = Math.abs(times[i] - target);
      if (d < bestD) {
        best = times[i];
        bestD = d;
      }
    }
    // reject if nothing close (avoid bogus markers)
    const maxDist =
      interval === "4h" ? 3 * 3600 : interval === "1h" ? 3600 : 15 * 60 * 4;
    if (bestD > maxDist) return null;
    return best;
  }

  const d0 = new Date(tFirst * 1000);
  let day =
    Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) / 1000;
  const end = tLast + 86400;
  const out = [];
  const used = {};

  while (day <= end && out.length < 80) {
    const targets = [
      { id: "sess-lon-" + day, time: day + 8 * 3600, session: "London" },
      { id: "sess-ny-" + day, time: day + 13 * 3600 + 30 * 60, session: "NY" },
    ];
    for (let k = 0; k < targets.length; k++) {
      const tg = targets[k];
      if (tg.time < tFirst - 3600 || tg.time > tLast + 3600) continue;
      const snapped = nearestBarTime(tg.time);
      if (snapped == null) continue;
      if (used[snapped]) continue;
      used[snapped] = true;
      out.push({
        id: tg.id,
        type: "vline",
        time: snapped,
        price: 0,
        session: tg.session,
      });
    }
    day += 86400;
  }
  return out;
}





/** Comprehensive technical readout from loaded OHLCV only (no paid data). Not a guarantee of future price. */

function baseAsset(symbol) {
  let s = String(symbol || "").toUpperCase().replace(/\s+/g, "");
  s = s.replace("-USD", "").replace("-USDT", "").replace("USDT", "").replace("USD", "");
  return s || "BTC";
}

/** Free market context: Binance.US 24h + CoinGecko mcap when available. Fail soft. */
async function fetchMarketContext(symbol) {
  const base = baseAsset(symbol);
  const futuresSym = base.endsWith("USDT") ? base : base + "USDT";
  const out = {
    base: base,
    price: null,
    change24h: null,
    volume24h: null,
    high24h: null,
    low24h: null,
    marketCap: null,
    rank: null,
    cgName: null,
    source: [],
    notes: [],
  };

  // Exchange 24h (accurate, free)
  try {
    const res = await fetch(
      "https://api.binance.us/api/v3/ticker/24hr?symbol=" +
        encodeURIComponent(futuresSym)
    );
    if (res.ok) {
      const t = await res.json();
      out.price = parseFloat(t.lastPrice);
      out.change24h = parseFloat(t.priceChangePercent);
      out.volume24h = parseFloat(t.quoteVolume); // USDT volume
      out.high24h = parseFloat(t.highPrice);
      out.low24h = parseFloat(t.lowPrice);
      out.source.push("Binance.US 24h");
    } else {
      out.notes.push("Binance.US ticker " + res.status);
    }
  } catch (e) {
    out.notes.push("Binance.US unavailable");
  }

  // CoinGecko — mcap / rank (public, rate-limited; may fail CORS or 429)
  try {
    const q = await fetch(
      "https://api.coingecko.com/api/v3/search?query=" + encodeURIComponent(base)
    );
    if (q.ok) {
      const sj = await q.json();
      const coins = (sj && sj.coins) || [];
      const hit =
        coins.find(function (c) {
          return String(c.symbol || "").toUpperCase() === base;
        }) || coins[0];
      if (hit && hit.id) {
        out.cgName = hit.name || null;
        const m = await fetch(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=" +
            encodeURIComponent(hit.id) +
            "&sparkline=false"
        );
        if (m.ok) {
          const arr = await m.json();
          const row = arr && arr[0];
          if (row) {
            if (out.price == null && row.current_price != null)
              out.price = row.current_price;
            if (out.change24h == null && row.price_change_percentage_24h != null)
              out.change24h = row.price_change_percentage_24h;
            out.marketCap = row.market_cap != null ? row.market_cap : null;
            out.rank = row.market_cap_rank != null ? row.market_cap_rank : null;
            if (row.total_volume != null && out.volume24h == null)
              out.volume24h = row.total_volume;
            out.source.push("CoinGecko");
          }
        } else {
          out.notes.push("CoinGecko markets " + m.status);
        }
      }
    } else {
      out.notes.push("CoinGecko search " + q.status);
    }
  } catch (e) {
    out.notes.push("CoinGecko unavailable (CORS/rate limit)");
  }

  // Honest liquidity band from 24h quote volume when present
  if (out.volume24h != null && Number.isFinite(out.volume24h)) {
    if (out.volume24h >= 5e8) out.liquidity = "High liquidity (24h)";
    else if (out.volume24h >= 5e7) out.liquidity = "Medium liquidity (24h)";
    else if (out.volume24h >= 5e6) out.liquidity = "Lower liquidity (24h)";
    else out.liquidity = "Thin liquidity (24h)";
  } else {
    out.liquidity = null;
  }

  return out;
}

function formatUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}


function analyzeChart(bars, symbol) {
  if (!bars || bars.length < 30) {
    return {
      bias: "Insufficient data",
      tone: "muted",
      score: 0,
      summary: "Need at least ~30 candles for a stable readout.",
      factors: [],
    };
  }

  const n = bars.length;
  const closes = bars.map(function (b) {
    return b.close;
  });
  const vols = bars.map(function (b) {
    return b.volume || 0;
  });
  const last = bars[n - 1];
  const prev = bars[n - 2];

  function smaAt(period) {
    if (n < period) return null;
    let s = 0;
    for (let i = n - period; i < n; i++) s += closes[i];
    return s / period;
  }

  function rsiVal(period) {
    period = period || 14;
    if (n < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = n - period; i < n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d;
      else losses -= d;
    }
    const ag = gains / period;
    const al = losses / period;
    if (al === 0) return 100;
    const rs = ag / al;
    return 100 - 100 / (1 + rs);
  }

  const sma20 = smaAt(20);
  const sma50 = smaAt(50);
  const sma200 = smaAt(200);
  const rsi = rsiVal(14);

  // Momentum windows
  const ret = function (len) {
    if (n <= len) return null;
    return ((closes[n - 1] / closes[n - 1 - len]) - 1) * 100;
  };
  const r5 = ret(5);
  const r20 = ret(20);

  // Volume vs avg
  let volAvg = 0;
  const volN = Math.min(20, n);
  for (let i = n - volN; i < n; i++) volAvg += vols[i];
  volAvg = volAvg / volN || 1;
  const volRatio = (last.volume || 0) / volAvg;

  // Simple structure: last 10 swing direction
  const slice = bars.slice(-12);
  let hh = 0;
  let hl = 0;
  let lh = 0;
  let ll = 0;
  for (let i = 2; i < slice.length; i++) {
    if (slice[i].high > slice[i - 1].high && slice[i - 1].high > slice[i - 2].high) hh++;
    if (slice[i].low > slice[i - 1].low && slice[i - 1].low > slice[i - 2].low) hl++;
    if (slice[i].high < slice[i - 1].high && slice[i - 1].high < slice[i - 2].high) lh++;
    if (slice[i].low < slice[i - 1].low && slice[i - 1].low < slice[i - 2].low) ll++;
  }

  // MACD-ish: EMA12 - EMA26 approx via SMA for stability without full series
  function emaLast(period) {
    const k = 2 / (period + 1);
    let e = closes[0];
    for (let i = 1; i < n; i++) e = closes[i] * k + e * (1 - k);
    return e;
  }
  const macdLine = emaLast(12) - emaLast(26);
  // prior macd rough
  const closesPrior = closes.slice(0, -3);
  let e12 = closesPrior[0];
  let e26 = closesPrior[0];
  const k12 = 2 / 13;
  const k26 = 2 / 27;
  for (let i = 1; i < closesPrior.length; i++) {
    e12 = closesPrior[i] * k12 + e12 * (1 - k12);
    e26 = closesPrior[i] * k26 + e26 * (1 - k26);
  }
  const macdPrior = e12 - e26;
  const macdRising = macdLine > macdPrior;

  const factors = [];
  let score = 0; // -10..+10

  // Trend
  if (sma50 != null) {
    if (last.close > sma50) {
      score += 2;
      factors.push({ name: "Price vs SMA50", detail: "Above — bullish bias", dir: "up" });
    } else {
      score -= 2;
      factors.push({ name: "Price vs SMA50", detail: "Below — bearish bias", dir: "down" });
    }
  }
  if (sma20 != null && sma50 != null) {
    if (sma20 > sma50) {
      score += 1;
      factors.push({ name: "SMA20 / SMA50", detail: "Short MA above long — uptrend stack", dir: "up" });
    } else {
      score -= 1;
      factors.push({ name: "SMA20 / SMA50", detail: "Short MA below long — downtrend stack", dir: "down" });
    }
  }
  if (sma200 != null) {
    if (last.close > sma200) {
      score += 1;
      factors.push({ name: "Price vs SMA200", detail: "Above long-term mean", dir: "up" });
    } else {
      score -= 1;
      factors.push({ name: "Price vs SMA200", detail: "Below long-term mean", dir: "down" });
    }
  }

  // RSI
  if (rsi != null) {
    if (rsi >= 70) {
      score -= 1;
      factors.push({ name: "RSI(14)", detail: rsi.toFixed(1) + " — overbought risk", dir: "down" });
    } else if (rsi <= 30) {
      score += 1;
      factors.push({ name: "RSI(14)", detail: rsi.toFixed(1) + " — oversold bounce zone", dir: "up" });
    } else if (rsi >= 55) {
      score += 1;
      factors.push({ name: "RSI(14)", detail: rsi.toFixed(1) + " — bullish momentum zone", dir: "up" });
    } else if (rsi <= 45) {
      score -= 1;
      factors.push({ name: "RSI(14)", detail: rsi.toFixed(1) + " — bearish momentum zone", dir: "down" });
    } else {
      factors.push({ name: "RSI(14)", detail: rsi.toFixed(1) + " — neutral", dir: "flat" });
    }
  }

  // Momentum
  if (r5 != null) {
    if (r5 > 1) {
      score += 1;
      factors.push({ name: "5-bar momentum", detail: (r5 >= 0 ? "+" : "") + r5.toFixed(2) + "%", dir: "up" });
    } else if (r5 < -1) {
      score -= 1;
      factors.push({ name: "5-bar momentum", detail: r5.toFixed(2) + "%", dir: "down" });
    } else {
      factors.push({ name: "5-bar momentum", detail: (r5 >= 0 ? "+" : "") + r5.toFixed(2) + "% — flat", dir: "flat" });
    }
  }
  if (r20 != null) {
    if (r20 > 3) {
      score += 1;
      factors.push({ name: "20-bar momentum", detail: "+" + r20.toFixed(2) + "%", dir: "up" });
    } else if (r20 < -3) {
      score -= 1;
      factors.push({ name: "20-bar momentum", detail: r20.toFixed(2) + "%", dir: "down" });
    } else {
      factors.push({ name: "20-bar momentum", detail: (r20 >= 0 ? "+" : "") + r20.toFixed(2) + "%", dir: "flat" });
    }
  }

  // MACD direction
  if (macdRising && macdLine > 0) {
    score += 1;
    factors.push({ name: "MACD trend", detail: "Positive & rising", dir: "up" });
  } else if (!macdRising && macdLine < 0) {
    score -= 1;
    factors.push({ name: "MACD trend", detail: "Negative & falling", dir: "down" });
  } else if (macdRising) {
    factors.push({ name: "MACD trend", detail: "Rising (improving)", dir: "up" });
    score += 0.5;
  } else {
    factors.push({ name: "MACD trend", detail: "Softening", dir: "down" });
    score -= 0.5;
  }

  // Volume
  if (volRatio >= 1.5 && last.close >= last.open) {
    score += 1;
    factors.push({ name: "Volume", detail: volRatio.toFixed(2) + "× avg on green bar — demand", dir: "up" });
  } else if (volRatio >= 1.5 && last.close < last.open) {
    score -= 1;
    factors.push({ name: "Volume", detail: volRatio.toFixed(2) + "× avg on red bar — supply", dir: "down" });
  } else {
    factors.push({ name: "Volume", detail: volRatio.toFixed(2) + "× 20-bar avg", dir: "flat" });
  }

  // Structure
  if (hh + hl > lh + ll + 1) {
    score += 1;
    factors.push({ name: "Swing structure", detail: "Higher highs/lows lean", dir: "up" });
  } else if (lh + ll > hh + hl + 1) {
    score -= 1;
    factors.push({ name: "Swing structure", detail: "Lower highs/lows lean", dir: "down" });
  } else {
    factors.push({ name: "Swing structure", detail: "Mixed / range-like", dir: "flat" });
  }

  // Candle
  const body = last.close - last.open;
  const range = Math.max(1e-12, last.high - last.low);
  if (body > 0 && Math.abs(body) / range > 0.6) {
    score += 0.5;
    factors.push({ name: "Last candle", detail: "Strong close near highs", dir: "up" });
  } else if (body < 0 && Math.abs(body) / range > 0.6) {
    score -= 0.5;
    factors.push({ name: "Last candle", detail: "Weak close near lows", dir: "down" });
  }

  score = Math.max(-10, Math.min(10, score));
  const abs = Math.abs(score);
  let bias;
  let tone;
  let summary;
  if (score >= 4) {
    bias = "Bullish bias";
    tone = "up";
    summary =
      "Factors stack toward upside continuation. Still wait for your levels — this is bias, not a guarantee.";
  } else if (score <= -4) {
    bias = "Bearish bias";
    tone = "down";
    summary =
      "Factors stack toward downside pressure. Confirmation at structure still matters.";
  } else if (score >= 1.5) {
    bias = "Mild bullish";
    tone = "up";
    summary = "Slight upside lean; easy to flip — treat as soft bias only.";
  } else if (score <= -1.5) {
    bias = "Mild bearish";
    tone = "down";
    summary = "Slight downside lean; chop risk is high.";
  } else {
    bias = "Neutral / range";
    tone = "muted";
    summary = "Mixed signals. Better to wait for break of structure than force a call.";
  }

  return {
    bias,
    tone,
    score: Math.round(score * 10) / 10,
    summary,
    factors,
    symbol: symbol,
    last: last.close,
  };
}



/** Apply one trade into an OHLCV series for a given bucket size (live multi-TF). */
function applyLiveTrade(prevBars, price, tradeSize, tradeTime, bucketSec) {
  if (!prevBars || !prevBars.length || !bucketSec) return prevBars;
  if (price == null || !Number.isFinite(price)) return prevBars;
  const candleStart = Math.floor(tradeTime / bucketSec) * bucketSec;
  const lastBar = prevBars[prevBars.length - 1];
  if (candleStart === lastBar.time) {
    const updated = prevBars.slice();
    updated[updated.length - 1] = {
      time: lastBar.time,
      open: lastBar.open,
      high: Math.max(lastBar.high, price),
      low: Math.min(lastBar.low, price),
      close: price,
      volume: (lastBar.volume || 0) + (tradeSize || 0),
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
        volume: tradeSize || 0,
      },
    ]);
  }
  return prevBars;
}


function companionIntervals(current) {
  const map = {
    "1m": ["15m", "1h"],
    "5m": ["15m", "1h"],
    "15m": ["1h", "4h"],
    "1h": ["15m", "4h"],
    "4h": ["1h", "1d"],
    "1d": ["4h", "1w"],
    "1w": ["1d", "4h"],
  };
  return map[current] || ["1h", "4h"];
}


/** Spot setup suggestion from loaded bars + optional TF/funding/context. Not financial advice. */
function buildSpotSetup(bars, alignInfo, funding, marketCtx) {
  if (!bars || bars.length < 30) {
    return {
      ok: false,
      title: "Need more candles",
      detail: "Load at least ~30 bars for structure-based levels.",
      side: null,
    };
  }

  const n = bars.length;
  const last = bars[n - 1];
  const price = last.close;

  // ATR(14) simple
  let atrSum = 0;
  const atrN = Math.min(14, n - 1);
  for (let i = n - atrN; i < n; i++) {
    const prev = bars[i - 1];
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prev.close),
      Math.abs(bars[i].low - prev.close)
    );
    atrSum += tr;
  }
  const atr = atrSum / atrN || price * 0.01;

  // Swings: last 20 bars
  const win = bars.slice(-20);
  let swingHigh = win[0].high;
  let swingLow = win[0].low;
  for (let i = 1; i < win.length; i++) {
    if (win[i].high > swingHigh) swingHigh = win[i].high;
    if (win[i].low < swingLow) swingLow = win[i].low;
  }

  const tech = analyzeChart(bars, "");
  const score = tech.score || 0;

  // TF alignment tone
  const tfTone = (alignInfo && alignInfo.tone) || "muted";
  const tfLabel = (alignInfo && alignInfo.label) || "TF —";

  // Volume
  let volAvg = 0;
  const vn = Math.min(20, n);
  for (let i = n - vn; i < n; i++) volAvg += bars[i].volume || 0;
  volAvg = volAvg / vn || 1;
  const volRatio = (last.volume || 0) / volAvg;

  // Funding caution
  let fundingNote = null;
  let fundingCaution = false;
  if (funding && typeof funding.ratePct === "number") {
    if (funding.ratePct >= 0.05) {
      fundingCaution = true;
      fundingNote = "Funding elevated (longs paying) — crowd risk on longs";
    } else if (funding.ratePct <= -0.05) {
      fundingCaution = true;
      fundingNote = "Funding negative (shorts paying) — crowd risk on shorts";
    } else {
      fundingNote = "Funding near neutral (" + funding.ratePct.toFixed(4) + "%)";
    }
  }

  // Liquidity note from market context
  let liqNote = null;
  if (marketCtx && marketCtx.liquidity) {
    liqNote = marketCtx.liquidity;
    if (String(marketCtx.liquidity).indexOf("Thin") >= 0) {
      fundingCaution = true; // reuse flag for size-down
    }
  }

  // Decide side
  let side = null; // "long" | "short" | null
  let reasons = [];

  if (score >= 2 && tfTone !== "down") {
    side = "long";
    reasons.push("Tech score " + score + " (bullish lean)");
  } else if (score <= -2 && tfTone !== "up") {
    side = "short";
    reasons.push("Tech score " + score + " (bearish lean)");
  } else if (score >= 1.5 && tfTone === "up") {
    side = "long";
    reasons.push("Mild tech + TF lean up");
  } else if (score <= -1.5 && tfTone === "down") {
    side = "short";
    reasons.push("Mild tech + TF lean down");
  } else {
    return {
      ok: true,
      side: null,
      title: "No clear spot setup",
      detail:
        "Mixed or weak confluence. Wait for clearer structure instead of forcing an entry.",
      price: price,
      score: score,
      tfLabel: tfLabel,
      reasons: [
        "Tech: " + (tech.bias || "n/a"),
        "TF: " + tfLabel,
        volRatio >= 1.2 ? "Volume active" : "Volume quiet",
      ],
      fundingNote: fundingNote,
      liqNote: liqNote,
      disclaimer: true,
    };
  }

  reasons.push("TF: " + tfLabel);
  if (volRatio >= 1.3) reasons.push("Volume " + volRatio.toFixed(2) + "× avg (supportive)");
  else if (volRatio < 0.7) reasons.push("Volume light — weaker conviction");

  // Levels
  let entryLow, entryHigh, stop, t1, t2;
  if (side === "long") {
    // Prefer pullback toward swing mid / last low area
    const pull = Math.max(swingLow, price - atr * 0.8);
    entryLow = Math.min(pull, price);
    entryHigh = price;
    // If extended above mid-range, suggest waiting for dip
    const mid = (swingHigh + swingLow) / 2;
    const extended = price > mid + atr * 0.5;
    if (extended) {
      entryHigh = Math.min(price, mid + atr * 0.15);
      entryLow = Math.max(swingLow, mid - atr * 0.4);
      reasons.push("Price extended — prefer dip into zone, not chase");
    }
    stop = Math.min(entryLow, swingLow) - atr * 0.35;
    const risk = Math.max(price * 0.001, entryHigh - stop);
    t1 = price + risk * 1.5;
    t2 = price + risk * 2.5;
    // Cap target near swing high if close
    if (swingHigh > price) t1 = Math.min(t1, swingHigh);
  } else {
    const push = Math.min(swingHigh, price + atr * 0.8);
    entryHigh = Math.max(push, price);
    entryLow = price;
    const mid = (swingHigh + swingLow) / 2;
    const extended = price < mid - atr * 0.5;
    if (extended) {
      entryLow = Math.max(price, mid - atr * 0.15);
      entryHigh = Math.min(swingHigh, mid + atr * 0.4);
      reasons.push("Price extended down — prefer bounce into zone");
    }
    stop = Math.max(entryHigh, swingHigh) + atr * 0.35;
    const risk = Math.max(price * 0.001, stop - entryLow);
    t1 = price - risk * 1.5;
    t2 = price - risk * 2.5;
    if (swingLow < price) t1 = Math.max(t1, swingLow);
  }

  function fmt(x) {
    if (x == null || !Number.isFinite(x)) return "—";
    if (x >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (x >= 1) return x.toFixed(4);
    return x.toPrecision(5);
  }

  const sizeNote = fundingCaution
    ? "Consider smaller size (funding and/or thin liquidity)."
    : "Size only what you can risk; levels are structural, not guarantees.";

  return {
    ok: true,
    side: side,
    title: side === "long" ? "Spot long setup (suggestion)" : "Spot short setup (suggestion)",
    detail: tech.summary || "",
    price: price,
    score: score,
    tfLabel: tfLabel,
    atr: atr,
    entryLow: entryLow,
    entryHigh: entryHigh,
    stop: stop,
    t1: t1,
    t2: t2,
    fmt: fmt,
    reasons: reasons,
    fundingNote: fundingNote,
    liqNote: liqNote,
    sizeNote: sizeNote,
    disclaimer: true,
  };
}



/** Prior completed UTC day high/low/close from loaded bars (free, accurate). */
function priorDayLevels(bars) {
  if (!bars || bars.length < 5) return null;
  const days = [];
  let curKey = null;
  let cur = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const key = new Date(b.time * 1000).toISOString().slice(0, 10);
    if (key !== curKey) {
      if (cur) days.push(cur);
      curKey = key;
      cur = { key, high: b.high, low: b.low, close: b.close, open: b.open };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  if (cur) days.push(cur);
  if (days.length < 2) {
    // Daily TF: previous candle is prior day
    if (bars.length >= 2 && (bars[bars.length - 1].time - bars[bars.length - 2].time) >= 80000) {
      const p = bars[bars.length - 2];
      return { high: p.high, low: p.low, close: p.close };
    }
    return null;
  }
  // Last bucket may be "today" (incomplete); use the one before
  const prior = days[days.length - 2];
  return { high: prior.high, low: prior.low, close: prior.close };
}



/** Session background zones (London / NY) as rect overlays — free, time-based. */
function buildSessionBands(bars, interval) {
  if (!bars || bars.length < 2) return [];
  if (interval === "1d" || interval === "1w") return [];

  const tFirst = bars[0].time;
  const tLast = bars[bars.length - 1].time;
  const d0 = new Date(tFirst * 1000);
  let day =
    Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) / 1000;
  const end = tLast + 86400;
  const out = [];

  function rangeHL(t0, t1) {
    let hi = null;
    let lo = null;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (b.time < t0 || b.time > t1) continue;
      hi = hi == null ? b.high : Math.max(hi, b.high);
      lo = lo == null ? b.low : Math.min(lo, b.low);
    }
    return hi != null ? { hi: hi, lo: lo } : null;
  }

  while (day <= end && out.length < 40) {
    const lon0 = day + 8 * 3600;
    const lon1 = day + 16 * 3600;
    const ny0 = day + 13 * 3600 + 30 * 60;
    const ny1 = day + 20 * 3600;

    if (lon1 >= tFirst && lon0 <= tLast) {
      const hl = rangeHL(lon0, lon1);
      if (hl) {
        out.push({
          id: "sess-band-lon-" + day,
          type: "rect",
          t1: lon0,
          t2: lon1,
          p1: hl.lo,
          p2: hl.hi,
          sessionBand: true,
          color: "rgba(167,139,250,0.55)",
        });
      }
    }
    if (ny1 >= tFirst && ny0 <= tLast) {
      const hl = rangeHL(ny0, ny1);
      if (hl) {
        out.push({
          id: "sess-band-ny-" + day,
          type: "rect",
          t1: ny0,
          t2: ny1,
          p1: hl.lo,
          p2: hl.hi,
          sessionBand: true,
          color: "rgba(251,146,60,0.5)",
        });
      }
    }
    day += 86400;
  }
  return out;
}

function bookWallLevels(book) {
  if (!book || !book.bids || !book.asks) return [];
  const levels = [];
  const bids = book.bids
    .slice()
    .sort(function (a, b) {
      return b.size - a.size;
    })
    .slice(0, 2);
  const asks = book.asks
    .slice()
    .sort(function (a, b) {
      return b.size - a.size;
    })
    .slice(0, 2);
  bids.forEach(function (b, i) {
    if (!Number.isFinite(b.price)) return;
    levels.push({
      id: "wall-bid-" + i,
      price: b.price,
      title: i === 0 ? "Bid wall" : "",
      color: i === 0 ? "rgba(57,255,20,0.9)" : "rgba(57,255,20,0.3)",
      lineWidth: i === 0 ? 2 : 1,
      lineStyle: 2,
      axisLabelVisible: i === 0,
    });
  });
  asks.forEach(function (b, i) {
    if (!Number.isFinite(b.price)) return;
    levels.push({
      id: "wall-ask-" + i,
      price: b.price,
      title: i === 0 ? "Ask wall" : "",
      color: i === 0 ? "rgba(255,7,58,0.9)" : "rgba(255,7,58,0.3)",
      lineWidth: i === 0 ? 2 : 1,
      lineStyle: 2,
      axisLabelVisible: i === 0,
    });
  });
  return levels;
}


function structureLongShortLevels(bars) {
  if (!bars || bars.length < 30) return [];
  const n = bars.length;
  const last = bars[n - 1];
  const price = last.close;
  let atrSum = 0;
  const atrN = Math.min(14, n - 1);
  for (let i = n - atrN; i < n; i++) {
    const prev = bars[i - 1];
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prev.close),
      Math.abs(bars[i].low - prev.close)
    );
    atrSum += tr;
  }
  const atr = atrSum / atrN || price * 0.01;
  const win = bars.slice(-20);
  let swingHigh = win[0].high;
  let swingLow = win[0].low;
  for (let i = 1; i < win.length; i++) {
    if (win[i].high > swingHigh) swingHigh = win[i].high;
    if (win[i].low < swingLow) swingLow = win[i].low;
  }
  const levels = [];
  // Long structure
  const lEntry = Math.max(swingLow, price - atr * 0.5);
  const lStop = swingLow - atr * 0.35;
  const lRisk = Math.max(price * 0.001, price - lStop);
  levels.push({
    id: "ls-l-entry",
    price: lEntry,
    title: "Long",
    color: "rgba(57,255,20,0.7)",
    lineWidth: 2,
    lineStyle: 2,
    axisLabelVisible: true,
  });
  levels.push({
    id: "ls-l-stop",
    price: lStop,
    title: "",
    color: "rgba(255,7,58,0.35)",
    lineWidth: 1,
    lineStyle: 3,
    axisLabelVisible: false,
  });
  levels.push({
    id: "ls-l-t1",
    price: price + lRisk * 1.5,
    title: "",
    color: "rgba(57,255,20,0.3)",
    lineWidth: 1,
    lineStyle: 3,
    axisLabelVisible: false,
  });
  // Short structure
  const sEntry = Math.min(swingHigh, price + atr * 0.5);
  const sStop = swingHigh + atr * 0.35;
  const sRisk = Math.max(price * 0.001, sStop - price);
  levels.push({
    id: "ls-s-entry",
    price: sEntry,
    title: "Short",
    color: "rgba(255,7,58,0.7)",
    lineWidth: 2,
    lineStyle: 2,
    axisLabelVisible: true,
  });
  levels.push({
    id: "ls-s-stop",
    price: sStop,
    title: "",
    color: "rgba(57,255,20,0.35)",
    lineWidth: 1,
    lineStyle: 3,
    axisLabelVisible: false,
  });
  levels.push({
    id: "ls-s-t1",
    price: price - sRisk * 1.5,
    title: "",
    color: "rgba(255,7,58,0.3)",
    lineWidth: 1,
    lineStyle: 3,
    axisLabelVisible: false,
  });
  return levels;
}



/** High-volume nodes — max 3 labeled peaks, rest silent. */
function volumeLiquidityLevels(bars) {
  if (!bars || bars.length < 20) return [];
  const slice = bars.slice(-80);
  let lo = slice[0].low;
  let hi = slice[0].high;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].low < lo) lo = slice[i].low;
    if (slice[i].high > hi) hi = slice[i].high;
  }
  const range = hi - lo || 1;
  const buckets = 20;
  const step = range / buckets;
  const vol = new Array(buckets).fill(0);
  const mid = new Array(buckets).fill(0);
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    const px = (b.high + b.low + b.close) / 3;
    let idx = Math.floor((px - lo) / step);
    if (idx < 0) idx = 0;
    if (idx >= buckets) idx = buckets - 1;
    vol[idx] += b.volume || 0;
    mid[idx] = lo + (idx + 0.5) * step;
  }
  let maxV = 0;
  for (let i = 0; i < buckets; i++) if (vol[i] > maxV) maxV = vol[i];
  if (!(maxV > 0)) return [];
  const ranked = [];
  for (let i = 0; i < buckets; i++) {
    const strength = vol[i] / maxV;
    if (strength < 0.65) continue;
    ranked.push({ i: i, strength: strength, price: mid[i] });
  }
  ranked.sort(function (a, b) {
    return b.strength - a.strength;
  });
  const levels = [];
  ranked.slice(0, 3).forEach(function (r, n) {
    levels.push({
      id: "liq-vol-" + r.i,
      price: r.price,
      title: n === 0 ? "HVN" : "",
      color:
        n === 0
          ? "rgba(56, 189, 248, 0.85)"
          : "rgba(56, 189, 248, 0.35)",
      lineWidth: n === 0 ? 2 : 1,
      lineStyle: 2,
      axisLabelVisible: n === 0,
    });
  });
  return levels;
}

/** Deeper book — silent lines; only strongest labeled. */
function bookLiquidityLevels(book) {
  if (!book || !book.bids || !book.asks) return [];
  const levels = [];
  const bids = book.bids
    .slice()
    .sort(function (a, b) {
      return b.size - a.size;
    })
    .slice(0, 4);
  const asks = book.asks
    .slice()
    .sort(function (a, b) {
      return b.size - a.size;
    })
    .slice(0, 4);
  let maxS = 0.0001;
  bids.forEach(function (b) {
    if (b.size > maxS) maxS = b.size;
  });
  asks.forEach(function (b) {
    if (b.size > maxS) maxS = b.size;
  });
  bids.forEach(function (b, i) {
    if (!Number.isFinite(b.price)) return;
    const w = b.size / maxS;
    levels.push({
      id: "liq-bid-" + i,
      price: b.price,
      title: i === 0 && w > 0.75 ? "Bid liq" : "",
      color: "rgba(57,255,20," + (0.2 + w * 0.45).toFixed(2) + ")",
      lineWidth: i === 0 ? 2 : 1,
      lineStyle: 3,
      axisLabelVisible: i === 0 && w > 0.75,
    });
  });
  asks.forEach(function (b, i) {
    if (!Number.isFinite(b.price)) return;
    const w = b.size / maxS;
    levels.push({
      id: "liq-ask-" + i,
      price: b.price,
      title: i === 0 && w > 0.75 ? "Ask liq" : "",
      color: "rgba(255,7,58," + (0.2 + w * 0.45).toFixed(2) + ")",
      lineWidth: i === 0 ? 2 : 1,
      lineStyle: 3,
      axisLabelVisible: i === 0 && w > 0.75,
    });
  });
  return levels;
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
  const [showBookWalls, setShowBookWalls] = useState(false);
  const [showOverlayBox, setShowOverlayBox] = useState(false);
  const [showPriorDay, setShowPriorDay] = useState(false);
  const [showLiveLine, setShowLiveLine] = useState(false);
  const [showSetupLevels, setShowSetupLevels] = useState(false);
  const [showLongShort, setShowLongShort] = useState(false);
  const [showLiqOverlay, setShowLiqOverlay] = useState(false);
  const [overlayPreset, setOverlayPreset] = useState("clean");

  const applyOverlayPreset = (name) => {
    setOverlayPreset(name);
    if (name === "clean") {
      setShowPriorDay(false);
      setShowLiveLine(false);
      setShowSetupLevels(false);
      setShowLongShort(false);
      setShowBookWalls(false);
      setShowLiqOverlay(false);
    } else if (name === "intraday") {
      setShowPriorDay(true);
      setShowLiveLine(true);
      setShowSetupLevels(false);
      setShowLongShort(false);
      setShowBookWalls(false);
      setShowLiqOverlay(false);
    } else if (name === "scalp") {
      setShowPriorDay(false);
      setShowLiveLine(true);
      setShowSetupLevels(false);
      setShowLongShort(false);
      setShowBookWalls(true);
      setShowLiqOverlay(true);
    } else if (name === "structure") {
      setShowPriorDay(true);
      setShowLiveLine(true);
      setShowSetupLevels(true);
      setShowLongShort(true);
      setShowBookWalls(false);
      setShowLiqOverlay(false);
    }
  };

  const [book, setBook] = useState(null);
  const [bookStatus, setBookStatus] = useState("");
  const [showVsBtc, setShowVsBtc] = useState(false);
  const [vsBtc, setVsBtc] = useState(null);
  const [vsBtcStatus, setVsBtcStatus] = useState("");
  const [showFunding, setShowFunding] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showMultiTf, setShowMultiTf] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareInput, setCompareInput] = useState("ETH-USD");
  const [compareSymbol, setCompareSymbol] = useState("ETHUSDT");
  const [compareBars, setCompareBars] = useState([]);
  const [compareStatus, setCompareStatus] = useState("");
  const [multiBarsA, setMultiBarsA] = useState([]);
  const [multiBarsB, setMultiBarsB] = useState([]);
  const [multiLabelA, setMultiLabelA] = useState("");
  const [multiLabelB, setMultiLabelB] = useState("");
  const [multiStatus, setMultiStatus] = useState("");
  const showMultiTfRef = useRef(false);
  const multiPairRef = useRef(["1h", "4h"]);
  useEffect(() => {
    showMultiTfRef.current = showMultiTf;
  }, [showMultiTf]);
  useEffect(() => {
    multiPairRef.current = companionIntervals(interval);
  }, [interval]);
  const [marketCtx, setMarketCtx] = useState(null);
  const [marketCtxStatus, setMarketCtxStatus] = useState("");
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
    if (!showLiq && !showBookWalls && !showLiqOverlay) return undefined;
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
        if (!cancelled) {
          setBookStatus(e.message || "Book unavailable");
        }
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
  }, [symbol, showLiq, showBookWalls, showLiqOverlay]);


  // Price alerts on horizontal drawings — uses live last price; never mutates bars




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

  // Market context for Analysis panel — free sources only; never touches chart bars
  useEffect(() => {
    if (!showAnalysis) return undefined;
    let cancelled = false;
    setMarketCtxStatus("Loading market context...");
    (async () => {
      try {
        const ctx = await fetchMarketContext(symbol);
        if (cancelled) return;
        setMarketCtx(ctx);
        setMarketCtxStatus(
          ((ctx.source && ctx.source.length && ctx.source.join(" + ")) ||
            "Limited data") +
            " · " +
            new Date().toLocaleTimeString()
        );
      } catch (e) {
        if (!cancelled) {
          setMarketCtx(null);
          setMarketCtxStatus(e.message || "Context unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAnalysis, symbol]);

  useEffect(() => {
    if (!showMultiTf) return undefined;
    let cancelled = false;
    let pollTimer = null;
    const pair = companionIntervals(interval);
    setMultiLabelA(pair[0].toUpperCase());
    setMultiLabelB(pair[1].toUpperCase());

    const loadSide = async (isInitial) => {
      if (cancelled) return;
      if (isInitial) setMultiStatus("Loading " + pair[0] + " / " + pair[1] + "...");
      try {
        const ia = INTERVALS.find((i) => i.id === pair[0]);
        const ib = INTERVALS.find((i) => i.id === pair[1]);
        const [ra, rb] = await Promise.all([
          fetchOHLCV(symbol, (ia && ia.binance) || pair[0], 300),
          fetchOHLCV(symbol, (ib && ib.binance) || pair[1], 300),
        ]);
        if (cancelled) return;
        setMultiBarsA(ra.bars || []);
        setMultiBarsB(rb.bars || []);
        setMultiStatus("live");
      } catch (e) {
        if (!cancelled && isInitial) {
          setMultiBarsA([]);
          setMultiBarsB([]);
          setMultiStatus(e.message || "Multi-TF load failed");
        }
      }
    };

    loadSide(true);
    // REST refresh keeps side panes honest; tape also patches last bar when on Coinbase
    pollTimer = window.setInterval(function () {
      loadSide(false);
    }, 20 * 1000);

    return () => {
      cancelled = true;
      if (pollTimer != null) window.clearInterval(pollTimer);
    };
  }, [showMultiTf, symbol, interval]);

  // Multi-asset compare pane — same interval, second symbol
  useEffect(() => {
    if (!showCompare) return undefined;
    let cancelled = false;
    let poll = null;
    setCompareStatus("Loading " + displaySymbol(compareSymbol) + "...");

    const load = async (initial) => {
      if (cancelled) return;
      try {
        const binanceInterval =
          (INTERVALS.find((i) => i.id === interval) || {}).binance || "1d";
        const res = await fetchOHLCV(compareSymbol, binanceInterval, 500);
        if (cancelled) return;
        setCompareBars(res.bars || []);
        setCompareStatus(
          displaySymbol(compareSymbol) + " · " + (res.source || "ok")
        );
      } catch (e) {
        if (!cancelled && initial) {
          setCompareBars([]);
          setCompareStatus(e.message || "Compare load failed");
        }
      }
    };

    load(true);
    poll = window.setInterval(function () {
      load(false);
    }, 20 * 1000);

    return () => {
      cancelled = true;
      if (poll != null) window.clearInterval(poll);
    };
  }, [showCompare, compareSymbol, interval]);











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


  // Real-time WebSocket updates (Coinbase ticker primary, Binance.US kline fallback)
  useEffect(() => {
    if (!bars.length) return undefined;

    let ws = null;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let isCancelled = false;
    let attempt = 0;

    const clearTimers = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (heartbeatTimer != null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const closeWs = () => {
      if (!ws) return;
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      } catch (_) {}
      ws = null;
    };

    const scheduleReconnect = (connectFn) => {
      if (isCancelled) return;
      clearTimers();
      const delay = Math.min(10000, 1000 * Math.pow(1.6, attempt));
      attempt += 1;
      setLiveState("Reconnecting…");
      reconnectTimer = window.setTimeout(function () {
        connectFn();
      }, delay);
    };

    const applyCoinbaseTrade = (price, tradeSize, tradeTime) => {
      const bucketSec = INTERVAL_SECONDS[interval] || 86400;
      const candleStart = Math.floor(tradeTime / bucketSec) * bucketSec;

      setBars((prevBars) => {
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
            volume: (lastBar.volume || 0) + (tradeSize || 0),
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
              volume: tradeSize || 0,
            },
          ]);
        }
        return prevBars;
      });

      if (showMultiTfRef.current) {
        const pair = multiPairRef.current || [];
        const secA = INTERVAL_SECONDS[pair[0]] || 3600;
        const secB = INTERVAL_SECONDS[pair[1]] || 14400;
        setMultiBarsA((prev) =>
          applyLiveTrade(prev, price, tradeSize, tradeTime, secA)
        );
        setMultiBarsB((prev) =>
          applyLiveTrade(prev, price, tradeSize, tradeTime, secB)
        );
      }
    };

    const connectCoinbase = () => {
      if (isCancelled) return;
      closeWs();
      setLiveState("Connecting…");
      const product = toCoinbaseProduct(symbol);

      try {
        ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
      } catch (_) {
        scheduleReconnect(connectCoinbase);
        return;
      }

      ws.onopen = () => {
        if (isCancelled) return;
        attempt = 0;
        try {
          ws.send(
            JSON.stringify({
              type: "subscribe",
              product_ids: [product],
              channels: ["ticker"],
            })
          );
        } catch (_) {}
        setLiveState("● LIVE (Coinbase)");
        // Coinbase may drop idle sockets; lightweight heartbeat subscribe refresh
        heartbeatTimer = window.setInterval(function () {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          try {
            ws.send(
              JSON.stringify({
                type: "subscribe",
                product_ids: [product],
                channels: ["ticker"],
              })
            );
          } catch (_) {}
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== "ticker" || !msg.price) return;
          const price = parseFloat(msg.price);
          if (!Number.isFinite(price)) return;
          const tradeSize = parseFloat(msg.last_size || 0) || 0;
          const tradeTime = msg.time
            ? Math.floor(new Date(msg.time).getTime() / 1000)
            : Math.floor(Date.now() / 1000);
          applyCoinbaseTrade(price, tradeSize, tradeTime);
        } catch (_) {}
      };

      ws.onerror = () => {
        if (!isCancelled) setLiveState("Reconnecting…");
      };

      ws.onclose = () => {
        clearTimers();
        if (!isCancelled) scheduleReconnect(connectCoinbase);
      };
    };

    const connectBinance = () => {
      if (isCancelled) return;
      closeWs();
      setLiveState("Connecting…");
      const binanceInterval =
        (INTERVALS.find((i) => i.id === interval) || {}).binance || "1d";
      const streamSym = String(symbol || "BTCUSDT")
        .toUpperCase()
        .replace("-USD", "USDT")
        .replace("-USDT", "USDT")
        .toLowerCase();
      const streamName = streamSym + "@kline_" + binanceInterval;

      try {
        ws = new WebSocket(
          "wss://stream.binance.us:9443/ws/" + streamName
        );
      } catch (_) {
        scheduleReconnect(connectBinance);
        return;
      }

      ws.onopen = () => {
        if (isCancelled) return;
        attempt = 0;
        setLiveState("● LIVE (Binance.US)");
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
          if (!Number.isFinite(liveBar.close)) return;

          setBars((prevBars) => {
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

          if (showMultiTfRef.current) {
            const pair = multiPairRef.current || [];
            const secA = INTERVAL_SECONDS[pair[0]] || 3600;
            const secB = INTERVAL_SECONDS[pair[1]] || 14400;
            setMultiBarsA((prev) =>
              applyLiveTrade(prev, liveBar.close, 0, liveBar.time, secA)
            );
            setMultiBarsB((prev) =>
              applyLiveTrade(prev, liveBar.close, 0, liveBar.time, secB)
            );
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        if (!isCancelled) setLiveState("Reconnecting…");
      };

      ws.onclose = () => {
        if (!isCancelled) scheduleReconnect(connectBinance);
      };
    };

    if (dataSource === "coinbase") {
      connectCoinbase();
    } else {
      connectBinance();
    }

    return () => {
      isCancelled = true;
      clearTimers();
      closeWs();
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
    if (interval === "1d" || interval === "1w") return [];
    try {
      const marks = buildSessionMarkers(bars, interval);
      const bands = buildSessionBands(bars, interval);
      return marks.concat(bands);
    } catch (_) {
      return [];
    }
  }, [showSessions, bars, interval]);

  const chartAnalysis = useMemo(() => {
    if (!showAnalysis) return null;
    try {
      return analyzeChart(bars, symbol);
    } catch (_) {
      return {
        bias: "Error",
        tone: "muted",
        score: 0,
        summary: "Analysis failed on this dataset.",
        factors: [],
      };
    }
  }, [showAnalysis, bars, symbol]);

  const spotSetup = useMemo(() => {
    if (!showSetup) return null;
    try {
      return buildSpotSetup(bars, alignInfo, funding, marketCtx);
    } catch (_) {
      return {
        ok: false,
        title: "Setup error",
        detail: "Could not build levels from this data.",
        side: null,
      };
    }
  }, [showSetup, bars, alignInfo, funding, marketCtx]);

  const chartOverlays = useMemo(() => {
    const levels = [];
    if (showPriorDay) {
      const pd = priorDayLevels(bars);
      if (pd) {
        levels.push({
          id: "pdh",
          price: pd.high,
          title: "PDH",
          color: "rgba(244,114,182,0.85)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
        });
        levels.push({
          id: "pdl",
          price: pd.low,
          title: "PDL",
          color: "rgba(56,189,248,0.85)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
        });
        levels.push({
          id: "pdc",
          price: pd.close,
          title: "",
          color: "rgba(148,163,184,0.35)",
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: false,
        });
      }
    }
    if (showLiveLine) {
      const last = bars && bars.length ? bars[bars.length - 1] : null;
      if (last && Number.isFinite(last.close)) {
        levels.push({
          id: "live",
          price: last.close,
          title: "Live",
          color: "rgba(226,232,240,0.75)",
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
        });
      }
    }
    if (showSetupLevels && showSetup && spotSetup && spotSetup.side) {
      const isLong = spotSetup.side === "long";
      if (Number.isFinite(spotSetup.entryLow) && Number.isFinite(spotSetup.entryHigh)) {
        levels.push({
          id: "setup-entry-hi",
          price: spotSetup.entryHigh,
          title: "Entry",
          color: isLong ? "#39FF14" : "#FF073A",
          lineWidth: 2,
          lineStyle: 0,
        });
        if (Math.abs(spotSetup.entryHigh - spotSetup.entryLow) / spotSetup.entryHigh > 0.0005) {
          levels.push({
            id: "setup-entry-lo",
            price: spotSetup.entryLow,
            title: "Entry lo",
            color: isLong ? "#39FF14" : "#FF073A",
            lineWidth: 1,
            lineStyle: 2,
          });
        }
      }
      if (Number.isFinite(spotSetup.stop)) {
        levels.push({
          id: "setup-stop",
          price: spotSetup.stop,
          title: "Stop",
          color: "#FF073A",
          lineWidth: 2,
          lineStyle: 2,
        });
      }
      if (Number.isFinite(spotSetup.t1)) {
        levels.push({
          id: "setup-t1",
          price: spotSetup.t1,
          title: "",
          color: "rgba(57,255,20,0.4)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
      }
      if (Number.isFinite(spotSetup.t2)) {
        levels.push({
          id: "setup-t2",
          price: spotSetup.t2,
          title: "",
          color: "rgba(57,255,20,0.25)",
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: false,
        });
      }
    }
    if (showLongShort) {
      try {
        const ls = structureLongShortLevels(bars);
        for (let i = 0; i < ls.length; i++) levels.push(ls[i]);
      } catch (_) {}
    }
    if (showBookWalls) {
      try {
        const walls = bookWallLevels(book);
        for (let i = 0; i < walls.length; i++) levels.push(walls[i]);
      } catch (_) {}
    }
    if (showLiqOverlay) {
      try {
        const hvn = volumeLiquidityLevels(bars);
        for (let i = 0; i < hvn.length; i++) levels.push(hvn[i]);
      } catch (_) {}
      try {
        const depth = bookLiquidityLevels(book);
        for (let i = 0; i < depth.length; i++) levels.push(depth[i]);
      } catch (_) {}
    }
    return levels;
  }, [
    bars,
    showSetup,
    spotSetup,
    book,
    showBookWalls,
    showPriorDay,
    showLiveLine,
    showSetupLevels,
    showLongShort,
    showLiqOverlay,
  ]);

  useEffect(() => {
    if (!alertsOn || !bars.length) return;
    const price = bars[bars.length - 1].close;
    if (price == null || !Number.isFinite(price)) return;

    const prev = lastPriceRef.current;
    lastPriceRef.current = price;
    if (prev == null || !Number.isFinite(prev) || prev === price) return;

    const drawLevels = drawings
      .filter(
        (d) =>
          (d.type === "hline" || d.type === "hline_dot") &&
          Number.isFinite(d.price)
      )
      .map((d) => ({
        id: "draw-" + String(d.id || d.price),
        price: d.price,
        label: "H-line",
      }));

    // Overlay alerts (same sources as chart lines; independent of chartOverlays order)
    const ovLevels = [];
    if (showPriorDay) {
      try {
        const pd = priorDayLevels(bars);
        if (pd) {
          ovLevels.push({ id: "ov-pdh", price: pd.high, label: "PDH" });
          ovLevels.push({ id: "ov-pdl", price: pd.low, label: "PDL" });
        }
      } catch (_) {}
    }
    if (showSetupLevels && showSetup && spotSetup && spotSetup.side) {
      if (Number.isFinite(spotSetup.entryHigh)) {
        ovLevels.push({
          id: "ov-setup-entry",
          price: spotSetup.entryHigh,
          label: "Setup entry",
        });
      }
      if (Number.isFinite(spotSetup.stop)) {
        ovLevels.push({
          id: "ov-setup-stop",
          price: spotSetup.stop,
          label: "Setup stop",
        });
      }
    }
    if (showBookWalls && book) {
      try {
        const walls = bookWallLevels(book);
        walls.forEach(function (w) {
          if (w.id === "wall-bid-0" || w.id === "wall-ask-0") {
            ovLevels.push({
              id: "ov-" + w.id,
              price: w.price,
              label: w.title || "Wall",
            });
          }
        });
      } catch (_) {}
    }

    const levels = drawLevels.concat(ovLevels);
    if (!levels.length) return;

    const symLabel = displaySymbol(symbol);
    const fired = firedRef.current;

    levels.forEach((d) => {
      const level = d.price;
      const key = String(d.id || level);
      const away = Math.abs(price - level) / level > 0.0015;
      if (away && fired[key]) {
        delete fired[key];
      }

      const crossUp = prev < level && price >= level;
      const crossDown = prev > level && price <= level;
      if (!crossUp && !crossDown) return;
      if (fired[key]) return;
      fired[key] = true;

      const dir = crossUp ? "↑" : "↓";
      const msg =
        symLabel +
        " " +
        dir +
        " " +
        (d.label || "level") +
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
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification("Chart Desk alert", { body: msg, tag: key });
        }
      } catch (_) {}
    });
  }, [bars, drawings, alertsOn, symbol, showPriorDay, showSetupLevels, showSetup, spotSetup, showBookWalls, book]);




  const overlayLegend = useMemo(() => {
    const chips = [];
    if (showPriorDay) chips.push({ id: "pd", label: "PDH/PDL", color: "#f472b6" });
    if (showLiveLine) chips.push({ id: "live", label: "Live", color: "#e2e8f0" });
    if (showSetupLevels && showSetup) chips.push({ id: "setup", label: "Setup", color: "#39FF14" });
    if (showLongShort) chips.push({ id: "ls", label: "L/S", color: "#a78bfa" });
    if (showBookWalls) chips.push({ id: "walls", label: "Walls", color: "#FF073A" });
    if (showLiqOverlay) chips.push({ id: "liq", label: "Liquidity", color: "#38bdf8" });
    if (showSessions) chips.push({ id: "sess", label: "Sessions", color: "#fb923c" });
    return chips;
  }, [
    showPriorDay,
    showLiveLine,
    showSetupLevels,
    showSetup,
    showLongShort,
    showBookWalls,
    showLiqOverlay,
    showSessions,
  ]);





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
            title="Press Enter to load"
          />
          <span className="meta symbol-ticker price-box" title="Last price">
            {last ? (
              <>
                <strong className="price-val">{last.close}</strong>
                {chgPct != null && (
                  <span className={chgPct >= 0 ? "up" : "down"}>
                    {chgSign}
                    {chgText}%
                  </span>
                )}
              </>
            ) : (
              <strong className="price-val">—</strong>
            )}
          </span>
        </form>

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
                setShowAnalysis(false);
                setShowSetup(false);
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
                left: 0,
                zIndex: 500,
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
            className={"interval-btn" + (alertsOn ? " active" : "")}
            title="Alerts: drawings + PDH/PDL + Setup + walls"
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
                zIndex: 500,
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
          className={"interval-btn" + (showMultiTf ? " active" : "")}
          title="Multi-timeframe split view"
          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
          onClick={() =>
            setShowMultiTf((v) => {
              const next = !v;
              if (next) setShowCompare(false);
              return next;
            })
          }
        >
          Multi-TF
        </button>
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className={"interval-btn" + (showCompare ? " active" : "")}
            title="Compare another asset"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
            onClick={() => {
              setShowCompare((v) => {
                const next = !v;
                if (next) setShowMultiTf(false);
                return next;
              });
            }}
          >
            Compare
          </button>
          {showCompare ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const next = normalizeSymbol(compareInput);
                setCompareSymbol(next);
                setCompareInput(displaySymbol(next));
              }}
              style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
            >
              <input
                value={compareInput}
                onChange={(e) => setCompareInput(e.target.value)}
                placeholder="ETH-USD"
                style={{
                  width: 88,
                  height: 26,
                  fontSize: "0.68rem",
                  padding: "2px 6px",
                  borderRadius: 6,
                  border: "1px solid #1e2630",
                  background: "#0b0e11",
                  color: "#e8eef7",
                }}
              />
              <button type="submit" className="interval-btn" style={{ fontSize: "0.68rem", padding: "3px 8px" }}>
                Go
              </button>
            </form>
          ) : null}
        </div>


                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (showOverlayBox ? " active" : "")}
            title="Chart overlays"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
            onClick={() => {
              setShowOverlayBox((v) => !v);
              if (!showOverlayBox) {
                setShowIndBox(false);
                setShowWatch(false);
                setShowLiq(false);
                setShowAnalysis(false);
                setShowSetup(false);
              }
            }}
          >
            Overlays
          </button>
          {showOverlayBox ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 500,
                width: 200,
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
                Overlays
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                  marginBottom: 8,
                }}
              >
                {[
                  ["clean", "Clean"],
                  ["intraday", "Intraday"],
                  ["scalp", "Scalp"],
                  ["structure", "Structure"],
                ].map(function (p) {
                  const id = p[0];
                  const label = p[1];
                  return (
                    <button
                      key={id}
                      type="button"
                      className={
                        "interval-btn" + (overlayPreset === id ? " active" : "")
                      }
                      style={{ fontSize: "0.65rem", padding: "3px 7px" }}
                      onClick={function () {
                        applyOverlayPreset(id);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {[
                ["Prior day (PDH/PDL/PDC)", showPriorDay, setShowPriorDay],
                ["Live price line", showLiveLine, setShowLiveLine],
                ["Setup levels", showSetupLevels, setShowSetupLevels],
                ["Long + short structure", showLongShort, setShowLongShort],
                ["Book walls", showBookWalls, setShowBookWalls],
                ["Liquidity overlay", showLiqOverlay, setShowLiqOverlay],
              ].map(function (row) {
                const label = row[0];
                const val = row[1];
                const set = row[2];
                return (
                  <label
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 6px",
                      marginBottom: 2,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: val ? "rgba(34, 211, 238, 0.1)" : "transparent",
                      color: val ? "#22d3ee" : "#c5d0e0",
                      fontWeight: val ? 600 : 500,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={function (e) {
                        set(e.target.checked);
                      }}
                      style={{ accentColor: "#22d3ee", margin: 0 }}
                    />
                    {label}
                  </label>
                );
              })}
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(148,163,184,0.12)",
                  fontSize: "0.62rem",
                  color: "#6b7c93",
                  lineHeight: 1.35,
                }}
              >
                Liquidity = high-volume nodes from candles + deeper book levels.
                Not liquidation data. Sessions stay on the Sessions button.
              </div>
            </div>
          ) : null}
        </div>

<div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (showSetup ? " active" : "")}
            title="Spot setup suggestion"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
            onClick={() => {
              setShowSetup((v) => !v);
              if (!showSetup) {
                setShowIndBox(false);
                setShowWatch(false);
                setShowLiq(false);
                setShowVsBtc(false);
                setShowFunding(false);
                setShowAnalysis(false);
              }
            }}
          >
            Setup
          </button>
          {showSetup && spotSetup ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 500,
                width: 300,
                maxHeight: 420,
                overflowY: "auto",
                padding: "10px",
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
                  marginBottom: 6,
                }}
              >
                Spot setup
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "0.88rem",
                  marginBottom: 6,
                  color:
                    spotSetup.side === "long"
                      ? "#4ade80"
                      : spotSetup.side === "short"
                        ? "#f87171"
                        : "#e2e8f0",
                }}
              >
                {spotSetup.title}
              </div>
              <div style={{ color: "#94a3b8", marginBottom: 8, lineHeight: 1.35 }}>
                {spotSetup.detail}
              </div>
              {spotSetup.side ? (
                <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Last</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {spotSetup.fmt(spotSetup.price)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Entry zone</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {spotSetup.fmt(spotSetup.entryLow)} – {spotSetup.fmt(spotSetup.entryHigh)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Stop</span>
                    <span style={{ color: "#f87171", fontVariantNumeric: "tabular-nums" }}>
                      {spotSetup.fmt(spotSetup.stop)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Target 1</span>
                    <span style={{ color: "#4ade80", fontVariantNumeric: "tabular-nums" }}>
                      {spotSetup.fmt(spotSetup.t1)}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8b9bb4" }}>Target 2</span>
                    <span style={{ color: "#4ade80", fontVariantNumeric: "tabular-nums" }}>
                      {spotSetup.fmt(spotSetup.t2)}
                    </span>
                  </div>
                </div>
              ) : null}
              <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                {(spotSetup.reasons || []).map(function (r, i) {
                  return (
                    <div key={i} style={{ color: "#94a3b8" }}>
                      · {r}
                    </div>
                  );
                })}
                {spotSetup.fundingNote ? (
                  <div style={{ color: "#fbbf24" }}>· {spotSetup.fundingNote}</div>
                ) : null}
                {spotSetup.liqNote ? (
                  <div style={{ color: "#8b9bb4" }}>· {spotSetup.liqNote}</div>
                ) : null}
                {spotSetup.sizeNote ? (
                  <div style={{ color: "#8b9bb4" }}>· {spotSetup.sizeNote}</div>
                ) : null}
              </div>
              <div
                style={{
                  borderTop: "1px solid rgba(148,163,184,0.12)",
                  paddingTop: 8,
                  fontSize: "0.62rem",
                  color: "#6b7c93",
                  lineHeight: 1.35,
                }}
              >
                Rules-based levels from your chart (structure, ATR, tech score, TF badge).
                Optional funding/context when already loaded. Not financial advice — not a
                guaranteed entry or exit.
              </div>
            </div>
          ) : null}
        </div>

<div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            type="button"
            className={"interval-btn" + (showAnalysis ? " active" : "")}
            title="Technical + market context analysis"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
            onClick={() => {
              setShowAnalysis((v) => !v);
              if (!showAnalysis) {
                setShowIndBox(false);
                setShowWatch(false);
                setShowLiq(false);
                setShowVsBtc(false);
                setShowFunding(false);
              }
            }}
          >
            Analysis
          </button>
          {showAnalysis && chartAnalysis ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 500,
                width: 280,
                maxHeight: 360,
                overflowY: "auto",
                padding: "10px",
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
                  marginBottom: 6,
                }}
              >
                Chart analysis
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  color:
                    chartAnalysis.tone === "up"
                      ? "#4ade80"
                      : chartAnalysis.tone === "down"
                        ? "#f87171"
                        : "#e2e8f0",
                  marginBottom: 4,
                }}
              >
                {chartAnalysis.bias}{" "}
                <span style={{ color: "#8b9bb4", fontWeight: 500 }}>
                  ({chartAnalysis.score > 0 ? "+" : ""}
                  {chartAnalysis.score})
                </span>
              </div>
              <div style={{ color: "#94a3b8", marginBottom: 8, lineHeight: 1.35 }}>
                {chartAnalysis.summary}
              </div>
              <div style={{ display: "grid", gap: 5 }}>
                {(chartAnalysis.factors || []).map(function (f, i) {
                  return (
                    <div
                      key={f.name + "-" + i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "6px 1fr",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          marginTop: 4,
                          borderRadius: 99,
                          background:
                            f.dir === "up"
                              ? "#4ade80"
                              : f.dir === "down"
                                ? "#f87171"
                                : "#64748b",
                        }}
                      />
                      <div>
                        <div style={{ fontWeight: 600 }}>{f.name}</div>
                        <div style={{ color: "#8b9bb4" }}>{f.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(148,163,184,0.15)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.65rem",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "#6b7c93",
                    marginBottom: 6,
                  }}
                >
                  Market context
                </div>
                {!marketCtx ? (
                  <div style={{ color: "#8b9bb4" }}>
                    {marketCtxStatus || "Loading..."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 5 }}>
                    {marketCtx.cgName ? (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#8b9bb4" }}>Name</span>
                        <span>{marketCtx.cgName}</span>
                      </div>
                    ) : null}
                    {marketCtx.rank != null ? (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#8b9bb4" }}>MCap rank</span>
                        <span>#{marketCtx.rank}</span>
                      </div>
                    ) : null}
                    {marketCtx.marketCap != null ? (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#8b9bb4" }}>Market cap</span>
                        <span>{formatUsd(marketCtx.marketCap)}</span>
                      </div>
                    ) : null}
                    {marketCtx.volume24h != null ? (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#8b9bb4" }}>24h volume</span>
                        <span>{formatUsd(marketCtx.volume24h)}</span>
                      </div>
                    ) : null}
                    {marketCtx.change24h != null ? (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#8b9bb4" }}>24h change</span>
                        <span
                          style={{
                            color: marketCtx.change24h >= 0 ? "#4ade80" : "#f87171",
                          }}
                        >
                          {(marketCtx.change24h >= 0 ? "+" : "") +
                            marketCtx.change24h.toFixed(2)}
                          %
                        </span>
                      </div>
                    ) : null}
                    {marketCtx.liquidity ? (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#8b9bb4" }}>Liquidity</span>
                        <span>{marketCtx.liquidity}</span>
                      </div>
                    ) : null}
                    <div style={{ fontSize: "0.62rem", color: "#6b7c93", marginTop: 4 }}>
                      {marketCtxStatus}
                      {marketCtx.notes && marketCtx.notes.length
                        ? " · " + marketCtx.notes.join(" · ")
                        : ""}
                    </div>
                  </div>
                )}
              </div>
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(148,163,184,0.12)",
                  fontSize: "0.62rem",
                  color: "#6b7c93",
                  lineHeight: 1.35,
                }}
              >
                Technical = your chart candles. Context = free public market stats when
                available (not full fundamental research). Not financial advice and not a
                prediction of future price.
              </div>
            </div>
          ) : null}
        </div>

<button
          type="button"
          className={"interval-btn" + (showSessions ? " active" : "")}
          title="Session markers (intraday): London 08:00 UTC, NY 13:30 UTC — off on 1D/1W"
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
            title="Order book depth panel"
            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
          >
            Book
          </button>
          {showLiq ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 500,
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
                <span>Book depth</span>
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

        <div className="meta" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          <div style={{ position: "relative", width: "100%" }}>
            <button
              type="button"
              title="Indicators"
              aria-label="Indicators"
              className={"tool-btn" + (showIndBox ? " active" : "")}
              onClick={() => {
                setShowIndBox((v) => !v);
                if (!showIndBox) {
                  setShowWatch(false);
                  setShowLiq(false);
                  setShowVsBtc(false);
                  setShowFunding(false);
                }
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 19V5" />
                <path d="M4 19h16" />
                <path d="M8 15v-3" />
                <path d="M12 15V8" />
                <path d="M16 15v-5" />
              </svg>
            </button>
            {showIndBox ? (
              <div
                style={{
                  position: "absolute",
                  left: "calc(100% + 8px)",
                  top: 0,
                  zIndex: 500,
                  width: 168,
                  maxHeight: 320,
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

        <main className={"chart-wrap" + (showMultiTf ? " multi-tf" : "") + (showCompare ? " compare-assets" : "")}>
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

          <div className="multi-main">
          {overlayLegend.length ? (
            <div className="overlay-legend" aria-label="Active overlays">
              {overlayLegend.map(function (c) {
                return (
                  <span
                    key={c.id}
                    className="overlay-chip"
                    style={{ borderColor: c.color, color: c.color }}
                  >
                    {c.label}
                  </span>
                );
              })}
            </div>
          ) : null}

          {bars.length > 0 ? (
            <CandleChart
              bars={bars}
              symbol={symbol}
              interval={interval}
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
              overlayLevels={chartOverlays}
            />
          ) : (
            <div className="chart-panel" style={{ display: "grid", placeItems: "center", color: "#8b9bb4" }}>
              {error || "No data"}
            </div>
          )}
          </div>
          {showMultiTf ? (
            <>
              <MiniChart bars={multiBarsA} label={(multiLabelA || "TF-A") + (multiStatus ? " · " + multiStatus : "")} />
              <MiniChart bars={multiBarsB} label={multiLabelB || "TF-B"} />
            </>
          ) : null}
          {showCompare ? (
            <MiniChart
              bars={compareBars}
              label={
                (compareStatus || displaySymbol(compareSymbol)) +
                " · " +
                String(interval).toUpperCase()
              }
            />
          ) : null}
        </main>
      </div>

      <footer className={`status${error ? " error" : ""}`}>
        {error || (
          <>
            <span
              className={liveState.startsWith("● LIVE") ? "live-pulse" : ""}
              style={{
                color: liveState.startsWith("● LIVE") ? "#39FF14" : "#8b9bb4",
                fontWeight: 600,
              }}
            >
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
