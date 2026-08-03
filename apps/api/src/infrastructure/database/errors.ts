export type DatabaseErrorCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_UNAVAILABLE'
  | 'DATABASE_SCHEMA_INCOMPATIBLE';

export class DatabaseError extends Error {
  constructor(
    readonly code: DatabaseErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(safeDatabaseMessage(code), options);
    this.name = 'DatabaseError';
  }
}

function safeDatabaseMessage(code: DatabaseErrorCode): string {
  switch (code) {
    case 'DATABASE_NOT_CONFIGURED':
      return 'Filing persistence is not configured';
    case 'DATABASE_SCHEMA_INCOMPATIBLE':
      return 'The filing persistence schema is incompatible';
    case 'DATABASE_UNAVAILABLE':
      return 'The filing persistence database is unavailable';
  }
}
