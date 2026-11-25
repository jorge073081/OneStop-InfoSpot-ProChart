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


export function stoch(bars, kPeriod = 14, dPeriod = 3) {
  if (!bars?.length || bars.length < kPeriod) return { k: [], d: [] };
  const k = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < kPeriod - 1) continue;
    const slice = bars.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...slice.map((b) => b.high));
    const ll = Math.min(...slice.map((b) => b.low));
    const den = hh - ll;
    const val = den === 0 ? 50 : ((bars[i].close - ll) / den) * 100;
    k.push({ time: bars[i].time, value: val });
  }
  // %D = SMA of %K
  const d = [];
  let sum = 0;
  for (let i = 0; i < k.length; i++) {
    sum += k[i].value;
    if (i >= dPeriod) sum -= k[i - dPeriod].value;
    if (i >= dPeriod - 1) {
      d.push({ time: k[i].time, value: sum / dPeriod });
    }
  }
  return { k, d };
}

export function atr(bars, period = 14) {
  if (!bars?.length || bars.length < 2) return [];
  const trs = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trs.push(bars[i].high - bars[i].low);
      continue;
    }
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trs.push(tr);
  }
  const out = [];
  let sum = 0;
  for (let i = 0; i < trs.length; i++) {
    sum += trs[i];
    if (i >= period) sum -= trs[i - period];
    if (i >= period - 1) {
      out.push({ time: bars[i].time, value: sum / period });
    }
  }
  return out;
}

/** Cumulative VWAP from start of loaded bars (approx session VWAP on lower TFs). */
export function vwap(bars) {
  if (!bars?.length) return [];
  const out = [];
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const typ = (bars[i].high + bars[i].low + bars[i].close) / 3;
    const vol = bars[i].volume || 0;
    cumPV += typ * vol;
    cumV += vol;
    if (cumV > 0) out.push({ time: bars[i].time, value: cumPV / cumV });
  }
  return out;
}
