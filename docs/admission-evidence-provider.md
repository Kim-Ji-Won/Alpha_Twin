# Preserved admission evidence provider (implementation candidate)

This opt-in composition is not connected to the default app, router or worker.
No operational claim issuer or accepted-claim storage backend is supplied.
`UnavailableClaimReader` is the default: policy selection never accepts a claim.

## Source and authority boundaries

| Component | Input and binding | Authority / limit |
| --- | --- | --- |
| PreservedEvidenceReader | Internal pinned manifest, canonical root, source SHA-256, request/receipt context, extraction and decision versions | Reads bounded actual bytes; reuses existing extractor. Preserves incomplete/legacy observations for policy rejection. |
| PinnedClaimReader | Pinned internal issuer catalog, decision, revision, artifact revision, company/family/root/revision/fingerprint | Internal catalog owner must independently verify and authorize claims. File hashes and accepted strings do not prove external truth. Positive fixtures are test-only. |
| CurrentBindingReader | Supplied client; parameterized graph, receipt, document, representation, eligibility, lexical generation and activation SELECTs | Returns DB-derived binding; compares every supplied expected field. No Pool, DML, connection or transaction ownership. |
| PreservedAdmissionEvidenceProvider | Above readers, explicit read-context owner | Supplies existing AdmissionGuard. No external refresh; refresh=ok describes successful local load, not a new provider request. |

Artifact references are constructor-owned copies. Source aliases retain the existing
observation-ID semantics; the provider revision is a separate aggregate digest.
The catalog format is new and must be created separately from preserved originals.
Each provider instance is scoped to one receipt catalog; multi-receipt dispatch is
not supplied. Wrong-target reuse fails closed rather than choosing another file.

## Client and snapshot contract

| Phase | Client source | Checks / ownership |
| --- | --- | --- |
| Preflight | Explicit ReadContexts.withClient('preflight') | Owner opens and bounds a REPEATABLE READ or SERIALIZABLE READ ONLY lease. Provider checks transaction settings. |
| Post-lock / beforeWrite / finalizeWrites | Existing activation transaction's exact PoolClient | Provider only reads this client; never leases another connection, commits, rolls back or releases it. Existing service owns locks and transaction. |
| Scope / retrieval use | Explicit ReadContexts.withClient('use') | Fresh bounded read lease per recheck. Compared with pinned scope binding before and after search. |

Use `preservedAdmissionGuard(reader, readContexts, claimReader, clock)` with the
existing `.guarded(...)` service factories. Internal composition must own roots,
pins, issuer configuration and read leases; none are HTTP request fields. Missing
context fails closed, without environment-variable or global-pool fallback.

File hashes pin bytes but do not atomically snapshot files with the database.
Fresh use checks are not the scope repository's original read snapshot. No new
long-running transaction spans embedding. Existing scope/readiness validators
remain responsible for detailed representation/generation integrity. The adapter
checks supplied binding fields and supported representation manifest versions;
it does not replace those validators or add a dense readiness repository.

The internal use operation additionally requires the joined lexical generation's
current status to be ready, without replacing its document/profile/ID/fingerprint.
Admission retains missing/not-ready generation evaluation. Graph query rows are
copied or mapped to owned snapshots before later awaits; this protects against
mutable executor aliases, not against changes observed by subsequent DB queries.

## Verification limits

Synthetic files exercise the actual readers/provider, with only query execution,
read leases, claim authority and downstream dependencies controlled in tests.
The activation test checks post-lock and final rechecks on the same supplied
client, including expiry after an eligibility evaluation. Fake transaction events
are not PostgreSQL commit/rollback evidence. No real SQL or external request is
part of this implementation run; prior PostgreSQL tests are not new validation.

Real preserved records remain unapproved. Offline policy checks do not validate
current DB state. Operational claim issuance, real database SQL validation and
any default composition change require separate approval and audit.
