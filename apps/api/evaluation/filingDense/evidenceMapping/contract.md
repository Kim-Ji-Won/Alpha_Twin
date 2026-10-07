# Local evidence mapping implementation candidate

Evaluation only. This is not a production policy approval, a server signature verifier,
a lineage writer, an admission gate, or a benchmark-ready declaration.

## Interfaces and boundaries

- Schema: `filing-evidence-mapping@1`.
- Extraction: `opendart-preserved-profile@1`.
- Decision: `evidence-mapping-decision@1`.
- `loader.ts`: bounded reads from a local allowlist with byte hashes; rejects traversal,
  dot files, non-files, and symlinks. A catalog is not externally issued authority.
- `input.ts`: exact source kind/request/target binding, SHA-256, timestamp validation.
- `extract.ts`: preserved list JSON and a narrow non-executing viewer profile.
  The existing fast-xml-parser validates/parses bounded select/span/label fragments.
  Scripts, comments and inert blocks are masked, preserving line offsets. Unsupported
  or conflicting structures never become an assertion of no warning.
- `warningProfile.ts`: internal viewer-only raw tag/quoted-attribute scanner. Actual
  class tokens identify warning divs; data-class and substring matches do not.
  Div nesting must close without repair. Duplicate attributes/containers, unquoted
  attribute values, truncated tags and malformed warning contents fail explicitly.
  Observed warning, successfully inspected absence and not-assessable structure are
  separate states propagated to decisions. This is not a general HTML5 parser.
- `decision.ts`: pure internal observation-to-decision mapping. No I/O or clock.
  Public acquisition inputs are bytes and local provenance; arbitrary JavaScript
  objects are not a hostile-object sandbox API. Internal observations are constructed
  by the extractor, not accepted as caller-supplied verified authority.
- `offlineRunner.ts`: explicitly invoked, fixed approved workspace and pinned design
  manifests; no environment file, network, DB, CLI path override or production imports.
  Existing design summaries are comparison targets, not extraction inputs. Candidate
  edge directions are examination subjects, not accepted relation evidence.

## Source and time semantics

Raw body hashes are verified against bytes. Observation IDs include kind, request,
target, timestamps, response context and body hash. A file alias is not a second
independent observation. N/Y with identical bodies remain distinct observations.
Extraction locations are generated from bytes, not caller-provided locations.

`rawReportName` is source-local observed metadata, not a shared cross-source naming
standard. Lists retain report_nm with its existing missing/null semantics. An exact
viewer retains the report segment of its decoded title (company/report/date), after
the existing selected-option title/receipt check. The selected option's title must
be nonblank. Only the current receipt's selected option is used, never a family
endpoint or a list-supplied expected name. The original full title and selected
option remain recoverable through the existing title/option locators and body hash.
The existing entity decoding and whitespace handling are unchanged. A bracketed
prefix is still removed only for the existing title-to-option consistency check;
it is retained in observed metadata. No new semantic normalization is introduced.
The existing same-kind numeric-instant comparison now receives viewer report names.
There is no list-to-viewer report-name conflict rule. Observation IDs remain derived
from source context and bytes, not extracted fields; preserving this metadata changes
serialized observations but does not change those IDs or require new locators.

Legacy N provenance lacks a full serialized URL and body completion timestamp.
The runner labels reconstructed request conditions `legacy-collection-contract`
and uses the recorded headers observation phase, never a substituted completion time.
This exception is N-only. A/B use recorded body completion timestamps. This preserves
the design's provenance limitation; it is not approval of timestamp phase equivalence.

Timestamps require a valid calendar, explicit UTC offset, seconds 0..59 and at most
millisecond precision. Missing, invalid, future and reversed times are not clamped.
`evaluatedAt` is mandatory. No implicit 15-minute/24-hour values exist in decisions.

Simulation explicitly supplies `maxSkewMs` and `maxFinalAgeMs`, both nonnegative safe
integers. Boundaries are inclusive. Its required set is same-receipt exact N, positive
Y and exact viewer. Missing Y is NOT_REQUESTED or unavailable, never invented ABSENT.
Skew covers those observations; age is the Y observation age (oldest when repeated).
All repeated observations remain visible: there is no automatic latest-wins.
Simultaneous metadata conflicts compare validated numeric instants, not timestamp
spellings. Extracted metadata, not JSON formatting/body hash alone, determines the
conflict. Raw timestamps, hashes and distinct observation identities remain intact.
Missing/invalid required observations yield NOT_EVALUABLE. Guide/script fetch times
are not included. Unapproved mode calculates numbers but returns NOT_EVALUATED.

The preserved-fixture runner's explicit simulation uses 900000/86400000 ms and
`2026-09-30T09:10:00.000Z`. This is not execution-time freshness validation. Compared
with the design probe, Y age replaces the probe's maximum age across all sources;
missing-Y sets are explicitly NOT_EVALUABLE rather than an arithmetic-only pass.

## Proof and policy limits

No approved-policy mode/catalog is activated. Forged approval flags and unregistered
approved-policy references are rejected. Even WITHIN_LIMITS is POLICY_SIMULATION,
with POLICY_NOT_APPROVED retained and enforcement NOT_CONNECTED.

The viewer profile supports identity, selected receipt, body family membership and
explicit non-final warning only. It does not support an authoritative root or directed
predecessor profile. A root label elsewhere, script parameter, attachment or two-item
family cannot create a relation. Directional candidate keys are never reordered.

List status 013 permits omitted pagination fields. Present page_no/page_count must
use the same integer grammar as status 000 and match the recorded request. Present
totals must be zero and list must be empty; explicit null/invalid/contradictory values
are malformed, never completed absence. Missing fields are not synthesized.

Opposite facts are scoped by receipt and observation time; other-receipt warnings
are not conflicts. Same-time contradictions and different-time contradictions have
different reason codes. Unknowns and acquisition failures are not legal inactivity.

No legalStatus patch, persistence DTO, manual hold, establishment evidence update,
verification hash replacement or activation plan is returned. Establishment evidence
ingestion/reconciliation remains out of scope. Family list disagreement can produce
FAMILY_EVIDENCE_CONFLICT without modifying any existing immutable family record.
Expiry is a use-suitability result, not reported_active-to-unknown or true-to-false.
Existing resolver/active-scope TTL enforcement remains unconnected.

## Test-plan correspondence

`test/filingEvidenceMapping.test.ts` names T01 through T36 explicitly. These are actual
tests, with several boundary variants inside each test. Adjusted design cases:

- T16: no explicit-root source profile is implemented. A root-labelled unsupported
  fragment remains unproven, rather than introducing an unapproved source profile.
- T29: approved catalog fixture execution is intentionally omitted: this task forbids
  activating approved mode. Tests cover rejection plus unapproved/simulation separation.
- T33: tests conflicting family observations and absence of a hash-replacement API;
  existing DB establishment evidence is not loaded or reconciled in this module.
- T34: locations are derived internally; tests verify their derivation, byte mismatch
  and path escape rejection instead of accepting a mutable external locator claim.

Small synthetic inputs only. No raw real viewer body or credential is committed.
Full unit validation must remain non-DB; a separate local network guard can synthesize
socket failures for the existing database-readiness unit test. Record that guarded
execution distinctly from unguarded or DB integration results. DB suite is NOT_RUN.
