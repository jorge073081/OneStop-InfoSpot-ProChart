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
  if (!granularity) throw new Error("Unsupported interval");
  const product = toCoinbaseProduct(symbol);
  const url = COINBASE + "/products/" + product + "/candles?granularity=" + granularity;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Coinbase " + res.status);
  const raw = await res.json();
  if (!Array.isArray(raw) || !raw.length) throw new Error("Empty Coinbase response");
  return raw
    .slice(0, limit)
    .reverse()
    .map(function (k) {
      return {
        time: Number(k[0]),
        low: parseFloat(k[1]),
        high: parseFloat(k[2]),
        open: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      };
    });
}

async function fetchBinanceOHLCV(symbol, interval, limit) {
  const url = new URL(BINANCE_US);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(Math.min(1000, Math.max(50, limit || 500))));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Binance.US " + res.status);
  const raw = await res.json();
  return raw.map(function (k) {
    return {
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    };
  });
}

export async function fetchOHLCV(symbol, interval, limit) {
  try {
    const bars = await fetchCoinbaseOHLCV(symbol, interval || "1d", 300);
    return { bars: bars, source: "coinbase" };
  } catch (e) {
    const bars = await fetchBinanceOHLCV(symbol, interval || "1d", limit || 500);
    return { bars: bars, source: "binance" };
  }
}

export function sma(bars, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

export function ema(bars, period) {
  const out = [];
  if (!bars.length) return out;
  const k = 2 / (period + 1);
  let prev = bars[0].close;
  for (let i = 0; i < bars.length; i++) {
    const v = i === 0 ? bars[0].close : bars[i].close * k + prev * (1 - k);
    prev = v;
    if (i >= period - 1) out.push({ time: bars[i].time, value: v });
  }
  return out;
}

export function rsi(bars, period) {
  const out = [];
  if (bars.length < period + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out.push({
    time: bars[period].time,
    value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
  });
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({
      time: bars[i].time,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
    });
  }
  return out;
}

export function bollinger(bars, period, mult) {
  period = period || 20;
  mult = mult || 2;
  const mid = [];
  const upper = [];
  const lower = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    const mean = sum / period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = bars[j].close - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / period);
    mid.push({ time: bars[i].time, value: mean });
    upper.push({ time: bars[i].time, value: mean + mult * std });
    lower.push({ time: bars[i].time, value: mean - mult * std });
  }
  return { mid: mid, upper: upper, lower: lower };
}

export function macd(bars, fast, slow, signal) {
  fast = fast || 12;
  slow = slow || 26;
  signal = signal || 9;
  const ef = ema(bars, fast);
  const es = ema(bars, slow);
  const byTime = {};
  for (let i = 0; i < ef.length; i++) byTime[ef[i].time] = { f: ef[i].value };
  for (let i = 0; i < es.length; i++) {
    if (byTime[es[i].time]) byTime[es[i].time].s = es[i].value;
  }
  const macdLine = [];
  const times = Object.keys(byTime)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (byTime[t].f != null && byTime[t].s != null) {
      macdLine.push({ time: t, value: byTime[t].f - byTime[t].s });
    }
  }
  const sig = ema(
    macdLine.map(function (p) {
      return { time: p.time, close: p.value };
    }),
    signal
  );
  const hist = [];
  const sigMap = {};
  for (let i = 0; i < sig.length; i++) sigMap[sig[i].time] = sig[i].value;
  for (let i = 0; i < macdLine.length; i++) {
    const t = macdLine[i].time;
    if (sigMap[t] != null) {
      hist.push({
        time: t,
        value: macdLine[i].value - sigMap[t],
        color: macdLine[i].value - sigMap[t] >= 0 ? "#26a69a" : "#ef5350",
      });
    }
  }
  return { macdLine: macdLine, signal: sig, hist: hist };
}
