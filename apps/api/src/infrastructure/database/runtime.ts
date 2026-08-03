import { Pool } from 'pg';

import { AppConfig } from '../../config.js';
import { DatabaseError } from './errors.js';

export type DatabaseReadiness =
  | { readonly status: 'disabled' }
  | { readonly status: 'ready' }
  | {
    readonly status: 'unavailable';
    readonly code: 'DATABASE_UNAVAILABLE' | 'DATABASE_SCHEMA_INCOMPATIBLE';
  };

export interface DatabaseRuntimeLogger {
  error(fields: {
    operation: 'database-pool';
    code: 'DATABASE_UNAVAILABLE';
  }): void;
}

const CORE_RELATIONS = [
  'filing_intelligence.filing_document',
  'filing_intelligence.filing_section',
  'filing_intelligence.filing_block',
  'filing_intelligence.filing_chunk',
  'public.pgmigrations',
] as const;
const CURRENT_MIGRATION_NAME = '1753650000000_canonical-filing-persistence';

export class DatabaseRuntime {
  private pool: Pool | undefined;
  private closePromise: Promise<void> | undefined;
  private logger: DatabaseRuntimeLogger | undefined;

  constructor(private readonly config: AppConfig) {}

  setLogger(logger: DatabaseRuntimeLogger): void {
    this.logger = logger;
  }

  isEnabled(): boolean {
    return this.config.filingPersistenceEnabled;
  }

  getPool(): Pool {
    if (!this.config.filingPersistenceEnabled || !this.config.databaseUrl) {
      throw new DatabaseError('DATABASE_NOT_CONFIGURED', false);
    }
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.config.databaseUrl,
        max: this.config.databasePoolMax,
        connectionTimeoutMillis: this.config.databaseConnectionTimeoutMs,
        idleTimeoutMillis: this.config.databaseIdleTimeoutMs,
        statement_timeout: this.config.databaseStatementTimeoutMs,
        application_name: 'alpha-twin-api',
        ssl: this.config.databaseSslMode === 'verify-full'
          ? { rejectUnauthorized: true }
          : false,
      });
      this.pool.on('error', () => {
        this.logger?.error({
          operation: 'database-pool',
          code: 'DATABASE_UNAVAILABLE',
        });
      });
    }
    return this.pool;
  }

  async probeReadiness(): Promise<DatabaseReadiness> {
    if (!this.config.filingPersistenceEnabled) return { status: 'disabled' };
    try {
      const result = await this.getPool().query<{
        relations: Array<string | null>;
      }>(
        'SELECT ARRAY[to_regclass($1)::text, to_regclass($2)::text, to_regclass($3)::text, to_regclass($4)::text, to_regclass($5)::text] AS relations',
        [...CORE_RELATIONS],
      );
      if (!result.rows[0]?.relations.every(relation => relation != null)) {
        return {
          status: 'unavailable',
          code: 'DATABASE_SCHEMA_INCOMPATIBLE',
        };
      }
      const migration = await this.getPool().query<{ applied: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM public.pgmigrations
           WHERE name = $1
         ) AS applied`,
        [CURRENT_MIGRATION_NAME],
      );
      return migration.rows[0]?.applied
        ? { status: 'ready' }
        : {
          status: 'unavailable',
          code: 'DATABASE_SCHEMA_INCOMPATIBLE',
        };
    } catch {
      return {
        status: 'unavailable',
        code: 'DATABASE_UNAVAILABLE',
      };
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    this.closePromise ??= this.pool.end();
    await this.closePromise;
  }
}
