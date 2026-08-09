import { CurrentEffectiveReceiptResolution, ResolveFamilyInput } from './contracts.js';
import { VerifiedFilingGraphRepository } from './graphRepository.js';
import { resolveFamilyNotFound, resolveVerifiedFamilyGraph } from './resolver.js';

export class FilingResolutionService {
  constructor(private readonly graphs: VerifiedFilingGraphRepository) {}

  async resolveCurrentEffectiveReceiptCandidate(
    input: ResolveFamilyInput,
  ): Promise<CurrentEffectiveReceiptResolution> {
    const loaded = await this.graphs.load(input);
    return loaded.snapshot == null
      ? resolveFamilyNotFound(input, loaded.databaseNow)
      : resolveVerifiedFamilyGraph(loaded.snapshot);
  }
}
