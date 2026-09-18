import { ActiveCompanyFilingScope } from '../activeScope/contracts.js';
import { ActiveFilingScopeService } from '../activeScope/activeFilingScopeService.js';
import { FilingLexicalRepository } from '../lexical/filingLexicalRepository.js';
import { lexicalizeText } from '../lexical/lexicalNormalizer.js';
import { FILING_LEXICAL_BOUNDS, FILING_LEXICAL_PROFILE } from '../lexical/profile.js';
import {
  ActiveCompanyLexicalSearchResult,
  SearchActiveCompanyFilingsLexicallyInput,
} from './contracts.js';
import { ActiveCompanyLexicalSearchError } from './errors.js';
import { assertTrustedScopeBinding, hasInjectedAuthority, UTF8_RETRIEVAL_SCOPE_BINDING,
  VerifiedRetrievalScopeBinding } from './scopeBinding.js';

const CORP_CODE = /^\d{8}$/u;
const SYMBOL = /^\d{6}$/u;

type ActiveScopeResolver = Pick<ActiveFilingScopeService, 'resolveCompany'>;
type LexicalRetriever = Pick<FilingLexicalRepository, 'retrieveLexicalFilingChunks'>;

function invalidInput(): never {
  throw new ActiveCompanyLexicalSearchError(
    'FILING_ACTIVE_LEXICAL_SEARCH_INVALID_INPUT', false,
  );
}

function scopeIntegrityFailure(): never {
  throw new ActiveCompanyLexicalSearchError(
    'FILING_ACTIVE_LEXICAL_SEARCH_SCOPE_INTEGRITY_FAILURE', false,
  );
}

function validateInput(input: SearchActiveCompanyFilingsLexicallyInput): void {
  const topK = input.topK ?? FILING_LEXICAL_BOUNDS.defaultTopK;
  if (!CORP_CODE.test(input.corpCode) || !SYMBOL.test(input.symbol)
    || !Number.isInteger(topK) || topK < 1 || topK > FILING_LEXICAL_BOUNDS.maximumTopK
    || hasInjectedAuthority(input)) {
    invalidInput();
  }
  lexicalizeText(input.query, { query: true });
}

function validateScope(
  scope: ActiveCompanyFilingScope,
  input: SearchActiveCompanyFilingsLexicallyInput,
  binding: VerifiedRetrievalScopeBinding,
): void {
  const entryDocumentIds = scope.entries.map(entry => entry.documentId);
  const validEmpty = scope.status === 'empty'
    && scope.entries.length === 0 && scope.documentIds.length === 0;
  const validActive = scope.status === 'active'
    && scope.entries.length > 0
    && scope.documentIds.length <= FILING_LEXICAL_BOUNDS.maximumDocumentScope
    && new Set(scope.documentIds).size === scope.documentIds.length
    && scope.documentIds.every((documentId, index) => documentId === entryDocumentIds[index]);
  if (scope.corpCode !== input.corpCode || scope.symbol !== input.symbol
    || scope.retrievalPolicyId !== binding.policyId
    || scope.retrievalPolicyFingerprint !== binding.policyFingerprint
    || (!validEmpty && !validActive)) {
    scopeIntegrityFailure();
  }
}

export class ActiveCompanyLexicalSearchService {
  constructor(
    private readonly activeScope: ActiveScopeResolver,
    private readonly lexical: LexicalRetriever,
    private readonly binding: VerifiedRetrievalScopeBinding = UTF8_RETRIEVAL_SCOPE_BINDING,
  ) { assertTrustedScopeBinding(binding); }

  async search(
    input: SearchActiveCompanyFilingsLexicallyInput,
  ): Promise<ActiveCompanyLexicalSearchResult> {
    validateInput(input);
    const scope = await this.activeScope.resolveCompany({
      corpCode: input.corpCode,
      symbol: input.symbol,
      retrievalPolicyId: this.binding.policyId,
    });
    validateScope(scope, input, this.binding);
    const common = { scope, lexicalProfileId: FILING_LEXICAL_PROFILE.profileId } as const;
    if (scope.documentIds.length === 0) {
      return { ...common, status: 'scope_empty', candidates: [] };
    }
    const candidates = await this.lexical.retrieveLexicalFilingChunks({
      corpCode: input.corpCode,
      symbol: input.symbol,
      documentIds: scope.documentIds,
      query: input.query,
      topK: input.topK,
    });
    if (candidates.length === 0) {
      return { ...common, status: 'no_matches', candidates: [] };
    }
    return {
      ...common,
      status: 'matched',
      candidates: [candidates[0]!, ...candidates.slice(1)],
    };
  }
}
