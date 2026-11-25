export function normalizeSymbol(raw) {
  if (!raw) return "BTCUSDT";
  let s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (s.endsWith("-USD")) s = s.replace("-USD", "USDT");
  if (s.endsWith("-USDT")) s = s.replace("-USDT", "USDT");
  if (/^[A-Z0-9]+USDT$/.test(s)) return s;
  if (/^[A-Z0-9]{2,15}$/.test(s) && !s.includes("USD")) {
    return s.endsWith("USDT") ? s : s + "USDT";
  }
  return s;
}

export function displaySymbol(sym) {
  if (!sym) return "";
  if (sym.endsWith("USDT")) return sym.replace(/USDT$/, "-USD");
  return sym;
}

export const INTERVALS = [
  { id: "1m", label: "1m", binance: "1m" },
  { id: "5m", label: "5m", binance: "5m" },
  { id: "15m", label: "15m", binance: "15m" },
  { id: "1h", label: "1H", binance: "1h" },
  { id: "4h", label: "4H", binance: "4h" },
  { id: "1d", label: "1D", binance: "1d" },
  { id: "1w", label: "1W", binance: "1w" },
];
