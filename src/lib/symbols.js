/**
 * Symbol helpers - crypto (Coinbase/Binance) + stocks (Yahoo).
 * No paid APIs.
 */

const CRYPTO_BASES = new Set([
  "BTC", "ETH", "XRP", "SOL", "ADA", "DOGE", "DOT", "AVAX", "LINK", "MATIC",
  "UNI", "LTC", "BCH", "ATOM", "NEAR", "APT", "ARB", "OP", "SUI", "PEPE",
  "WIF", "SHIB", "FIL", "ICP", "HBAR", "VET", "AAVE", "MKR", "CRV", "INJ",
  "TIA", "SEI", "RNDR", "RENDER", "XLM", "ALGO", "EOS", "XTZ",
  "GRT", "SAND", "MANA", "AXS", "FTM", "BNB", "TRX", "TON", "BONK",
]);

/** @returns {"crypto"|"stock"} */
export function assetKind(raw) {
  if (!raw) return "crypto";
  var s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (s.indexOf("USDT") !== -1) return "crypto";
  if (s.indexOf("-USD") !== -1) {
    var base = s.split("-")[0];
    return CRYPTO_BASES.has(base) ? "crypto" : "stock";
  }
  if (CRYPTO_BASES.has(s)) return "crypto";
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return "stock";
  if (/^[A-Z0-9]{2,15}$/.test(s)) return "crypto";
  return "crypto";
}

export function normalizeSymbol(raw) {
  if (!raw) return "BTCUSDT";
  var s = String(raw).trim().toUpperCase().replace(/\s+/g, "");

  if (assetKind(s) === "stock") {
    return s.replace("-", ".");
  }

  if (s.slice(-4) === "-USD") s = s.slice(0, -4) + "USDT";
  if (s.slice(-5) === "-USDT") s = s.slice(0, -5) + "USDT";
  if (/^[A-Z0-9]+USDT$/.test(s)) return s;
  if (/^[A-Z0-9]{2,15}$/.test(s) && s.indexOf("USD") === -1) {
    return s.slice(-4) === "USDT" ? s : s + "USDT";
  }
  return s;
}

export function displaySymbol(symbol) {
  if (!symbol) return "";
  if (assetKind(symbol) === "stock") return symbol;
  if (symbol.slice(-4) === "USDT") return symbol.slice(0, -4) + "-USD";
  return symbol;
}

export const INTERVALS = [
  { id: "1m", label: "1m", binance: "1m", yahoo: "1m", yahooRange: "7d" },
  { id: "5m", label: "5m", binance: "5m", yahoo: "5m", yahooRange: "1mo" },
  { id: "15m", label: "15m", binance: "15m", yahoo: "15m", yahooRange: "1mo" },
  { id: "1h", label: "1H", binance: "1h", yahoo: "60m", yahooRange: "3mo" },
  { id: "4h", label: "4H", binance: "4h", yahoo: "60m", yahooRange: "6mo" },
  { id: "1d", label: "1D", binance: "1d", yahoo: "1d", yahooRange: "2y" },
  { id: "1w", label: "1W", binance: "1w", yahoo: "1wk", yahooRange: "10y" },
];
