# Pending Review Artifact v1

`filing-eval-pending-review@1` is an evaluation-only review artifact, not a
`dense-eval-dataset@1` envelope and not a Golden promotion/import path. It is not
exported by the existing dataset loader or automatically discovered. Golden v1,
its scalar locator rule, hashes, review/seal gates and benchmark preflight remain
unchanged. No DB or network runtime is imported by this module.

## Ownership Finding

- A: CONFIRMED. `dataset.ts:parseChunk` rejects non-scalar locator values with
  `DATASET_LOCATOR_INVALID`. Canonical table range tuples are arrays.
- B: CONFIRMED. The earlier exporter constructed a Golden/dataset envelope from a
  proposal entry to probe that validator. This did not validate the review-packet
  or proposal schema. Those are distinct artifacts.
- C: NOT_CONFIRMED. That error does not prove a pending-scope schema prohibition.
  Golden dataset v1 already accepts pending review states, while refusing to run
  them as benchmark annotations. No dedicated validator for the historical
  `dense-eval-review-packet@1` was found. No mandatory-success corpusProof contract
  is inferred from an unvalidated historical packet. Prior reports are preserved.

## Contract

`parsePendingReviewArtifact` validates structure only. `importRecordedPendingProposal`
also checks supplied byte hashes against the manifest/checksum, original packet
and recorded comparison audit. Hash integrity is not proof of live DB authority.
Input buffers are supplied by the caller; the module opens no files or sockets.

### Raw JavaScript Input Boundary

Public artifact/locator parsers and the historical comparison helper first make
a detached data-only snapshot. Serialization uses the artifact parser's result,
never the original input. Supported inputs are schema-valid primitives, ordinary
dense arrays, and plain or null-prototype records. Frozen/read-only data and shared
references are supported; shared references are copied independently. Optional
undefined is still accepted only where the existing schema permits omission.

Before reflection, Node's `util.types.isProxy` rejects proxies (including revoked
proxies). Only own data descriptors are copied, without invoking getters, setters,
callbacks, iterators, or input methods. Arrays must have Array.prototype and only
length plus enumerable own numeric data slots. Holes and extra properties such as
map, toJSON or Symbol.iterator are rejected, not stripped. Records reject accessors,
symbol/non-enumerable properties, functions, custom prototypes and class instances.
Enumerable data keys such as __proto__ are defined safely, without prototype mutation.
Cycles are rejected; the input is never modified or frozen by the validator.

Snapshot traversal has a depth ceiling of 64 including the envelope. The existing
JSON depth ceiling of 40 and all schema length/range rules remain in effect.
After snapshotting, schema operations use module-owned copies only. The importer
remains a bytes API: manifest checksum, referenced byte hashes, JSON parsing and
schema checks are separate; it adds no raw-object import path. No schema/version or
valid JSON serialization format changes. This is not a JavaScript sandbox and does
not protect a runtime whose global built-ins have already been modified.

The artifact retains original entries/pins and historical corpusProof strictly
under provenance. New references preserve identity, chunk content, versions and
section path; only document, representation and locator references may differ.
Taxonomy uses the existing evaluation constants. Review is pending, round zero,
all eight decisions null. Scope/legal/retrieval/human/Golden readiness cannot be
self-promoted. Historical mismatch results are recomputed without coercion;
unproven serializer equivalence and mismatch cause stay UNKNOWN.

The locator uses the committed `FilingChunk['locator']` via a type-only import.
It requires entry name and nonnegative safe integer first/last block ordinals.
Optional table ID is nonempty; row/header tuples, when present, require a table
ID, exactly two nonnegative safe integers and start <= end. Ranges are zero-based
inclusive. Repeated headers need not be inside the data row range. Empty tables
may omit ranges. Narrative continuation fields remain supported. Only undefined
optional properties are omitted; null, empty arrays, strings and numeric strings
are never coerced. Object key order is immaterial; tuple order is meaningful.
Actual table bounds and row ownership are NOT proved by this structural check.

Serialization uses existing `canonicalJson`, with deterministic key ordering and
optional undefined omission. The CSV quotes fields and preserves original entry,
proposed groups and decisions as JSON; it is a review interchange, not executable
spreadsheet content. Open it with text import (no formula interpretation).

## Separated Results

- STRUCTURE_VALID: the dedicated parser accepted the artifact.
- RECORDED_EVIDENCE_IMPORTED: the importer checked the supplied historical bytes
  and preserved their references. Not a claim that the DB is unchanged today.
- BENCHMARK_READY: false. No dataset envelope or promotion is produced.

Current-effective/legal terminal, family/correction, v2 eligibility/activation/
active scope, human review/seal, correction coverage, and dense size/cost readiness
remain external unfinished gates. The 2383-chunk source exceeds the current
2000-chunk dense guard. The prior exporter pg concurrent-query warning is neither
reproduced nor fixed here. No Golden versions, metrics or dependency changes.
