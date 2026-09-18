import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Pool } from 'pg';

const execFileAsync = promisify(execFile);
const SAFE_TEST_DATABASE_PATTERN = /(?:^|[_-])test(?:$|[_-])/i;

export function requiredTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required for database integration tests');
  }
  const parsed = new URL(value);
  const databaseName = parsed.pathname.slice(1);
  if (!SAFE_TEST_DATABASE_PATTERN.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL must name a dedicated test database');
  }
  return value;
}

export async function runMigrations(
  direction: 'up' | 'down',
  databaseUrl: string,
  includeDense = false,
  includeAdmission = false,
): Promise<void> {
  if (!includeDense || !includeAdmission) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const laterTestMigrations = new Set([
        ...(!includeAdmission ? ['1755468000000_versioned-legacy-retrieval-admission'] : []),
        ...(!includeDense ? ['1755122400000_dense-generation-queue',
          '1754946000000_dense-vector-persistence'] : []),
      ]);
      while (true) {
        const latest = await pool.query<{ name: string }>(
          'SELECT name FROM public.pgmigrations ORDER BY id DESC LIMIT 1',
        );
        if (!laterTestMigrations.has(latest.rows[0]?.name ?? '')) break;
        await execFileAsync('npx', [
          'node-pg-migrate', 'down', '1', '--migrations-dir', 'migrations',
          '--migrations-schema', 'public', '--migrations-table', 'pgmigrations',
          '--single-transaction', '--database-url-var', 'TEST_DATABASE_URL',
        ], {
          cwd: new URL('../../', import.meta.url),
          env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
        });
      }
    } catch (value) {
      if (!(typeof value === 'object' && value !== null && 'code' in value && value.code === '42P01')) throw value;
    } finally {
      await pool.end();
    }
  }
  const args = [
    'node-pg-migrate',
    direction,
    ...(direction === 'down' ? ['1'] : []),
    ...(!includeAdmission && direction === 'up'
      ? ['1755295200000', '--timestamp'] : []),
    '--migrations-dir',
    'migrations',
    '--migrations-schema',
    'public',
    '--migrations-table',
    'pgmigrations',
    '--single-transaction',
    '--database-url-var',
    'TEST_DATABASE_URL',
  ];
  await execFileAsync('npx', args, {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
  });
}

export async function clearPersistence(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE filing_intelligence.filing_ingestion_job, filing_intelligence.filing_receipt CASCADE',
  );
}
