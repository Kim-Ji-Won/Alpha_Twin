import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { DatabaseError } from '../src/infrastructure/database/errors.js';
import { DatabaseRuntime } from '../src/infrastructure/database/runtime.js';

test('filing persistence is disabled by default without creating a pool', async () => {
  const runtime = new DatabaseRuntime(loadConfig({ LOG_LEVEL: 'silent' }));
  assert.equal(runtime.isEnabled(), false);
  assert.deepEqual(await runtime.probeReadiness(), { status: 'disabled' });
  assert.throws(
    () => runtime.getPool(),
    (error: unknown) =>
      error instanceof DatabaseError
      && error.code === 'DATABASE_NOT_CONFIGURED'
      && error.retryable === false,
  );
  await runtime.close();
});

test('enabled filing persistence requires a server-only database URL', () => {
  assert.throws(
    () => loadConfig({
      LOG_LEVEL: 'silent',
      FILING_PERSISTENCE_ENABLED: 'true',
    }),
    (error: unknown) =>
      error instanceof Error
      && error.message ===
        'DATABASE_URL is required when FILING_PERSISTENCE_ENABLED is true',
  );
});

test('database numeric settings are bounded and TLS policy fails closed', () => {
  const config = loadConfig({
    LOG_LEVEL: 'silent',
    DATABASE_POOL_MAX: '0',
    DATABASE_CONNECTION_TIMEOUT_MS: 'NaN',
    DATABASE_IDLE_TIMEOUT_MS: '999999999',
    DATABASE_STATEMENT_TIMEOUT_MS: '-1',
  });
  assert.equal(config.databasePoolMax, 4);
  assert.equal(config.databaseConnectionTimeoutMs, 5_000);
  assert.equal(config.databaseIdleTimeoutMs, 30_000);
  assert.equal(config.databaseStatementTimeoutMs, 60_000);
  assert.throws(
    () => loadConfig({ DATABASE_SSL_MODE: 'require' }),
    /DATABASE_SSL_MODE must be one of disable, verify-full/,
  );
  assert.throws(
    () => loadConfig({ FILING_PERSISTENCE_ENABLED: 'yes' }),
    /FILING_PERSISTENCE_ENABLED must be true or false/,
  );
});

test('unavailable database readiness is safe and does not expose its URL', async () => {
  const secretUrl = 'postgresql://private:must-not-appear@127.0.0.1:1/missing';
  const runtime = new DatabaseRuntime(loadConfig({
    LOG_LEVEL: 'silent',
    FILING_PERSISTENCE_ENABLED: 'true',
    DATABASE_URL: secretUrl,
    DATABASE_CONNECTION_TIMEOUT_MS: '250',
  }));
  const readiness = await runtime.probeReadiness();
  assert.deepEqual(readiness, {
    status: 'unavailable',
    code: 'DATABASE_UNAVAILABLE',
  });
  assert.doesNotMatch(JSON.stringify(readiness), /private|must-not-appear/);
  await runtime.close();
});
