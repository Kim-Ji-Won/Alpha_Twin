import { ActiveCompanyFilingScope } from '../activeScope/contracts.js';
import {
  DenseNotReadyReason,
  DenseReadyGenerationReference,
  FilingDenseCandidate,
} from '../dense/retrievalContracts.js';
import { FILING_RETRIEVAL_POLICY } from '../eligibility/policies.js';
import { FilingLexicalCandidate } from '../lexical/contracts.js';
import { FILING_LEXICAL_PROFILE } from '../lexical/profile.js';

export const DENSE_EVALUATION_BASE_SCOPE_POLICY_ID = FILING_RETRIEVAL_POLICY.policyId;

export interface SearchActiveCompanyFilingsLexicallyInput {
  readonly corpCode: string;
  readonly symbol: string;
  readonly query: string;
  readonly topK?: number;
}

interface ActiveCompanyLexicalSearchBase {
  readonly scope: ActiveCompanyFilingScope;
  readonly lexicalProfileId: typeof FILING_LEXICAL_PROFILE.profileId;
}

export type ActiveCompanyLexicalSearchResult =
  | ActiveCompanyLexicalSearchBase & {
    readonly status: 'scope_empty';
    readonly candidates: readonly [];
  }
  | ActiveCompanyLexicalSearchBase & {
    readonly status: 'no_matches';
    readonly candidates: readonly [];
  }
  | ActiveCompanyLexicalSearchBase & {
    readonly status: 'matched';
    readonly candidates: readonly [FilingLexicalCandidate, ...FilingLexicalCandidate[]];
  };

export interface SearchActiveCompanyFilingsDenselyInput {
  readonly corpCode: string;
  readonly symbol: string;
  readonly query: string;
  readonly denseProfileId: string;
  readonly topK?: number;
}

export interface DenseGenerationProvenance extends DenseReadyGenerationReference {
  readonly denseProfileId: string;
  readonly denseProfileFingerprint: string;
}

export interface DenseQueryEmbeddingProvenance {
  readonly provider: 'openai';
  readonly requestedModel: string;
  readonly responseModel: string;
  readonly queryFormatterId: 'query-text-only@1';
  readonly preflightTokenCount: number;
  readonly providerTokenCount: number;
  readonly latencyMs: number;
  readonly dimension: number;
}

interface ActiveCompanyDenseSearchBase {
  readonly scope: ActiveCompanyFilingScope;
  readonly denseProfileId: string;
  readonly denseProfileFingerprint: string;
  readonly topK: number;
}

export type ActiveCompanyDenseSearchResult =
  | ActiveCompanyDenseSearchBase & {
    readonly status: 'scope_empty';
    readonly generations: readonly [];
    readonly candidates: readonly [];
  }
  | ActiveCompanyDenseSearchBase & {
    readonly status: 'dense_not_ready';
    readonly generations: readonly [];
    readonly reasons: readonly [
      { readonly documentId: string; readonly reason: DenseNotReadyReason },
      ...{ readonly documentId: string; readonly reason: DenseNotReadyReason }[],
    ];
    readonly candidates: readonly [];
  }
  | ActiveCompanyDenseSearchBase & {
    readonly status: 'no_matches';
    readonly generations: readonly DenseGenerationProvenance[];
    readonly queryEmbedding: DenseQueryEmbeddingProvenance;
    readonly candidates: readonly [];
  }
  | ActiveCompanyDenseSearchBase & {
    readonly status: 'matched';
    readonly generations: readonly DenseGenerationProvenance[];
    readonly queryEmbedding: DenseQueryEmbeddingProvenance;
    readonly candidates: readonly [FilingDenseCandidate, ...FilingDenseCandidate[]];
  };
