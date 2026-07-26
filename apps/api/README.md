# ALPHA TWIN API

Fastify backend for normalized market data. The mobile app calls this API only; provider credentials remain in the ignored `apps/api/.env` file.

P3-C-3B also provides normalized OpenDART company profiles and disclosure lists. P3-C-3C-B adds lossless transport for one explicitly requested OpenDART financial report. P3-C-3C-C adds a deterministic canonical summary over that transport DTO. OpenDART credentials remain server-only and are never passed to the mobile application.

## Setup

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run start
```

Copy only variable names and non-secret defaults from `.env.example`. Never commit a real service key or place it in an `EXPO_PUBLIC_*` variable.

## Public-data policy

- Symbols are trimmed, then validated as exactly six digits.
- Invalid formats return 400 before an external call.
- Valid symbols with no matching public rows return 404 `SYMBOL_NOT_FOUND`.
- Provider failures return stale cache, then supported Mock fallback, otherwise 503.
- Ranges are limited to `1m`, `3m`, `6m`, and `1y`.
- Public data is confirmed EOD data (`dataMode=eod`), not a real-time price.
- Weekends and holidays do not make a normal EOD response stale.
- KST date-only strings are used for query boundaries and returned trading dates.

Pagination follows upstream `pageNo`, `numOfRows`, and `totalCount`. It stops at 20 pages or 2,000 rows and rejects repeated pages, invalid metadata, empty intermediate pages, and partial failures. No automatic retry is performed for 429, authentication, timeout, or server failures.

## Price adjustment

Candles use the provider response as delivered. ALPHA TWIN does not calculate split, consolidation, dividend, or other corporate-action adjustments. `priceAdjustment=unknown` is used until a documented adjusted-price source is selected. Do not use these rows as adjusted long-horizon return or ML input data without further validation.

## Cache and concurrency

The default `MemoryCacheStore` is process-local and bounded. Keys have these forms:

```text
market-data:{provider}:quote:{symbol}
market-data:{provider}:candles:{symbol}:{range}
```

Entries track `createdAt`, `freshUntil`, and `staleUntil`. Same-key cache misses share one in-flight Promise, which is removed after success or failure. `CacheStore` is the future persistence boundary; P3-C-2 does not add a file cache, Redis, SQLite, PostgreSQL, or any cross-process guarantee.

## Observability and security

Fastify logs safe structured market-data categories only. Logs may include provider, symbol, range, duration, page count, cache state, and fallback state. They must never include a service key, complete provider URL or query string, authorization header, `.env` value, provider response body, or cache content.

`/health` exposes process status plus non-sensitive provider/cache state. It does not test or reveal credential configuration.

## OpenDART company and disclosure data

Configure OpenDART only in the ignored backend `.env`:

```text
OPENDART_API_KEY=
OPENDART_BASE_URL=https://opendart.fss.or.kr
OPENDART_TIMEOUT_MS=7000
OPENDART_ARCHIVE_TIMEOUT_MS=15000
OPENDART_INDEX_CACHE_DIR=
```

The server starts without `OPENDART_API_KEY`. Market-data routes and `/health` continue to work, while OpenDART routes return a safe `503 OPENDART_NOT_CONFIGURED`. Never create an `EXPO_PUBLIC_*` OpenDART credential.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/companies/:symbol/profile` | Allowlisted company profile fields |
| GET | `/api/v1/companies/:symbol/disclosures` | One bounded disclosure page |
| GET | `/api/v1/companies/:symbol/financials` | One specific financial report |
| GET | `/api/v1/companies/:symbol/financials/normalized` | Eight canonical metrics for one specific report |
| GET | `/api/v1/companies/:symbol/financials/latest` | Latest filed periodic financial report |
| GET | `/api/v1/companies/:symbol/financials/normalized/latest` | Canonical summary for the latest filed report |

Disclosure query parameters are `from`, `to`, `finalOnly`, `category`, `detailCategory`, `page`, and `pageSize`. Dates use `YYYY-MM-DD`; the default is the latest 90 calendar days in KST. The inclusive range is limited to 366 days, pages start at 1, and `pageSize` is limited to 100. A request retrieves one page only and never crawls all history.

OpenDART status `013` means profile-not-found for the profile operation but a successful empty page for disclosures. Report-name prefixes determine `correctionType`. The `rm` flag `정` means that a subsequent correction exists, not that the current item is itself a correction; `철` marks withdrawal and `연` marks consolidated content.

Financial queries require `businessYear`, `reportCode`, and `fsDiv`. Years must be four digits from 2015 through the current KST year. Report codes are `11013` (Q1), `11012` (H1), `11014` (Q3), and `11011` (FY); divisions are exact uppercase `CFS` or `OFS`. There is no `latest` query. A CFS request falls back to OFS only when CFS returns status `013`. OFS `013` returns `404 FINANCIAL_REPORT_NOT_FOUND`; provider failures, malformed rows, and invalid amounts never trigger OFS resolution.

Financial lines preserve statement type, account identity, account detail, receipt number, period names, source amount fields, order, and currency. Amounts are integer `string | null`: valid comma grouping is removed without JavaScript number conversion, while blank and dash mean missing, not zero. Malformed values fail with a safe 502 response. BS remains point-in-time; interim IS/CIS keeps quarter and cumulative fields separate; CF remains a period flow; SCE dimensions remain in `accountDetail`. The official standard-code-unused marker maps to a null account ID with an explicit kind.

Specific financial reports use a 12-hour fresh cache and may use the same exact query stale for up to seven days only after an availability failure. Cache keys isolate corp code, year, report code, and requested division. CFS-to-OFS resolution remains distinct from provider fallback, so OpenDART response metadata keeps `fallback=false`.

The normalized financial route uses the same required `businessYear`, `reportCode`, and `fsDiv` query and leaves the existing flat financial route unchanged. It always returns object keys for `totalAssets`, `totalLiabilities`, `totalEquity`, `cashAndCashEquivalents`, `revenue`, `operatingIncome`, `netIncome`, and `operatingCashFlow`. Each metric is `resolved`, `unresolved`, or `conflict`; a normal transport response with an unresolved or conflicting metric remains HTTP 200.

The account normalizer checks the metric's allowed statement first, then ranks an exact standard account ID over an explicitly approved ID alias and an exact approved account-name alias. Name fallback is available only when the account ID is missing or marked standard-code-unused. It does not use partial strings, fuzzy matching, broad whitespace removal, regular expressions, translations, or AI. Equivalent IS/CIS rows are deduplicated deterministically with IS preferred only at equal match rank and value; different values, currencies, or dimensions produce a conflict rather than a selected value.

BS metrics use `currentAmount` as a point-in-time value. Q1, H1, and Q3 income metrics use `currentCumulativeAmount`; FY income uses annual `currentAmount`. Interim operating cash flow is semantically cumulative but uses OpenDART's `currentAmount` source field, and FY cash flow uses annual `currentAmount`. Missing required fields are not substituted or calculated. Values remain integer strings, currencies remain nullable, and resolved evidence retains receipt, statement, account identity, dimension, source field, basis, match method, and currency.

Normalized summaries inherit report resolution and OpenDART stale metadata from the cached transport DTO. They add no second cache. The normalizer is an account-selection layer, not a financial-ratio, scoring, forecasting, or display-formatting engine.

The latest financial resolver uses filed periodic disclosures rather than the current date. It searches one bounded page for each of A001 business reports, A002 half-year reports, and A003 quarterly reports over the latest 366 KST calendar days with final-report filtering. OpenDART applies its broad `pblntf_ty` filter instead of the detail filter when both transport parameters are sent, so a logical A001/A002/A003 query sends only `pblntf_detail_ty`; the detail code already identifies the periodic category. This preserves the public query meaning while preventing cross-category results.

The strict final `(YYYY.MM)` marker supplies `businessYear` and period end. A001 maps to FY, A002 to H1, and A003 maps to Q1 or Q3 using the company's profile `fiscalYearEndMonth`. Non-December fiscal calendars use modulo-12 month arithmetic. Missing or malformed markers, invalid fiscal months, and fiscal-period mismatches return an explicit error without using receipt date, the current date, or an older filing.

Withdrawn filings are excluded. A selected filing that still declares a subsequent correction is unresolved. Remaining candidates are sorted by receipt date and receipt number; a malformed newest valid candidate is never replaced by an older report. The selected disclosure receipt must exactly equal the financial statement receipt before raw or normalized latest data is returned.

Latest pointers use a process-local 30-minute fresh cache and a one-day stale window with same-corp single-flight. `latest-report-cache` stale is allowed only for provider timeout, rate limit, or availability failures. Empty searches, malformed candidates, fiscal mismatches, authentication errors, and withdrawn-only results never use stale pointers. Financial CFS-to-OFS handling remains in the existing financial service, and an unavailable selected report never falls back to an older periodic filing.

Both latest routes accept only optional uppercase `fsDiv=CFS|OFS`, defaulting to CFS. Their wrappers retain separate resolution and financial metadata, including independent stale reasons and filing/account provenance.

The corp-code resolver downloads a bounded ZIP only when needed, rejects encrypted or ambiguous archives, rejects XML containing DOCTYPE or ENTITY declarations, validates records, and creates a deterministic SHA-256 checked JSON snapshot. It keeps a process-local Map plus an atomic local snapshot under `apps/api/.runtime-cache/opendart/` by default. The index is fresh for 24 hours and may be reused stale for 30 days. Profile cache is 7/30 days fresh/stale; disclosure cache is 30 minutes/1 day. OpenDART has no operational Mock fallback.

Runtime cache files, downloaded archives, extracted XML, complete request URLs, query strings, credentials, and raw provider bodies must not be logged or committed. The profile mapper intentionally excludes corporate registration number, business registration number, full address, phone, and fax. Local snapshots are process-local acceleration only: ephemeral deployments can redownload after restart, and multiple instances do not share a lock or cache.

Fixture tests need no API key. Optional live verification should be run only when an ignored `.env` already contains `OPENDART_API_KEY`; it must keep request URLs and credentials out of output. P3-C-3C-B live validation covers specific Samsung Electronics Q1/FY and SK hynix Q1 reports, plus a direct OFS request, without storing provider responses. OpenDART usage limits are provider-controlled and are not hard-coded in this project.

## Development notes

`npm run dev` and `npm run start` both load `.env` only when it exists. Watch mode can hit the macOS `EMFILE` limit in a heavily loaded development session; use `npm run start` for one-shot verification instead of changing system limits.

This service does not provide KIS, WebSocket prices, KRX/Koscom feeds, news, AI/RAG, ML/DL, accounts, orders, trading, databases, or production deployment. Mobile OpenDART integration, Company Health, ratios, and analysis scores remain separate. Real-time or redistributed KRX data requires a separate licensed provider agreement.
