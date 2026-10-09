# Guarded admission/read implementation candidate

Use each service's `guarded(...)` factory with an internal `AdmissionGuard`.
The legacy constructors and application composition remain unchanged. No route,
worker, database or external evidence backend is enabled by this implementation.

`policy.ts` reuses only the pure evidence extraction/decision modules, not their
filesystem loader or offline runner. Service checks re-extract actual supplied
bytes; observation IDs alone are not authority. Policy/rule versions, source
context, evidence revision/digest and current target bindings are checked.

An internal `EvidenceProvider` must authenticate lineage claims and bind them to
the actual family/representation. Reference hash syntax and reviewer-shaped data
do not establish truth. There is no production acceptance stub. The provider
must use the supplied transaction client during writer checks; HTTP callers must
never supply a provider, clock, claim approval or skip-validation flag.

All N/Y/viewer body completion times are required and must not be future times.
Y age is in [0, 86400000] ms; body-time skew is in [0, 900000] ms. Optional
request/header timestamps are checked when present. N/viewer do not separately
have a 24-hour age cap. Stored evidence on transport failure is usable only for
`use`, within its original validity; admission, malformed evidence, absent
targets, contradictions and expired evidence fail closed. No retries are added.

Activation checks occur before its transaction, after existing locks/resolution
checks, before each eligibility write, before transition, and on the actual
returned active target before the transaction callback returns. Existing stale
resolution checks remain. Guarded deactivation fails closed with
`DEACTIVATION_REQUIRES_SEPARATE_AUTHORITY`; this task does not authorize automatic
status repair/hold/deactivation. Low-level metadata, receipt, relation and family
writers are unchanged and are not claimed to be guarded by this integration.

Each guarded write records its own binding in the request-local session. Every
recorded binding is rechecked before successful callback return, independently
of whether the result contains an active activation. Valid negative eligibility
evaluations still return `candidate_not_ready`; expiry or changed evidence rolls
back through the existing helper. This is not a guarantee about the later instant
at which PostgreSQL completes COMMIT.

Scope checks every active entry before return. Search checks scope before
dependencies/query and after query; any denied active family rejects the whole
operation. Typed empty/veto paths retain their existing meaning. Sessions pin
evidence and scope revisions, use an internal clock and reject clock reversal.
Service cache: NOT_PRESENT. Tests simulate a reused scope to verify no bypass.

Scope checks return independent, frozen copies of the supported scope DTO,
including entries/vetoes/document IDs. Guarded consumers use these copies, never
the caller-owned original. External alias mutation is isolated, not necessarily
reported as an error; authoritative evidence revision changes still fail closed.
Dense readiness is copied before another await, checked against each approved
scope representation, and reused as the same immutable query/return plan. Dense
and lexical generation identifiers are not compared across domains.

Synthetic tests exercise real orchestration with fake repositories/clients and
fake embeddings. They do not establish PostgreSQL rollback/isolation behavior,
actual lineage acceptance, production enforcement or benchmark readiness.
