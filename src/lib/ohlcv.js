/**
 * Free OHLCV:
 *  - Crypto: Coinbase (primary) + Binance.US (fallback)
 *  - Stocks: Stooq (multi-TF, free) + Yahoo fallback
 * No API keys.
 */

import { assetKind } from "./symbols.js";

const COINBASE = "https://api.exchange.coinbase.com";
const BINANCE_US = "https://api.binance.us/api/v3/klines";

const CB_GRANULARITY = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 21600,
  "1d": 86400,
};

export function toCoinbaseProduct(symbol) {
  const s = symbol.toUpperCase().trim();
  if (s.includes("-")) return s;
  if (s.endsWith("USDT")) return s.slice(0, -4) + "-USD";
  if (s.endsWith("USD")) return s.slice(0, -3) + "-USD";
  return s + "-USD";
}

async function fetchCoinbaseOHLCV(symbol, interval, limit = 300) {
  if (interval === "4h" || interval === "1w") {
    throw new Error("Use Binance.US for 4h/1w");
  }
  const granularity = CB_GRANULARITY[interval];
  if (!granularity) throw new Error("Unsupported Coinbase interval");

  const product = toCoinbaseProduct(symbol);
  const url = COINBASE + "/products/" + product + "/candles?granularity=" + granularity;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Coinbase " + res.status);

  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Empty Coinbase response");
  }

  return raw
    .slice(0, limit)
    .reverse()
    .map((k) => ({
      time: Number(k[0]),
      low: parseFloat(k[1]),
      high: parseFloat(k[2]),
      open: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
}

async function fetchBinanceOHLCV(symbol, interval = "1d", limit = 500) {
  const url = new URL(BINANCE_US);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(Math.min(1000, Math.max(50, limit))));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      "Binance.US " + res.status + ": " + (text || res.statusText)
    );
  }
  const raw = await res.json();
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function firstOk(urls, asJson) {
  let lastErr = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      if (asJson) return await fetchJson(urls[i]);
      return await fetchText(urls[i]);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All URLs failed");
}

function withCorsProxies(directUrl) {
  return [
    directUrl,
    "https://corsproxy.io/?" + encodeURIComponent(directUrl),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(directUrl),
  ];
}

function toStooqSymbol(symbol) {
  let s = String(symbol).toLowerCase().trim();
  s = s.replace(/\./g, "-");
  if (s.indexOf(".") === -1 && s.indexOf(".us") === -1) {
    s = s + ".us";
  }
  return s;
}

/** Stooq interval codes: 1,5,15,30,60,h,d,w */
const STOOQ_INTERVAL = {
  "1m": null, // not available free reliably
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "60", // aggregate from 60m
  "1d": "d",
  "1w": "w",
};

function parseStooqCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("Empty Stooq CSV");
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 5) continue;
    const dateStr = p[0].trim();
    const o = parseFloat(p[1]);
    const h = parseFloat(p[2]);
    const l = parseFloat(p[3]);
    const c = parseFloat(p[4]);
    const v = p[5] != null ? parseFloat(p[5]) : 0;
    if (![o, h, l, c].every((x) => Number.isFinite(x))) continue;

    let t;
    // Daily: YYYY-MM-DD  |  Intraday: YYYY-MM-DD HH:MM
    if (dateStr.indexOf(" ") !== -1) {
      const [ds, ts] = dateStr.split(" ");
      const [Y, M, D] = ds.split("-").map(Number);
      const [hh, mm] = (ts || "12:00").split(":").map(Number);
      t = Date.UTC(Y, M - 1, D, hh || 0, mm || 0, 0) / 1000;
    } else {
      const [Y, M, D] = dateStr.split("-").map(Number);
      if (!Y || !M || !D) continue;
      t = Date.UTC(Y, M - 1, D, 12, 0, 0) / 1000;
    }
    bars.push({
      time: t,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(v) ? v : 0,
    });
  }
  if (!bars.length) throw new Error("No Stooq bars parsed");
  bars.sort((a, b) => a.time - b.time);
  // dedupe times
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    if (!out.length || out[out.length - 1].time !== bars[i].time) {
      out.push(bars[i]);
    } else {
      out[out.length - 1] = bars[i];
    }
  }
  return out;
}

function aggregateBars(bars, bucketSec) {
  if (!bars.length) return bars;
  const out = [];
  let cur = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const bt = Math.floor(b.time / bucketSec) * bucketSec;
    if (!cur || cur.time !== bt) {
      if (cur) out.push(cur);
      cur = {
        time: bt,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function fetchStooqOHLCV(symbol, interval) {
  const code = STOOQ_INTERVAL[interval];
  if (interval === "1m") {
    throw new Error("1m stocks not available on free Stooq feed");
  }
  const stooqInterval = code || "d";
  const s = toStooqSymbol(symbol);
  const direct =
    "https://stooq.com/q/d/l/?s=" + encodeURIComponent(s) + "&i=" + stooqInterval;
  const text = await firstOk(withCorsProxies(direct), false);
  if (text.indexOf(",") === -1) throw new Error("Stooq returned non-CSV");
  let bars = parseStooqCsv(text);
  if (interval === "4h") {
    bars = aggregateBars(bars, 4 * 3600);
  }
  return bars;
}

const YAHOO_MAP = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "60m", range: "3mo" },
  "4h": { interval: "60m", range: "6mo" },
  "1d": { interval: "1d", range: "2y" },
  "1w": { interval: "1wk", range: "10y" },
};

function parseYahooChart(data) {
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error("No Yahoo chart.result");
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const ts = result.timestamp || [];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const vols = quote.volume || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (![o, h, l, c].every((x) => Number.isFinite(x))) continue;
    bars.push({
      time: ts[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: vols[i] != null ? vols[i] : 0,
    });
  }
  if (!bars.length) throw new Error("Empty Yahoo bars");
  return bars;
}

async function fetchYahooOHLCV(symbol, interval) {
  const map = YAHOO_MAP[interval] || YAHOO_MAP["1d"];
  const path =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?interval=" +
    map.interval +
    "&range=" +
    map.range +
    "&includePrePost=false";
  const path2 = path.replace("query1.", "query2.");
  const urls = withCorsProxies(path).concat(withCorsProxies(path2));
  let lastErr = null;
  for (let i = 0; i < urls.length; i++) {
    try {
      let data = await fetchJson(urls[i]);
      if (data && typeof data.contents === "string") {
        data = JSON.parse(data.contents);
      }
      let bars = parseYahooChart(data);
      if (interval === "4h") bars = aggregateBars(bars, 4 * 3600);
      return bars;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Yahoo failed");
}

export async function fetchOHLCV(symbol, interval = "1d", limit = 500) {
  if (assetKind(symbol) === "stock") {
    // Same-origin Vercel serverless proxy (avoids browser CORS/403)
    try {
      const q =
        "/api/stock?symbol=" +
        encodeURIComponent(symbol) +
        "&interval=" +
        encodeURIComponent(interval);
      const res = await fetch(q);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data && data.error) ||
            "API " + res.status + (data.details ? ": " + data.details.join(" | ") : "")
        );
      }
      if (!data.bars || !data.bars.length) throw new Error("Empty stock bars from API");
      return { bars: data.bars, source: data.source || "api" };
    } catch (e) {
      // Local dev without `vercel dev`: fall back to browser proxies (may 403)
      const errors = [e && e.message ? e.message : String(e)];
      try {
        const bars = await fetchStooqOHLCV(symbol, interval);
        return { bars, source: "stooq" };
      } catch (e2) {
        errors.push("Stooq: " + (e2 && e2.message ? e2.message : String(e2)));
      }
      try {
        const bars = await fetchYahooOHLCV(symbol, interval);
        return { bars, source: "yahoo" };
      } catch (e3) {
        errors.push("Yahoo: " + (e3 && e3.message ? e3.message : String(e3)));
      }
      throw new Error(
        "Stock fetch failed for " +
          symbol +
          " @ " +
          interval +
          ". " +
          errors.join(" | ") +
          " Deploy api/stock.js on Vercel for reliable stocks."
      );
    }
  }

  try {
    const bars = await fetchCoinbaseOHLCV(symbol, interval, 300);
    return { bars, source: "coinbase" };
  } catch {
    const bars = await fetchBinanceOHLCV(symbol, interval, limit);
    return { bars, source: "binance" };
  }
}

export function sma(bars, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) {
      out.push({ time: bars[i].time, value: sum / period });
    }
  }
  return out;
}

export function ema(bars, period) {
  if (!bars?.length) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = bars[0].close;
  for (let i = 0; i < bars.length; i++) {
    const v = i === 0 ? bars[0].close : bars[i].close * k + prev * (1 - k);
    prev = v;
    if (i >= period - 1) out.push({ time: bars[i].time, value: v });
  }
  return out;
}

export function bollinger(bars, period = 20, mult = 2) {
  const mid = [];
  const upper = [];
  const lower = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue;
    const slice = bars.slice(i - period + 1, i + 1).map((b) => b.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    mid.push({ time: bars[i].time, value: mean });
    upper.push({ time: bars[i].time, value: mean + mult * sd });
    lower.push({ time: bars[i].time, value: mean - mult * sd });
  }
  return { mid, upper, lower };
}

export function macd(bars, fast = 12, slow = 26, signal = 9) {
  if (!bars?.length) return { macdLine: [], signalLine: [], hist: [] };
  const emaFast = ema(bars, fast);
  const emaSlow = ema(bars, slow);
  const slowMap = new Map(emaSlow.map((p) => [p.time, p.value]));
  const macdLine = [];
  for (const p of emaFast) {
    if (!slowMap.has(p.time)) continue;
    macdLine.push({ time: p.time, value: p.value - slowMap.get(p.time) });
  }
  if (macdLine.length < signal) return { macdLine, signalLine: [], hist: [] };
  const k = 2 / (signal + 1);
  const signalLine = [];
  let prev = macdLine[0].value;
  for (let i = 0; i < macdLine.length; i++) {
    const v = i === 0 ? macdLine[0].value : macdLine[i].value * k + prev * (1 - k);
    prev = v;
    if (i >= signal - 1) signalLine.push({ time: macdLine[i].time, value: v });
  }
  const sigMap = new Map(signalLine.map((p) => [p.time, p.value]));
  const hist = [];
  for (const p of macdLine) {
    if (!sigMap.has(p.time)) continue;
    hist.push({ time: p.time, value: p.value - sigMap.get(p.time) });
  }
  return { macdLine, signalLine, hist };
}

export function rsi(bars, period = 14) {
  if (bars.length < period + 1) return [];
  const out = [];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const push = (i) => {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const val = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    out.push({ time: bars[i].time, value: val });
  };
  push(period);
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    push(i);
  }
  return out;
}
