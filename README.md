# Bitunix Futures Analytics

A **frontend-only** (no database, no application backend) analytics terminal for
**Bitunix USD-M futures**. It connects to your Bitunix account for statistics and
provides deep per-coin analysis — candles & indicators, order-book liquidity,
liquidation maps, open interest, long/short ratios, order flow and more.

It ships as a **single Docker container**: an nginx server that hosts the static
React app and acts as a thin reverse-proxy so the browser can reach the exchange
REST APIs without CORS issues. There is **no database** and no business logic on
the server.

```
Browser (React SPA)
  ├── REST  /bitunix/*  ─► nginx ─► https://fapi.bitunix.com   (account, history, candles, funding)
  ├── REST  /binance/*  ─► nginx ─► https://fapi.binance.com   (deep depth, OI, long/short, taker, klines)
  ├── WS    wss://fapi.bitunix.com   (live tickers & candles, CORS-exempt)
  └── WS    wss://fstream.binance.com (live trades, liquidations, CORS-exempt)
```

## Features

### Statistics (your Bitunix account)
- Equity / available / used margin / unrealized PnL cards
- Open positions table with live mark price, liquidation distance, uPnL
- Closed-position analytics over 7/30/90/180 days:
  - Equity curve with drawdown shading
  - Win rate, profit factor, expectancy, best/worst trade, streaks, max drawdown
  - PnL by symbol, long vs short, weekday × hour heatmap, holding-time distribution
  - Fees paid, funding, traded volume

### Coin analysis (everything in one place)
- **Chart** — multi-timeframe candles + volume (live), with EMA / Bollinger /
  VWAP overlays and RSI / MACD / Stochastic-RSI sub-panels
- **Liquidity** — Binance deep order book (top 1000 levels):
  - Liquidity-by-price-level histogram (resting liquidity at each price)
  - Cumulative depth curve
  - Order-book imbalance / pressure meter with a directional read
  - Resting-liquidity heatmap (price × time, accumulated live)
- **Derivatives** — Binance public data:
  - Live liquidation map (price × time, sized by notional) + tape + long/short balance
  - Open interest vs price
  - Long/short ratio (all accounts + top traders) vs price
  - Taker buy/sell flow vs price
- **Order Flow** — Cumulative Volume Delta (CVD), aggressor buy/sell balance,
  live trade tape, and Volume Profile (VPVR) with POC / value area
- **Screener** — market map (24h change vs volume), top gainers/losers/most active;
  click to analyze any coin
- Funding-rate widget with live countdown

## Run with Docker

```bash
docker compose up -d --build
# open http://localhost:8080
```

Or with plain Docker:

```bash
docker build -t bitunix-analytics .
docker run -d -p 8080:80 --name bitunix-analytics bitunix-analytics
```

## Local development

```bash
npm install
npm run dev   # http://localhost:5173 (Vite proxies /bitunix and /binance)
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint`.

## Connect your account

1. In Bitunix, create a **futures API key** (read-only / no-withdrawal is
   recommended).
2. Open the app → **Settings**, paste the API key + secret, click **Test & Save**.

Credentials are stored only in your browser's `localStorage` and requests are
signed locally in the browser using Bitunix's double SHA-256 scheme (Web Crypto).
They are never sent anywhere except, signed, to Bitunix through the proxy.

## Notes & limitations

- **Binance public data** powers the liquidity, liquidation, OI, long/short and
  order-flow views. Binance restricts API access from some locations; if those
  panels show a "restricted location" notice, run the app from a non-restricted
  network/VPN. Bitunix account/price features are unaffected.
- Binance does **not** expose historical liquidations via public REST — the
  liquidation map accumulates **live** from the moment you open a symbol.
  Open-interest / long-short / taker data covers roughly the last 30 days.
- Bitunix and Binance USD-M perpetual symbols generally match (e.g. `BTCUSDT`).
  If a coin isn't on Binance, its derivatives/liquidity panels show "no data"
  while Bitunix price/candles/funding keep working.

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS · Zustand · TanStack Query ·
lightweight-charts · Apache ECharts · nginx.
