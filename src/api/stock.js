/**
 * Free stock OHLCV proxy for Chart Desk (Vercel serverless).
 * Runs server-side so Stooq/Yahoo are not blocked by browser CORS.
 * No API keys.
 */

const STOOQ_INTERVAL = {
  "1m": null,
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "60",
  "1d": "d",
  "1w": "w",
};

function toStooqSymbol(symbol) {
  let s = String(symbol || "")
    .toLowerCase()
    .trim()
    .replace(/\./g, "-");
  if (!s.includes(".")) s = s + ".us";
  return s;
}

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
    if (dateStr.includes(" ")) {
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
  const out = [];
  for (const b of bars) {
    if (!out.length || out[out.length - 1].time !== b.time) out.push(b);
    else out[out.length - 1] = b;
  }
  return out;
}

function aggregateBars(bars, bucketSec) {
  if (!bars.length) return bars;
  const out = [];
  let cur = null;
  for (const b of bars) {
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

async function fetchStooq(symbol, interval) {
  if (interval === "1m") {
    throw new Error("1m not available on free Stooq");
  }
  const code = STOOQ_INTERVAL[interval] || "d";
  const s = toStooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=${code}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ChartDesk/1.0)",
      Accept: "text/csv,text/plain,*/*",
    },
  });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes(",")) throw new Error("Stooq non-CSV response");
  let bars = parseStooqCsv(text);
  if (interval === "4h") bars = aggregateBars(bars, 4 * 3600);
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

function parseYahoo(data) {
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No Yahoo result");
  const quote = result.indicators?.quote?.[0] || {};
  const ts = result.timestamp || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (![o, h, l, c].every((x) => x != null && Number.isFinite(x))) continue;
    bars.push({
      time: ts[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: quote.volume?.[i] ?? 0,
    });
  }
  if (!bars.length) throw new Error("Empty Yahoo bars");
  return bars;
}

async function fetchYahoo(symbol, interval) {
  const map = YAHOO_MAP[interval] || YAHOO_MAP["1d"];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${map.interval}&range=${map.range}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ChartDesk/1.0)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  let bars = parseYahoo(await res.json());
  if (interval === "4h") bars = aggregateBars(bars, 4 * 3600);
  return bars;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const interval = String(req.query.interval || "1d");

  if (!symbol) {
    res.status(400).json({ error: "Missing symbol" });
    return;
  }

  const errors = [];
  try {
    const bars = await fetchStooq(symbol, interval);
    res.status(200).json({ bars, source: "stooq" });
    return;
  } catch (e) {
    errors.push("Stooq: " + (e.message || e));
  }

  try {
    const bars = await fetchYahoo(symbol, interval);
    res.status(200).json({ bars, source: "yahoo" });
    return;
  } catch (e) {
    errors.push("Yahoo: " + (e.message || e));
  }

  res.status(502).json({
    error: `Stock fetch failed for ${symbol} @ ${interval}`,
    details: errors,
  });
}
