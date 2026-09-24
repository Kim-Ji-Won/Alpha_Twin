# Benchmark marker boundary

Evaluation-only contract: `benchmark-marker-persistence@1`. The historical
`public.benchmark_environment_marker` name and its three values are preserved.
`benchmarkMarkerDdl.ts` owns the benchmark-only DDL. Application migrations,
application startup, and the verifier never install this table.

## Entry points

- `bootstrapBenchmarkMarker()` requires `ALPHA_TWIN_BENCHMARK_BOOTSTRAP_OPT_IN=1`.
- `verifyBenchmarkTarget()` requires `ALPHA_TWIN_BENCHMARK_VERIFY_OPT_IN=1`.
- Both read `TEST_DATABASE_URL` only. There is no application URL fallback.
- Only `localhost`, `127.0.0.1`, and `::1`, with the exact database name
  `alpha_twin_benchmark_test`, are accepted. Query parameters, fragments,
  production environment, and unsupported URL semantics fail before connect.
- Neither entry point accepts a client, connector, marker, or verified boolean.
  Raw driver errors are replaced with bounded status codes. No logger is used.

These modules are not auto-running commands. Calling bootstrap on an existing
target still requires the separately approved investigation/bootstrap phase.
Never import/run the historical Desktop scripts to invoke this boundary.

## Verification

One `REPEATABLE READ READ ONLY` transaction verifies read-only mode, runtime
database identity, ordinary permanent marker table, exact columns/nullability,
four named validated constraints, one fixed-value row, and the exact committed
migration sequence. Unknown future migrations fail until explicitly reviewed.
RLS, extra columns, views, inheritance, and user triggers on the marker are
rejected. A legacy table lacking the official constraints is a conflict, not
an implicit adoption/migration opportunity.

The ten inventory counts are bounded to one million rows per table, with query
and connection timeouts. All must be nonzero except correction relations:
historical candidate construction did not require corrections to exist yet.
No text/XML/chunk content is read. The snapshot is a minimum nonempty-schema
proof, NOT proof that these are the intended historical corpus or active pins.
Packet-pin/content-hash comparison is deferred to the approved `.0-C.1` phase.

Only successful verification registers a frozen evidence object in a private
WeakSet. Preflight rejects lookalike objects, including spread/JSON clones.
Evidence describes a completed observation, not a live connection or permanent
authorization. Reverify for each operation; never reuse it to authorize future
mutation or substitute it for packet-pin continuity evidence.

## Bootstrap

Bootstrap first performs the same read-only identity/schema/inventory checks,
allowing only an absent marker or an already exact marker. Empty, malformed,
or conflicting existing marker tables are never repaired. Exact existing
markers return `ALREADY_BOOTSTRAPPED` without DDL/DML.

For an absent marker, a separate transaction takes a bootstrap advisory lock
and SHARE locks on migration history and all inventoried tables. It rechecks
identity/schema/corpus and compares bounded physical-row fingerprints from
the preliminary observation. These fingerprints detect intervening writes,
including same-count updates, but are deliberately not durable corpus hashes.
Only then can the table and fixed row be created atomically. Failure rolls back;
no overwrite, deletion, or UPSERT exists. A non-cooperating creation race is
re-read in a fresh read-only transaction and only an exact winner is accepted.

## Validation and limitations

DB tests require a newly created disposable PG16 cluster with pgvector and
`ALPHA_TWIN_SYNTHETIC_BENCHMARK_TEST=1`, plus its explicit `TEST_DATABASE_URL`.
Never point the integration test suite at a historical benchmark database:
test fixture setup is intentionally destructive inside disposable targets.
The fixture uses existing canonical/lineage/lexical/activation services.

Use a non-owner SELECT-only role for real verification and a separate approved
setup role for bootstrap. Read-only transactions are defense in depth, not an
adversarial DBA sandbox. A copied marker, same-name cloned DB, local tunnel, or
host administrator can defeat name-based identity checks; independent operator
and corpus-pin verification remain necessary. No real benchmark access or
bootstrap is authorized by passing the synthetic tests.
