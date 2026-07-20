# ALPHA TWIN API

Fastify backend for normalized market data. The mobile app calls this API only; provider credentials remain in the ignored `apps/api/.env` file.

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

## Development notes

`npm run dev` and `npm run start` both load `.env` only when it exists. Watch mode can hit the macOS `EMFILE` limit in a heavily loaded development session; use `npm run start` for one-shot verification instead of changing system limits.

This service does not provide KIS, WebSocket prices, KRX/Koscom feeds, OpenDART, news, AI/RAG, ML/DL, accounts, orders, trading, databases, or production deployment. Real-time or redistributed KRX data requires a separate licensed provider agreement.
