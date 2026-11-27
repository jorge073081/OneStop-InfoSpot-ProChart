export const config = { runtime: "edge" };

function toFuturesSymbol(symbol) {
  let s = String(symbol || "BTCUSDT").toUpperCase().replace(/\s+/g, "");
  if (s.endsWith("-USD")) s = s.replace("-USD", "USDT");
  if (s.endsWith("-USDT")) s = s.replace("-USDT", "USDT");
  if (!s.endsWith("USDT")) s = s + "USDT";
  return s;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
    },
  });
}

async function fromBinance(sym) {
  const res = await fetch(
    "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=" + encodeURIComponent(sym),
    { headers: { Accept: "application/json" } }
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
    nextFundingTime: data.nextFundingTime ? Number(data.nextFundingTime) : null,
    source: "Binance Futures",
  };
}

async function fromBybit(sym) {
  const res = await fetch(
    "https://api.bybit.com/v5/market/tickers?category=linear&symbol=" +
      encodeURIComponent(sym),
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error("Bybit " + res.status);
  const data = await res.json();
  const row = data?.result?.list?.[0];
  if (!row) throw new Error("Bybit empty");
  const rate = parseFloat(row.fundingRate);
  if (!Number.isFinite(rate)) throw new Error("Bybit no rate");
  return {
    symbol: sym,
    rate,
    ratePct: rate * 100,
    mark: parseFloat(row.markPrice) || null,
    nextFundingTime: row.nextFundingTime ? Number(row.nextFundingTime) : null,
    source: "Bybit",
  };
}

async function fromOkx(sym) {
  // BTCUSDT -> BTC-USDT-SWAP
  const base = sym.replace(/USDT$/, "");
  const instId = base + "-USDT-SWAP";
  const res = await fetch(
    "https://www.okx.com/api/v5/public/funding-rate?instId=" + encodeURIComponent(instId),
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error("OKX " + res.status);
  const data = await res.json();
  const row = data?.data?.[0];
  if (!row) throw new Error("OKX empty");
  const rate = parseFloat(row.fundingRate);
  if (!Number.isFinite(rate)) throw new Error("OKX no rate");
  return {
    symbol: sym,
    rate,
    ratePct: rate * 100,
    mark: null,
    nextFundingTime: row.fundingTime ? Number(row.fundingTime) : null,
    source: "OKX",
  };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  const url = new URL(request.url);
  const symbol = toFuturesSymbol(url.searchParams.get("symbol") || "BTCUSDT");
  const errors = [];

  for (const fn of [fromBinance, fromBybit, fromOkx]) {
    try {
      const data = await fn(symbol);
      return json(data);
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }

  return json(
    { error: "Funding fetch failed for " + symbol, details: errors },
    502
  );
}
