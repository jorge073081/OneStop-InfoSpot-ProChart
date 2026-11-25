# Chart Desk (v0.1)

Free, independent chart app — **no TradingView dependency**, **no paid APIs**.

| Layer | Choice | Cost |
|--------|--------|------|
| UI | React + Vite | Free / open source |
| Chart | [Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0) | Free |
| Data | Binance public klines REST | Free, no API key |
| Hosting | GitHub + (optional) Cloudflare Pages / Netlify / Vercel free tier | Free |

> OneStop stays separate. Link here with  
> `https://YOUR_CHART_DESK_URL/?symbol=XRP-USD&interval=1d`

## Features (v0.1)

- Candlesticks + volume  
- Intervals: 1m · 5m · 15m · 1H · 4H · 1D · 1W  
- SMA 50 / 200 · RSI pane  
- URL params: `?symbol=BTC-USD&interval=1d`  
- Dark UI, price scale on the right  

**Crypto-first.** Symbols resolve to Binance `*USDT` pairs (e.g. `BTC-USD` → `BTCUSDT`). Stocks need a different free data path later.

## Step-by-step (GitHub)

### 1. Create repo
1. GitHub → **New repository** → name `chart-desk` (public is fine)  
2. Do **not** add a README if you will push this folder as the root  

### 2. Push this project
```bash
cd chart-desk
git init
git add .
git commit -m "Chart Desk v0.1 — free React + Lightweight Charts"
git branch -M main
git remote add origin https://github.com/YOUR_USER/chart-desk.git
git push -u origin main
```

### 3. Run locally
```bash
npm install
npm run dev
```
Open the URL Vite prints (usually `http://localhost:5173`).

### 4. Deploy free (pick one)

**Cloudflare Pages:** New project → connect repo → build `npm run build` → output `dist`  

**Netlify:** same — build `npm run build`, publish `dist`  

**Vercel:** Import repo → framework Vite → deploy  

### 5. Link from OneStop (later)
In OneStop Chart tab, add a link:
```text
https://YOUR_DEPLOY_URL/?symbol={TICKER}&interval=1d
```

## Scripts
| Command | What |
|---------|------|
| `npm install` | Install deps |
| `npm run dev` | Local dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |

## Roadmap (still free)
- [ ] More symbol aliases / search  
- [ ] Drawing tools (custom, not TV)  
- [ ] Optional tiny free backend if you need stocks/Yahoo  
- [ ] OneStop deep-link button  

## License notes
- Your app code: your choice  
- Lightweight Charts: Apache-2.0 (keep license notice)  
- Binance: public market data; respect their rate limits / terms  
