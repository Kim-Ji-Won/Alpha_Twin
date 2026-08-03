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
): Promise<void> {
  const args = [
    'node-pg-migrate',
    direction,
    ...(direction === 'down' ? ['1'] : []),
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
  await pool.query('TRUNCATE filing_intelligence.filing_document CASCADE');
}
