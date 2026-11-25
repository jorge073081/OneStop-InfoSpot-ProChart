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

async function fetchText(url) {
  const res = await fetch(url, { headers: { Accept: "*/*" } });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url.slice(0, 60));
  return res.text();
}

async function fetchJsonAny(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/** Try URL list until one returns usable text/json */
async function firstOk(urls, asJson) {
  var lastErr = null;
  for (var i = 0; i < urls.length; i++) {
    try {
      if (asJson) return await fetchJsonAny(urls[i]);
      return await fetchText(urls[i]);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All fetch attempts failed");
}

function parseYahooChart(data) {
  var result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error("No Yahoo chart.result");
  var quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  var ts = result.timestamp || [];
  var opens = quote.open || [];
  var highs = quote.high || [];
  var lows = quote.low || [];
  var closes = quote.close || [];
  var vols = quote.volume || [];
  var bars = [];
  for (var i = 0; i < ts.length; i++) {
    var o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (![o, h, l, c].every(function (x) { return Number.isFinite(x); })) continue;
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

function yahooChartUrls(symbol, interval) {
  var map = YAHOO_INTERVAL[interval] || YAHOO_INTERVAL["1d"];
  var direct =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    "?interval=" + map.interval +
    "&range=" + map.range +
    "&includePrePost=false&events=div%7Csplit";
  var direct2 = direct.replace("query1.", "query2.");
  return [
    direct,
    direct2,
    // Free CORS relays (no API key)
    "https://corsproxy.io/?" + encodeURIComponent(direct),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(direct),
    "https://corsproxy.io/?" + encodeURIComponent(direct2),
  ];
}

async function fetchYahooOHLCV(symbol, interval) {
  var urls = yahooChartUrls(symbol, interval);
  var lastErr = null;
  for (var i = 0; i < urls.length; i++) {
    try {
      var data = await fetchJsonAny(urls[i]);
      // allorigins sometimes wraps - handle if needed
      if (data && data.contents && typeof data.contents === "string") {
        data = JSON.parse(data.contents);
      }
      return parseYahooChart(data);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Yahoo failed for " + symbol);
}

/** Stooq daily CSV fallback - good for 1d stocks, free */
function toStooqSymbol(symbol) {
  var s = String(symbol).toLowerCase().replace(/\./g, "-");
  // US default
  if (s.indexOf(".") === -1) s = s + ".us";
  return s;
}

function parseStooqCsv(text) {
  var lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("Empty Stooq CSV");
  var bars = [];
  // Date,Open,High,Low,Close,Volume  (newest or oldest first - handle both)
  for (var i = 1; i < lines.length; i++) {
    var p = lines[i].split(",");
    if (p.length < 5) continue;
    var dateStr = p[0].trim();
    var o = parseFloat(p[1]);
    var h = parseFloat(p[2]);
    var l = parseFloat(p[3]);
    var c = parseFloat(p[4]);
    var v = p[5] != null ? parseFloat(p[5]) : 0;
    if (![o, h, l, c].every(function (x) { return Number.isFinite(x); })) continue;
    // date YYYY-MM-DD -> unix sec UTC noon
    var parts = dateStr.split("-");
    if (parts.length !== 3) continue;
    var t = Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12, 0, 0) / 1000;
    bars.push({ time: t, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
  }
  if (!bars.length) throw new Error("No Stooq bars parsed");
  bars.sort(function (a, b) { return a.time - b.time; });
  return bars;
}

async function fetchStooqDaily(symbol) {
  var s = toStooqSymbol(symbol);
  var direct = "https://stooq.com/q/d/l/?s=" + encodeURIComponent(s) + "&i=d";
  var urls = [
    direct,
    "https://corsproxy.io/?" + encodeURIComponent(direct),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(direct),
  ];
  var text = await firstOk(urls, false);
  // allorigins might return HTML error pages
  if (text.indexOf("Date") === -1 && text.indexOf("date") === -1) {
    throw new Error("Stooq response not CSV");
  }
  return parseStooqCsv(text);
}


export async function fetchOHLCV(symbol, interval = "1d", limit = 500) {
  if (assetKind(symbol) === "stock") {
    var errors = [];
    try {
      var yBars = await fetchYahooOHLCV(symbol, interval);
      return { bars: yBars, source: "yahoo" };
    } catch (e) {
      errors.push("Yahoo: " + (e && e.message ? e.message : e));
    }
    // Daily (and weekly as daily) Stooq fallback
    if (interval === "1d" || interval === "1w" || interval === "4h" || interval === "1h") {
      try {
        var sBars = await fetchStooqDaily(symbol);
        if (interval === "1w" && sBars.length > 5) {
          // crude weekly: take every 5th daily bar endpoints - better: aggregate
          sBars = aggregateWeekly(sBars);
        }
        return { bars: sBars, source: "stooq" };
      } catch (e2) {
        errors.push("Stooq: " + (e2 && e2.message ? e2.message : e2));
      }
    }
    throw new Error(
      "Stock fetch failed for " + symbol + ". " + errors.join(" | ")
    );
  }
  try {
    const bars = await fetchCoinbaseOHLCV(symbol, interval, 300);
    return { bars, source: "coinbase" };
  } catch {
    const bars = await fetchBinanceOHLCV(symbol, interval, limit);
    return { bars, source: "binance" };
  }
}

function aggregateWeekly(dailyBars) {
  if (!dailyBars.length) return dailyBars;
  var out = [];
  var cur = null;
  for (var i = 0; i < dailyBars.length; i++) {
    var b = dailyBars[i];
    var d = new Date(b.time * 1000);
    // ISO week start Monday
    var day = d.getUTCDay();
    var weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7), 12, 0, 0));
    var wt = weekStart.getTime() / 1000;
    if (!cur || cur.time !== wt) {
      if (cur) out.push(cur);
      cur = { time: wt, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
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
