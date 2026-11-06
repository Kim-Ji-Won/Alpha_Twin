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

Before accepting each Golden entry, independently establish source ownership,
current-effective/legal terminal, root/direct-edge/completeness where applicable,
representation/chunk/content binding, and actual location and relevance. A boolean
currentEffectiveCorrection is not proof. Schema success is not evidence approval,
active scope, dense readiness, or benchmark authorization. Do not force uncertain
correction examples into a coverage target.
