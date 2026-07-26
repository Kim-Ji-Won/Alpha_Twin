# ALPHA TWIN Data Contracts

## 1. P3-B through P3-C-3B Scope

P3-B establishes the backend boundary for market data and completes one vertical slice: Company Twin quote and daily candles. It does not connect AI, ML/DL, OpenDART, news, accounts, orders, or a database.

P3-C-1 adds the Financial Services Commission public stock price API as the first real provider. P3-C-2 removes the two-symbol allowlist, adds bounded pagination, KST date-only handling, cache isolation, request coalescing, and safe operational status. Values remain confirmed daily prices rather than real-time quotes. The source generally updates on the following business day.

P3-C-3B adds a separate OpenDART domain for six-digit symbol resolution, company profiles, and disclosure lists. It does not add financial statements, mobile OpenDART screens, analysis scores, or an operational Mock fallback.

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
| GET | `/api/v1/companies/:symbol/profile` | Normalized OpenDART company profile |
| GET | `/api/v1/companies/:symbol/disclosures` | One normalized OpenDART disclosure page |

Symbols are trimmed and must then contain exactly six digits. Malformed symbols return HTTP 400 before a provider call, symbols with no public rows return HTTP 404, and unavailable providers without usable stale or Mock data return HTTP 503. Candle ranges remain `1m`, `3m`, `6m`, and `1y`.

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
    dataMode?: 'eod' | 'realtime' | 'mock';
    priceAdjustment?: 'raw' | 'adjusted' | 'unknown';
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

`dataMode` and `priceAdjustment` are optional additive fields. Public data uses `dataMode=eod`; Mock data uses `dataMode=mock`. EOD is a normal data characteristic and does not imply `stale=true`. `stale` is reserved for expired cache reuse after a provider failure, while `fallback` means another provider supplied the response.

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
| `MARKET_DATA_CACHE_MAX_ENTRIES` | In-memory cache entry limit | No |
| `OPENDART_API_KEY` | OpenDART server credential | Yes |
| `OPENDART_BASE_URL` | OpenDART origin override for testing | No |
| `OPENDART_TIMEOUT_MS` | OpenDART JSON timeout | No |
| `OPENDART_ARCHIVE_TIMEOUT_MS` | Corp-code archive timeout | No |
| `OPENDART_INDEX_CACHE_DIR` | Ignored local snapshot directory | No |
| `RATE_LIMIT_MAX` | Requests allowed per IP window | No |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window duration | No |
| `LOG_LEVEL` | `silent`, `error`, `warn`, or `info` | No |

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

Use the decoding service key shown by data.go.kr; `URLSearchParams` safely encodes it for transport. The service key remains server-only. The provider uses Node's built-in `fetch`, a five-second default timeout per page, and `/getStockPriceInfo` with `likeSrtnCd`, `beginBasDt`, and `endBasDt`. Missing credentials and upstream 429/5xx/timeout/invalid payloads become controlled provider errors and enter the existing stale/Mock fallback flow. Full URLs, query strings, provider response bodies, and credentials are never logged.

| Public field | Internal field |
| --- | --- |
| `srtnCd`, `itmsNm`, `mrktCtg` | `symbol`, `name`, `market` |
| `clpr`, `vs`, `fltRt` | `price`, `change`, `changePercent` |
| `trqu`, `trPrc` | `volume`, `tradingValue` |
| `basDt` | date-only `asOf` / candle `date` |
| `mkp`, `hipr`, `lopr`, `clpr`, `trqu` | candle OHLCV |

Public-data cache policy is six hours for quotes and 24 hours for candles. Expired values may be used for up to four days for quotes and seven days for candles. Keys include provider, operation, symbol, and candle range. Cache entries store `createdAt`, `freshUntil`, and `staleUntil`; expired entries are removed and the default in-memory store is bounded to 500 entries. Concurrent misses for the same key share one in-flight Promise.

The API returns confirmed daily rows. A request computes a KST date-only window, follows `pageNo`, `numOfRows`, and `totalCount`, then filters the exact symbol, removes duplicate trading dates, and returns ascending dates. Pagination is limited to 20 pages and 2,000 rows. Repeated pages, non-advancing metadata, empty intermediate pages, inconsistent totals, and partial-page failures reject the entire provider operation.

Weekends and exchange holidays naturally produce fewer rows. The latest returned `basDt` is trusted and displayed; a date differing from today is not marked stale. A bounded 14-day candle lookup expansion and 180-day quote lookup expansion cover long closures or suspended trading without unbounded history scans. A full KRX holiday calendar is not included.

The provider does not calculate adjusted prices. Because the public response contract does not establish complete split, consolidation, and ex-dividend adjustment semantics for this app, `priceAdjustment=unknown`. These candles must not be treated as adjusted data for long-horizon returns or ML inputs without a separately licensed adjusted-price/corporate-action source.

`CacheStore` and bounded `MemoryCacheStore` form the persistence boundary. A file store is not implemented in P3-C-2: local files are not distributed-process safe, and Redis/DB storage remains an operational deployment decision.

Safe provider events include status category, provider, symbol, range, duration, page count, cache state, and fallback state. `/health` exposes only provider id, data mode, cache kind, entry count, aggregate event counts, and the last safe event. It never exposes credential state, local paths, provider URLs, query strings, or response bodies.

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

## 11. P3-C-3 and Later

### OpenDART contracts

`CompanyProfileDto` exposes symbol, corp code, names, chief executive, market, industry code, establishment date, fiscal year-end month, safe website URLs, and the corp-index company information modification date. It excludes corporate and business registration numbers, full address, phone, and fax.

`DisclosurePageDto` contains normalized items, validated pagination, the effective query, and OpenDART metadata. Receipt numbers are validated before viewer URLs are built. Correction prefixes remain distinct from `rm` flags: `정` means a later correction exists, `철` means withdrawn, and `연` means consolidated content. Status `013` returns an empty disclosure page but maps to profile-not-found for company profiles.

OpenDART metadata uses `source=opendart-fss`, `retrievedAt`, `stale`, ordered `staleReasons`, `fallback=false`, and an optional request ID. Corp index stale state, profile cache stale state, and disclosure cache stale state remain distinguishable. No other company's Mock data is substituted.

The corp-code archive is limited to 20 MiB compressed, 8 entries, 64 MiB for the single XML entry, and 200,000 listed records. DOCTYPE and ENTITY declarations are rejected. Listed records are sorted by stock code and stored as a schema-versioned, SHA-256 checked JSON snapshot using a temporary file plus atomic rename. The default runtime directory is Git-ignored. Fresh/stale windows are 24 hours/30 days for the index, 7/30 days for profiles, and 30 minutes/1 day for disclosures.

Disclosure queries default to 90 KST calendar days, `finalOnly=false`, page 1, and page size 20. Dates must be real `YYYY-MM-DD` values, the inclusive range cannot exceed 366 days, and page size cannot exceed 100. Only the requested page is fetched.

OpenDART authentication, rate-limit, maintenance, malformed response, timeout, and provider request-mapping failures use stable ALPHA TWIN error codes. External messages, full URLs, query strings, and credentials are not returned or logged. The server can start without the key; only OpenDART routes return `OPENDART_NOT_CONFIGURED`.

P3-C-3C will add financial statements and account normalization. P3-C-3D will connect the normalized company and disclosure data to mobile. DB, Redis, distributed locking, Prometheus, financial analysis scores, and actual AI remain outside P3-C-3B.

Before adding real-time coverage, contract with a provider licensed for KRX display and redistribution. Remaining work also includes a licensed adjusted-price policy, official exchange calendar, production distributed cache/metrics, and versioned DTO migration rules. News, AI/RAG, user data, and portfolio account integrations remain separate future work.

## Development Commands

```bash
cd apps/api
npm ci
npm run dev
```

`npm run dev` uses Node watch mode. If macOS reports `EMFILE`, use `npm run start` for a one-shot verification. The project does not modify OS file limits.

```bash
cd apps/mobile
# create an untracked .env from .env.example and adjust the host when needed
npx expo start
```
