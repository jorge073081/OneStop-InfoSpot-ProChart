/**
 * Free OHLCV via Binance public REST (no API key).
 * Docs: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
 *
 * Limits: public rate limits apply; fine for personal use.
 * Stocks are NOT on Binance — this v1 is crypto-first and free.
 */

const BINANCE = "https://api.binance.com/api/v3/klines";

export async function fetchOHLCV(symbol, interval = "1d", limit = 500) {
  const url = new URL(BINANCE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(Math.min(1000, Math.max(50, limit))));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Binance ${res.status}: ${text || res.statusText}. Check symbol (e.g. BTCUSDT, XRPUSDT).`
    );
  }
  const raw = await res.json();
  // [ openTime, open, high, low, close, volume, closeTime, ... ]
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000), // seconds for Lightweight Charts
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/** Simple SMA on close */
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

/** RSI (Wilder) on close */
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
