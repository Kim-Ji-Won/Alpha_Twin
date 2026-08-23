import { ResolutionStatus } from '../resolution/contracts.js';

export type ActivationResolutionAction = 'evaluate' | 'deactivate' | 'retain' | 'invalid';

const ACTIONS: Readonly<Record<ResolutionStatus, ActivationResolutionAction>> = Object.freeze({
  resolved: 'evaluate',
  manual_selected: 'evaluate',
  manual_hold: 'deactivate',
  terminal_legally_ineligible: 'deactivate',
  graph_incomplete: 'retain',
  ambiguous_terminal_branch: 'retain',
  legal_status_unresolved: 'retain',
  lineage_status_ineligible: 'retain',
  family_not_found: 'invalid',
});

export function activationActionFor(status: ResolutionStatus): ActivationResolutionAction {
  return ACTIONS[status];
}
