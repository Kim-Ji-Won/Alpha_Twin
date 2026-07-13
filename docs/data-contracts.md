# ALPHA TWIN Data Contracts

## 1. P3-B Scope

P3-B establishes the backend boundary for market data and completes one vertical slice: Company Twin quote and daily candles. It does not connect AI, ML/DL, OpenDART, news, accounts, orders, or a database.

## 2. Mobile API Boundary

The mobile app calls only ALPHA TWIN API. It never calls a financial provider directly and never contains provider credentials.

```text
Company Twin
  -> useCompanyTwin
  -> stockService.getCompanyMarketData
  -> alphaTwinApi.getStockSummary
  -> ALPHA TWIN API
  -> local Mock fallback on timeout, invalid response, or server error
```

Set the public backend address in `apps/mobile/.env`:

```text
EXPO_PUBLIC_ALPHA_TWIN_API_BASE_URL=http://localhost:4000
```

For Android Emulator use `http://10.0.2.2:4000`. This variable is an address, not a secret.

## 3. Backend Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | API process health |
| GET | `/api/v1/stocks/:symbol/quote` | Normalized latest quote |
| GET | `/api/v1/stocks/:symbol/candles?range=1m` | Normalized daily candles and metadata |
| GET | `/api/v1/stocks/:symbol/summary?range=1m` | Quote and candles for Company Twin |

Symbols must contain six digits. Candle ranges are `1m`, `3m`, `6m`, and `1y`.

## 4. DTOs

`StockQuoteDto` contains `symbol`, `name`, `market`, optional `sector`, `currency`, numeric price/change/volume fields, `asOf`, `source`, `stale`, and `fallback`.

`StockCandleDto` contains `symbol`, `date`, numeric OHLCV fields, and `source`.

`StockSummaryDto` contains:

```ts
{
  quote: StockQuoteDto;
  candles: StockCandleDto[];
  metadata: {
    asOf: string;
    source: string;
    stale: boolean;
    fallback: boolean;
  };
}
```

External numeric strings are converted to numbers by the backend normalizers. Provider payloads are never passed directly to mobile.

## 5. Fallback Rules

1. A fresh cache entry is returned before calling the provider.
2. If the provider fails and an expired cache entry exists, it is returned with `stale: true`.
3. In live mode, if no cache exists and `MARKET_DATA_ALLOW_MOCK_FALLBACK=true`, the backend Mock provider is used.
4. If the backend cannot provide a valid summary, mobile returns its existing local Mock quote and candles.
5. Mock analytics are never presented as live market analysis.

## 6. Stale and Partial Data

Backend stale responses set `metadata.stale=true`. Mobile labels them `최신 데이터가 아닐 수 있음`.

If a valid quote arrives without candles, mobile marks the result as partial and labels it `일부 시세만 최신`. A fallback response is labeled `Mock Data로 표시 중`.

## 7. Environment Variables

Backend (`apps/api/.env`):

| Variable | Purpose | Secret |
| --- | --- | --- |
| `PORT` | Local API port | No |
| `HOST` | Listen address | No |
| `CORS_ORIGINS` | Allowed development web origins | No |
| `MARKET_DATA_PROVIDER` | `mock` or `live` | No |
| `MARKET_DATA_BASE_URL` | Provider endpoint | No |
| `MARKET_DATA_API_KEY` | Provider API key | Yes |
| `MARKET_DATA_APP_SECRET` | Provider app secret | Yes |
| `MARKET_DATA_ALLOW_MOCK_FALLBACK` | Permit backend Mock fallback | No |
| `MARKET_DATA_TIMEOUT_MS` | Provider/request timeout | No |
| `RATE_LIMIT_MAX` | Requests allowed per IP window | No |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window duration | No |

Mobile (`apps/mobile/.env`):

| Variable | Purpose | Secret |
| --- | --- | --- |
| `EXPO_PUBLIC_ALPHA_TWIN_API_BASE_URL` | ALPHA TWIN API address | No |

Real keys must exist only in untracked backend `.env` files. They must never use `EXPO_PUBLIC_`.

## 8. Replacing the Live Provider

Implement `MarketDataProvider` in `apps/api/src/providers`, normalize all provider responses with the DTO normalizers, and select it from `server.ts`. Do not change mobile DTOs for provider-specific fields. Add mapping tests before enabling `MARKET_DATA_PROVIDER=live`.

The current `PlaceholderLiveMarketDataProvider` returns a controlled error until a provider and credentials are selected. With backend fallback enabled, endpoints still return Mock data.

## 9. Areas That Remain Mock

- Company health score, thesis health, risk, and AI confidence
- AI company summary and drivers
- Probability distribution and events
- Company relationship network and Management Track Record
- Scenario Lab and Thesis OS
- Portfolio X-Ray, Discover, notifications, and AI Analyst

## 10. P3-C and Later

Before expanding live coverage, choose a licensed market data provider, implement its adapter, confirm redistribution terms, add persistent observability without logging secrets, and define versioned DTO migration rules. OpenDART, news, AI/RAG, user data, and portfolio account integrations remain separate future work.

## Development Commands

```bash
cd apps/api
npm install
npm run dev
```

```bash
cd apps/mobile
# create an untracked .env from .env.example and adjust the host when needed
npx expo start
```
