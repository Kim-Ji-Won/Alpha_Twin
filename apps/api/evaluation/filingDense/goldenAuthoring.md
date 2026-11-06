# Golden Authoring Contract

This evaluation-only authoring contract does not authorize retrieval, admit a
filing, approve evidence, or promote a pending artifact. No Golden entries are
created by these helpers.

## Grades and evidence groups

- Grade 2: direct core evidence. The group alone directly supports the question's
  main claim or number, without substantive inference beyond simple arithmetic
  or format normalization.
- Grade 1: clearly relevant supporting or partial evidence. It supports part of
  the answer or supplies context, but alone is insufficient for the whole question.
- Unacceptable chunks are omitted from groups/acceptableChunks. There is no grade 0.
- Retrieval rank, lexical/dense scores and a model's answer quality never establish
  the annotation grade. Human review must judge the source against the question.
- Alternative chunks expressing the same fact belong in one group. Independently
  necessary facts belong in separate groups. Do not treat several complementary
  chunks as interchangeable alternatives: a hit on any acceptable chunk counts
  as a hit on that group.

The existing nDCG gain is `2 ** grade - 1`: grade 1 yields 1, grade 2 yields 3.
Only the first retrieved alternative from a group gains credit. Metric code and
chunk identity have not changed.

## Review records

| Status | Split | Rounds | reviewedAt / reviewerRoleId |
| --- | --- | --- | --- |
| pending | dev or holdout | exactly 0 | both absent, not null or undefined fields |
| reviewed | dev only | at least 1 | both required |
| sealed | holdout only | at least 2 | both required |

`reviewedAt` must be a nonempty parseable date-time string under the existing
Date.parse validator; authors should use an explicit UTC ISO timestamp.
`reviewerRoleId` matches `[a-z0-9][a-z0-9_-]{0,63}`, for example `author-review`
or `evidence-review`. It identifies a role, not a person's legal name/account.
Two rounds mean two review passes, not two distinct independent humans. This
individual project does not claim independent multi-person review.

Dev transitions pending -> reviewed; holdout transitions pending -> sealed after
two rounds. There is no dev -> sealed or holdout -> reviewed intermediate state.
Rounds cannot regress and sealed cannot be reopened. Metadata is required at
dataset parsing, transition checking and metric eligibility. Metadata describes
review; its presence does not authenticate that a human actually performed it.
The separate Pending Review artifact remains pending/0 with all decisions null.

## Lossless scalar locators

Canonical source authority is `FilingChunk['locator']`, unchanged in production.
`canonicalToEvaluationLocator` validates and copies canonical values; it never
stringifies tuples, mutates input, or silently discards unknown fields.

| Canonical field | Evaluation scalar fields |
| --- | --- |
| rowRange: [start, end] | rowStart, rowEnd |
| repeatedHeaderRowRange: [start, end] | repeatedHeaderRowStart, repeatedHeaderRowEnd |

Both endpoints must be present, nonnegative safe integers, start <= end, and
require a nonempty tableId. Values are zero-based inclusive. Repeated headers
need not lie inside the data row range. Empty tables may omit both ranges.
No null/numeric-string coercion or tuple-string shortcut is accepted.

entryName, firstBlockOrdinal, lastBlockOrdinal, tableId, continuation and
continuationIndex are preserved as scalars. Block endpoints must be paired and
ordered; continuation is boolean and continuationIndex a nonnegative safe integer.
`evaluationToCanonicalLocator` restores canonical-shaped locators exactly,
excluding absent optional fields. It rejects unknown legacy fields rather than
dropping them. Existing scalar-only legacy narrative locators (e.g. ordinal)
remain readable by the dataset parser, but are not automatically reconstructable
as canonical locators. Existing limits of 12 keys and 256 characters per string
remain; over-limit canonical values are rejected, never truncated.

Golden stays `dense-eval-dataset@1` / `dense-eval-v1`: this adds named scalar
normalization and tightens validation, without changing the envelope or metric
identity. Old reviewed/sealed records lacking metadata and old string-range
shortcuts must be explicitly corrected before loading. Empty committed fixtures
and hashes are unchanged. Existing historical artifacts are not rewritten.

## Identity is not approval

chunkKey binds provider/company/receipt/document/chunk/content/representation and
parser/chunker/schema versions. It intentionally excludes locator/sectionPath.
Human location review must separately compare the entire sectionPath and the
reconstructed canonical locator to the preserved source. Round-trip conversion
proves encoding, not that a table row exists or belongs to that chunk. No new
location-authority function or automatic promotion/import is introduced.

Before accepting each Golden entry, apply the authoring policy below. Schema
success is not source ownership, evidence approval, active scope, dense readiness,
or benchmark authorization. Types A/B/C describe policy boundaries, not new schema
fields or automatically detected entry types.

## Type A: fixed historical-source annotation

A question explicitly asks what a particular preserved receipt/report said, not
what is currently valid. For example: "In Samsung Electronics' 2025 annual report,
which product groups did the DX division describe producing and selling?"
The wording must unambiguously identify the historical report; the evidence pins
must bind its exact receipt. If title/period is ambiguous among submissions, put
the receipt number or submission date in the question as well.

Before acceptance, independently establish:

- Exact provider, corpCode, symbol and receiptNumber, with preserved source
  ownership evidence (not inferred from a title alone).
- Document/chunk/content/representation binding and parser/chunker/schema identity.
- Full sectionPath and canonical/evaluation locator correspondence to the actual
  preserved source. Scalar round-trip alone is not location authority.
- Human review of source relevance, evidence grouping and grade, and the review
  metadata required by the existing dev/holdout policy above.

When no current-validity or latest-terminal claim is made, a verified correction
root, direct predecessor edge or complete correction graph is NOT a prerequisite
for this annotation itself. Runtime current-effective/legal-terminal proof and
live evidence freshness are not prerequisites for Type A authoring. This is
permission to annotate a historical source, not to admit it as current evidence.
Missing source, pins, location or human review must never be replaced by this
exception. Pending candidates remain pending; this policy grants no review.

### Original receipts with known successor corrections

Such an original may be annotated under Type A only when the question clearly
fixes the historical receipt/report. "What did the report submitted on 2021-03-22
state about X?" is a historical question; "What does the final/current report
say?" is not. Disclose a known successor correction in the annotation context
(using existing notes, and question wording where needed); do not hide it or
present the original statement as a current fact. Recording a known successor
does not establish its direct edge, root or complete chain. Questions relying on
those relationships instead require Type B evidence.

## Type B: current-effective or correction-sensitive annotation

This applies when the question or expected answer claims current validity, final
corrected content, a before/after correction comparison, predecessor/successor,
withdrawal/cancellation, a current-effective terminal, or the correction chain.
Establish the root authority, verified direct edges, chain completeness, legal
status and terminal/current-effective evidence needed for the particular claim.
Do not substitute same-family membership, adjacent dates, absence of warnings,
or a boolean for proof. Do not force uncertain corrections into a coverage target.
Type B applies according to the claim even if currentEffectiveCorrection is false.

## currentEffectiveCorrection is a coverage annotation

- false: this entry is not classified as a current-effective correction coverage
  example. It does NOT mean "lineage unverified" and does not prohibit Type A.
- true: this entry is classified as a current-effective correction evaluation
  example. Authoring approval requires separate supporting evidence; the boolean
  authenticates neither terminal, root nor lineage.
- The parser validates the boolean and coverage counts true entries. The metric
  engine does not use it as a relevance score. Neither value bypasses review
  metadata or metric eligibility. validateCurrentEffectiveEvidence compares pins
  with a supplied chunk-key set; it does not independently verify lineage/legal
  authority or turn the boolean into proof.

## Type C: runtime retrieval benchmark

Regardless of Type A/B annotation, a lexical/dense benchmark using production-style
scope must separately satisfy verified active scope, eligibility, activation,
representation compatibility, applicable lexical/dense readiness, evidence and
freshness guards, and benchmark target/preflight requirements. A historical pin
may be authorable yet absent from the allowed current scope; do not widen that
scope, repin to a different receipt or count an incompatible run as valid merely
to execute the question.

This policy changes none of FilingResolutionService, verified report families,
verified correction relations, activation, active scope, admission evidence
provider, freshness, legal-status checks, lexical/dense readiness or production
AI evidence use. These states remain distinct:

`AUTHORABLE_AS_GOLDEN != ADMISSION_READY != BENCHMARK_RUNTIME_READY != AI_RAG_USABLE`

## Existing tranche candidates: policy examples only

These are the five [5-B.0] report-local candidate labels, not newly authored
entries or a renumbering of preserved packets.

| Candidate | Receipt | Company / report family | Historical subject |
| --- | --- | --- | --- |
| DEV-001 | 20260310002820 | Samsung Electronics / annual | DX products, narrative |
| DEV-002 | 20260814003699 | Samsung Electronics / half_year | R&D purpose, narrative |
| DEV-003 | 20260515002287 | SK hynix / quarterly | Interest-rate risk, narrative |
| DEV-004 | 20260310002820 | Samsung Electronics / annual | Material purchase share/suppliers, table |
| DEV-005 | 20260515002287 | SK hynix / quarterly | Semiconductor revenue share, table |

With wording fixed to those reports and no correction/current-effective claim,
all five are Type A: lineage alone is not an authoring HOLD reason. Preserved
source ownership/content, exact pins, locators and human relevance/grade review
must still be checked in the next authoring step. This table neither accepts
Golden entries nor creates reviewed/sealed metadata, admission claims or runtime
readiness. No actual dataset or Pending Review artifact is changed by this policy.
