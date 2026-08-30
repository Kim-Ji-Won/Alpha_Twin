import { ActiveCompanyFilingScope } from '../activeScope/contracts.js';
import { FilingLexicalCandidate } from '../lexical/contracts.js';
import { FILING_LEXICAL_PROFILE } from '../lexical/profile.js';

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
