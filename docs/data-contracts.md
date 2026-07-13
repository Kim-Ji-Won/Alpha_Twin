# ALPHA TWIN Data Contracts

## 1. P3-B and P3-C-1 Scope

P3-B establishes the backend boundary for market data and completes one vertical slice: Company Twin quote and daily candles. It does not connect AI, ML/DL, OpenDART, news, accounts, orders, or a database.

P3-C-1 adds the Financial Services Commission public stock price API as the first real provider. It supports only `000660` and `005930`, and its values are confirmed daily prices rather than real-time quotes. The source updates once per business day, generally after 13:00 on the following business day.

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

Symbols must contain six digits and P3-C-1 enables only `000660` and `005930`. Candle ranges are `1m`, `3m`, `6m`, and `1y`.

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
2. If the provider fails and an expired cache entry within its maximum stale age exists, it is returned with `stale: true`.
3. In live mode, if no cache exists and `MARKET_DATA_ALLOW_MOCK_FALLBACK=true`, the backend Mock provider is used.
4. If the backend cannot provide a valid summary, mobile returns its existing local Mock quote and candles.
5. Mock analytics are never presented as live market analysis.

## 6. Stale and Partial Data

Backend stale responses set `metadata.stale=true`. Mobile labels them `최신 데이터가 아닐 수 있음`.

If a valid quote arrives without candles, mobile marks the result as partial and labels it `일부 시세만 최신`. A fallback response is labeled `Mock Data로 표시 중`.

Public data responses use `source=public-data-fsc`. Mobile labels a successful response `최근 확정 시세`, displays its `YYYY-MM-DD` trading date, and states `실시간 아님`. It never shows the public-data response as `LIVE`.

## 7. Environment Variables

Backend (`apps/api/.env`):

| Variable | Purpose | Secret |
| --- | --- | --- |
| `PORT` | Local API port | No |
| `HOST` | Listen address | No |
| `CORS_ORIGINS` | Allowed development web origins | No |
| `MARKET_DATA_PROVIDER` | `mock`, `public-data`, or `live-placeholder` | No |
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

## 8. Public Data Provider

Select the provider in an untracked `apps/api/.env`:

```text
MARKET_DATA_PROVIDER=public-data
MARKET_DATA_BASE_URL=https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService
MARKET_DATA_API_KEY=<data.go.kr decoding serviceKey>
```

Use the decoding service key shown by data.go.kr; `URLSearchParams` safely encodes it for transport. The service key remains server-only. The provider uses Node's built-in `fetch`, a five-second default timeout, and `/getStockPriceInfo` with `likeSrtnCd`, `beginBasDt`, and `endBasDt`. Missing credentials and upstream 429/5xx/timeout/invalid payloads become controlled provider errors and enter the existing stale/Mock fallback flow.

| Public field | Internal field |
| --- | --- |
| `srtnCd`, `itmsNm`, `mrktCtg` | `symbol`, `name`, `market` |
| `clpr`, `vs`, `fltRt` | `price`, `change`, `changePercent` |
| `trqu`, `trPrc` | `volume`, `tradingValue` |
| `basDt` | date-only `asOf` / candle `date` |
| `mkp`, `hipr`, `lopr`, `clpr`, `trqu` | candle OHLCV |

Public-data cache policy is six hours for quotes and 24 hours for candles. Expired values may be used for up to four days for quotes and seven days for candles. The default provider policy remains 45 seconds and 15 minutes respectively, with the same maximum stale ages.

The API returns confirmed daily rows. A `1m`, `3m`, `6m`, or `1y` request computes a calendar date window, requests at most 400 rows, filters the exact symbol, removes duplicate trading dates, and returns ascending dates. Trading holidays naturally produce fewer rows. Persistent storage and an exchange calendar remain later work.

## 9. Placeholder Live Provider

Implement `MarketDataProvider` in `apps/api/src/providers`, normalize all provider responses with the DTO normalizers, and select it from `server.ts`. Do not change mobile DTOs for provider-specific fields. Add mapping tests before enabling `MARKET_DATA_PROVIDER=live`.

The current `PlaceholderLiveMarketDataProvider` returns a controlled error until a provider and credentials are selected. With backend fallback enabled, endpoints still return Mock data.

## 10. Areas That Remain Mock

- Company health score, thesis health, risk, and AI confidence
- AI company summary and drivers
- Probability distribution and events
- Company relationship network and Management Track Record
- Scenario Lab and Thesis OS
- Portfolio X-Ray, Discover, notifications, and AI Analyst

## 11. P3-C-2 and Later

Before adding real-time coverage, contract with a provider licensed for KRX display and redistribution. P3-C-2 should also decide adjusted-price semantics, add an exchange calendar, persistent cache/observability without secret logging, and versioned DTO migration rules. OpenDART, news, AI/RAG, user data, and portfolio account integrations remain separate future work.

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
