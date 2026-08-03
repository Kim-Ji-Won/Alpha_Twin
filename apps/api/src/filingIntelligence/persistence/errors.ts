export type FilingPersistenceErrorCode =
  | 'FILING_PERSISTENCE_INVALID_INPUT'
  | 'FILING_PERSISTENCE_CONFLICT'
  | 'FILING_PERSISTENCE_INTEGRITY_FAILURE'
  | 'FILING_PERSISTENCE_TRANSACTION_FAILED';

export class FilingPersistenceError extends Error {
  constructor(
    readonly code: FilingPersistenceErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(safeMessage(code), options);
    this.name = 'FilingPersistenceError';
  }
}

function safeMessage(code: FilingPersistenceErrorCode): string {
  switch (code) {
    case 'FILING_PERSISTENCE_INVALID_INPUT':
      return 'The canonical filing persistence input is invalid';
    case 'FILING_PERSISTENCE_CONFLICT':
      return 'The canonical filing identity conflicts with stored content';
    case 'FILING_PERSISTENCE_INTEGRITY_FAILURE':
      return 'The canonical filing persistence integrity check failed';
    case 'FILING_PERSISTENCE_TRANSACTION_FAILED':
      return 'The canonical filing persistence transaction failed';
  }
}
