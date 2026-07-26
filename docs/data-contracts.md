# ALPHA TWIN Data Contracts

## 1. P3-B through P3-C-3C-D Scope

P3-B establishes the backend boundary for market data and completes one vertical slice: Company Twin quote and daily candles. It does not connect AI, ML/DL, OpenDART, news, accounts, orders, or a database.

P3-C-1 adds the Financial Services Commission public stock price API as the first real provider. P3-C-2 removes the two-symbol allowlist, adds bounded pagination, KST date-only handling, cache isolation, request coalescing, and safe operational status. Values remain confirmed daily prices rather than real-time quotes. The source generally updates on the following business day.

P3-C-3B adds a separate OpenDART domain for six-digit symbol resolution, company profiles, and disclosure lists. P3-C-3C-B adds one explicit OpenDART financial report as a lossless transport DTO. P3-C-3C-C adds deterministic account normalization for exactly eight canonical metrics. P3-C-3C-D resolves the latest filed periodic report from OpenDART disclosure history. It does not add mobile OpenDART screens, ratios, analysis scores, or an operational Mock fallback.

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
| GET | `/api/v1/companies/:symbol/financials` | One specific OpenDART financial report |
| GET | `/api/v1/companies/:symbol/financials/normalized` | Canonical summary for one specific report |
| GET | `/api/v1/companies/:symbol/financials/latest` | Latest filed periodic report plus financial DTO |
| GET | `/api/v1/companies/:symbol/financials/normalized/latest` | Latest filing plus canonical summary |

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

`GET /api/v1/companies/:symbol/financials` requires `businessYear`, `reportCode`, and `fsDiv`. `businessYear` is an exact four-digit year from 2015 through the current KST year. Report code mappings are `11013=Q1`, `11012=H1`, `11014=Q3`, and `11011=FY`. `fsDiv` accepts only exact uppercase `CFS` or `OFS`; lowercase values and latest-report inference are rejected before provider access.

`FinancialStatementsResponseDto` contains the symbol, resolved corp code, report metadata, flat financial lines, distinct sorted currencies, aggregated warning counts, and OpenDART metadata. Report metadata preserves requested and resolved division, any CFS-to-OFS resolution, period kind, and the one receipt number shared by every line. Each line preserves receipt, statement type/name, account ID and kind, account name/detail, all six distinct amount source fields and period names, order, and currency.

All financial amounts are normalized integer strings or null. Proper comma grouping and a leading minus are accepted; JavaScript number conversion, decimal truncation, malformed-comma repair, and missing-to-zero conversion are forbidden. Blank and dash values map to null with separate warning counts. The standard-code-unused marker maps to `accountId=null` and `accountIdKind=standard-code-unused`; SCE dimensions remain in `accountDetail`.

The transport layer does not reinterpret statement semantics. BS values remain point-in-time. Interim IS/CIS quarter and cumulative values remain separate. CF remains a period flow, and SCE remains dimensioned. It does not select revenue, operating income, assets, or other canonical metrics.

`GET /api/v1/companies/:symbol/financials/normalized` reuses the same specific-report validator and transforms the existing transport DTO without another provider call or cache. Its `metrics` object always has exactly eight keys: `totalAssets`, `totalLiabilities`, `totalEquity`, `cashAndCashEquivalents`, `revenue`, `operatingIncome`, `netIncome`, and `operatingCashFlow`. Each value is a discriminated union with `status=resolved|unresolved|conflict`. Normalization domain states return HTTP 200; transport, provider, mapping, or missing-report failures retain their existing HTTP errors.

Allowed statements are BS only for assets, liabilities, equity, and cash; IS or CIS for revenue, operating income, and net income; and CF only for operating cash flow. SCE is excluded. Candidate ranking is exact standard account ID, explicitly approved account ID alias, then exact approved account-name alias. Account-name fallback is accepted only for missing or standard-code-unused IDs. No substring, fuzzy, regex, translation, or LLM match is used.

At the highest match rank, equivalent rows are deduplicated deterministically, with IS before CIS only when candidates are otherwise equivalent. Different values or currencies are `value-conflict`; different account dimensions are `dimension-conflict`. No arbitrary first row is selected. Candidate diagnostics are bounded and omit amounts. Production ID aliases remain empty until validated by official or multiple live samples.

BS metrics select `currentAmount` with `current-point-in-time` basis. Q1, H1, and Q3 income metrics select `currentCumulativeAmount` with `current-cumulative` basis; FY income selects annual `currentAmount` with `current-period` basis. Interim CF uses OpenDART's `currentAmount` source with semantic `current-cumulative` basis, while FY CF uses `currentAmount` with `current-period` basis. Missing required amounts are unresolved and never replaced, summed, converted to numbers, rounded, or treated as zero.

Resolved values remain integer strings and preserve nullable currency. Missing currency can resolve with `MISSING_METRIC_CURRENCY`; differing currencies conflict. Evidence contains receipt number, statement type, account ID and kind, account name/detail, selected source field, basis, match method, and currency. Summary warnings aggregate unresolved, conflict, missing-currency, and equivalent-duplicate metrics.

Report metadata preserves requested/resolved CFS or OFS and any CFS-to-OFS resolution. OpenDART source, retrieval time, stale flag/reasons, fallback flag, and request ID are inherited without mutation. This layer does not calculate ratios, growth, scores, forecasts, unit conversions, or Company Health.

The latest resolver treats OpenDART's submitted final periodic disclosures as the source of truth. It performs one page-one, page-size-100 search for each detail code A001, A002, and A003 over an inclusive 366-day KST window with `last_reprt_at=Y`, descending date order. A004/A005 are excluded. A normal `013` result means no candidates for that detail code; three empty categories return `LATEST_FINANCIAL_REPORT_NOT_FOUND`.

OpenDART live validation showed that sending broad `pblntf_ty=A` together with `pblntf_detail_ty` causes the broad result to win. Therefore the internal logical query retains category A, while provider transport sends only the more specific detail parameter whenever one is present. Sending A001/A002/A003 separately then yields the intended disjoint periodic categories. The existing public disclosure query contract remains category/detail based.

Candidate type comes from the detail request context, not report-name classification. Withdrawn rows are removed, receipts are deduplicated, and candidates sort by receipt date then receipt number descending. A selected row with an unresolved subsequent-correction flag fails explicitly. A malformed newest valid candidate is never skipped in favor of an older report.

After known correction-prefix removal, exactly one final `(YYYY.MM)` marker is required. Its year is `businessYear`; receipt year and current date are never used to infer a report. A001 requires the profile fiscal year-end month and maps to `11011/FY`. A002 requires fiscal end plus six months and maps to `11012/H1`. A003 requires fiscal end plus three or nine months and maps to `11013/Q1` or `11014/Q3`. Month arithmetic supports non-December fiscal years without a date package. Missing profile fiscal month, malformed markers, and alignment mismatches are unresolved 502 errors.

`LatestFinancialReportResolutionDto` contains symbol, corp code, business year, report code, period kind, disclosure detail type, `YYYY-MM` period end, fiscal year-end month, selected filing provenance, resolution method, and OpenDART metadata. Raw latest wraps it with `FinancialStatementsResponseDto`; normalized latest wraps it with `NormalizedFinancialSummaryDto`. Resolution and financial stale metadata remain separate.

Latest pointer cache keys use corp code. Fresh/stale windows are 30 minutes/one day, and same-corp misses share the entire three-category resolution chain. Stale pointers add `latest-report-cache` and are available only after rate-limit, timeout, or availability failures. Empty results, authentication/configuration errors, malformed responses, ambiguous candidates, fiscal mismatches, and withdrawn-only results cannot use stale.

Latest routes accept only optional exact uppercase `fsDiv`, defaulting to CFS. The existing financial service retains its CFS-to-OFS behavior. Before returning either latest wrapper, the selected disclosure receipt must equal the financial report receipt; mismatch returns `LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH`. A selected filing with no CFS or OFS financial data remains a 404 and never causes an older filing lookup.

For a requested CFS report, only OpenDART status `013` permits one OFS request. A second `013` returns `FINANCIAL_REPORT_NOT_FOUND`; direct OFS requests never try CFS. Authentication, rate limit, timeout, transport, malformed response, consistency, and amount errors never trigger OFS resolution. Status `013` is authoritative and cannot return stale data.

Financial cache keys include provider operation, corp code, business year, report code, and requested division. The fresh TTL is 12 hours and stale maximum age is seven days. Same-key misses share the entire CFS/OFS resolution promise. Stale financial data is returned only after rate-limit, unavailable, or timeout errors and is marked with `financial-statements-cache`; corp-index stale state remains separately ordered.

The corp-code archive is limited to 20 MiB compressed, 8 entries, 64 MiB for the single XML entry, and 200,000 listed records. DOCTYPE and ENTITY declarations are rejected. Listed records are sorted by stock code and stored as a schema-versioned, SHA-256 checked JSON snapshot using a temporary file plus atomic rename. The default runtime directory is Git-ignored. Fresh/stale windows are 24 hours/30 days for the index, 7/30 days for profiles, and 30 minutes/1 day for disclosures.

Disclosure queries default to 90 KST calendar days, `finalOnly=false`, page 1, and page size 20. Dates must be real `YYYY-MM-DD` values, the inclusive range cannot exceed 366 days, and page size cannot exceed 100. Only the requested page is fetched.

OpenDART authentication, rate-limit, maintenance, malformed response, timeout, and provider request-mapping failures use stable ALPHA TWIN error codes. External messages, full URLs, query strings, and credentials are not returned or logged. The server can start without the key; only OpenDART routes return `OPENDART_NOT_CONFIGURED`.

Mobile integration remains separate. DB, Redis, distributed locking, Prometheus, financial ratios and analysis scores, Company Health, and actual AI remain outside P3-C-3C-D.

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
