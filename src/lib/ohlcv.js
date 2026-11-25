/**
 * Free OHLCV via Coinbase Exchange public API (primary) + Binance.US public API (fallback).
 * No API keys required.
 */

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
  if (s.endsWith("USDT")) return `${s.slice(0, -4)}-USD`;
  if (s.endsWith("USD")) return `${s.slice(0, -3)}-USD`;
  return `${s}-USD`;
}

async function fetchCoinbaseOHLCV(symbol, interval, limit = 300) {
  if (interval === "4h" || interval === "1w") {
    throw new Error("Use Binance.US for 4h/1w");
  }
  const granularity = CB_GRANULARITY[interval];
  if (!granularity) throw new Error("Unsupported Coinbase interval");

  const product = toCoinbaseProduct(symbol);
  const url = `${COINBASE}/products/${product}/candles?granularity=${granularity}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Coinbase ${res.status}`);

  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Empty Coinbase response");
  }

  // Coinbase returns newest-first: [ time, low, high, open, close, volume ]
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
      `Binance.US ${res.status}: ${text || res.statusText}. Check symbol (e.g. BTCUSDT, XRPUSDT).`
    );
  }
  const raw = await res.json();
  // Binance returns: [ openTime, open, high, low, close, volume, closeTime, ... ]
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function fetchOHLCV(symbol, interval = "1d", limit = 500) {
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
