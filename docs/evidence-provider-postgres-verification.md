# Evidence provider PostgreSQL verification

This opt-in integration helper is not part of the default DB suite and has no
import-time database effects:

`apps/api/integration-test/helpers/evidenceProviderPostgresCases.ts`

An external, preserved run owner must first create and verify a new isolated
PostgreSQL 16 cluster, install the locally available vector extension, apply the
eleven committed migrations in order with the normal migration lock, and supply
a non-superuser connection configuration. The helper is not a target-authority
validator. Its host/port/name checks are additional bounds, not proof of ownership.
Never invoke it against existing benchmark, development, or production data.

The owner records cluster identity, migration hashes, actual import/command,
helper/source hashes, failure history, and shutdown. Credentials exist only in
process memory. The runner must block external network and existing DB endpoints.
It must stop only its own cluster and preserve PGDATA and evidence after each run.

## Cases

- P1: real pinned N/Y/viewer files and pinned synthetic claim catalog feed the
  production evidence provider, binding reader, graph reader, guard, activation
  repositories, active-scope resolver, and lexical search repository. Require a
  new activation, separate observer connection, eligibility/activation/history
  consistency, and at least one matching chunk bound to the actual generation.
- P2-before: keep an honestly resolved ready scope, change only its synthetic
  generation status to failed, and require the production provider to reject
  before lexical retrieval (zero calls).
- P2-after: perform one real retrieval, change status on a separate connection,
  and require the final provider check to prevent a successful return. The first
  query's results are never substituted. Both P2 fixtures first pass positive
  retrieval, retain their generation ID/fingerprint, and update exactly one row.
- P3: a dedicated reader-probe transaction changes one synthetic family revision
  A to B without commit. The production adapter reads B on that client while an
  independent observer reads A. Stale A evidence must fail specifically with
  DB_BINDING_MISMATCH; explicit rollback must restore A to a fresh observer.

P1 observes preflight/read leases separately from post-lock, beforeWrite, and
finalizeWrites. Transaction stages must use the same supplied client. Query
observers return the original production SQL results unchanged. Pool connection
reuse across separate transactions is permitted; PID equality alone is not the
transaction-visibility proof.

## Bounds and interpretation

Only synthetic fixture state is written. Test-local acceptance is not reviewer
approval, and the fixed clock is not a refreshed timestamp on actual evidence.
Each receipt has its own catalog/provider. Queries, connection attempts, cases,
and runner cleanup are bounded. No sleeps are used as correctness evidence.

Non-DB unit tests run separately with credential variables removed and the
existing no-network guard. Report unit and PostgreSQL counts separately. Do not
rerun the destructive full DB suite or the earlier guarded T1-T4 cases here.

Passing these tests does not establish an atomic filesystem/DB snapshot,
operational claim authority, approval of the actual nine disclosures/three
relations, multi-receipt routing, default app composition, ADMISSION_READY,
BENCHMARK_READY, or POLICY_ENFORCED_IN_PRODUCTION.
