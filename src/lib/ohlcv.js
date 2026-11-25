/**
 * Free OHLCV:
 *  - Crypto: Coinbase (primary) + Binance.US (fallback)
 *  - Stocks: Yahoo Finance chart API (no API key)
 * No paid keys required.
 */

import { assetKind } from "./symbols.js";

const COINBASE = "https://api.exchange.coinbase.com";
const BINANCE_US = "https://api.binance.us/api/v3/klines";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";

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
      "Binance.US " + res.status + ": " + (text || res.statusText) + ". Check symbol (e.g. BTCUSDT, XRPUSDT)."
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

const YAHOO_INTERVAL = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "60m", range: "3mo" },
  "4h": { interval: "60m", range: "6mo" },
  "1d": { interval: "1d", range: "2y" },
  "1w": { interval: "1wk", range: "10y" },
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/**
 * Yahoo chart API - free, no key.
 * Browser may hit CORS; we try direct then a free CORS relay.
 */
async function fetchYahooOHLCV(symbol, interval = "1d") {
  const map = YAHOO_INTERVAL[interval] || YAHOO_INTERVAL["1d"];
  const path =
    YAHOO +
    encodeURIComponent(symbol) +
    "?interval=" +
    map.interval +
    "&range=" +
    map.range +
    "&includePrePost=false";

  let data;
  try {
    data = await fetchJson(path);
  } catch (e1) {
    // Free CORS fallback (no API key). May rate-limit under heavy use.
    const proxied =
      "https://corsproxy.io/?" + encodeURIComponent(path);
    try {
      data = await fetchJson(proxied);
    } catch (e2) {
      throw new Error(
        "Yahoo stock fetch failed (CORS/network). Try again or use a crypto pair. " +
          (e2.message || "")
      );
    }
  }

  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error("No Yahoo data for " + symbol);
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
  if (!bars.length) throw new Error("Empty Yahoo bars for " + symbol);
  return bars;
}

export async function fetchOHLCV(symbol, interval = "1d", limit = 500) {
  if (assetKind(symbol) === "stock") {
    const bars = await fetchYahooOHLCV(symbol, interval);
    return { bars, source: "yahoo" };
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
