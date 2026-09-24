import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { bootstrapBenchmarkMarker } from '../evaluation/filingDense/bootstrapBenchmarkMarker.js';
import { verifyBenchmarkTarget, isTrustedBenchmarkTarget } from '../evaluation/filingDense/verifyBenchmarkTarget.js';
import { benchmarkTargetRejection, createBenchmarkClient, BOOTSTRAP_OPT_IN, VERIFY_OPT_IN } from '../evaluation/filingDense/benchmarkTargetPolicy.js';
import { assertBenchmarkRuntimeIdentity, beginBenchmarkReadOnly } from '../evaluation/filingDense/benchmarkInspection.js';
import { BENCHMARK_IDENTITY, REQUIRED_BENCHMARK_MIGRATIONS } from '../evaluation/filingDense/benchmarkMarkerContract.js';
import { BENCHMARK_MARKER_DDL } from '../evaluation/filingDense/benchmarkMarkerDdl.js';

const url = (host = '127.0.0.1', name = 'alpha_twin_benchmark_test') =>
  `postgresql://synthetic_user:password_SENTINEL@${host}:56442/${name}`;
const approved = () => ({ TEST_DATABASE_URL: url(), NODE_ENV: 'test', [VERIFY_OPT_IN]: '1', [BOOTSTRAP_OPT_IN]: '1' });

function forbiddenRawUrls(): { label: string; value: string }[] {
  const controls = [...Array.from({ length: 32 }, (_, i) => i),
    ...Array.from({ length: 33 }, (_, i) => 0x7f + i)];
  const characters = [...controls.map(code => ({ label: `U+${code.toString(16).padStart(4, '0')}`,
    value: String.fromCharCode(code) })), { label: 'space', value: ' ' },
  { label: 'backslash', value: '\\' }];
  return characters.flatMap(character => [
    { label: `${character.label} prefix`, value: character.value + url() },
    { label: `${character.label} middle`, value: url().slice(0, 18) + character.value + url().slice(18) },
    { label: `${character.label} suffix`, value: url() + character.value },
  ]).concat(['?', '#', '?key=value', '#value', '?key=value#value']
    .map(suffix => ({ label: `delimiter ${suffix}`, value: url() + suffix })));
}

test('raw URL policy rejects forbidden input before invoking the URL parser', async t => {
  const NativeURL = URL;
  let parserCalls = 0;
  t.mock.method(globalThis, 'URL', class extends NativeURL {
    constructor(input: string | URL, base?: string | URL) {
      parserCalls++;
      super(input, base);
    }
  });
  for (const intent of ['verify', 'bootstrap'] as const) await t.test(intent, () => {
    parserCalls = 0;
    assert.equal(benchmarkTargetRejection(intent, approved()), null);
    assert.equal(parserCalls, 1);
    parserCalls = 0;
    for (const { label, value } of forbiddenRawUrls()) {
      assert.equal(benchmarkTargetRejection(intent, { ...approved(), TEST_DATABASE_URL: value }),
        'BENCHMARK_TARGET_INVALID', label);
    }
    assert.equal(parserCalls, 0);
    // Encoded credential characters are not raw query/fragment delimiters.
    assert.equal(benchmarkTargetRejection(intent, { ...approved(),
      TEST_DATABASE_URL: url().replace('synthetic_user', 'synthetic%3F%23user') }), null);
  });
});

test('raw URL rejections reach client factory and both entry points without any connection', async t => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  let connects = 0;
  t.mock.method(Client.prototype, 'connect', async () => { connects++; throw new Error('unexpected connection'); });
  for (const { value } of forbiddenRawUrls()) {
    process.env = { ...original, ...approved(), TEST_DATABASE_URL: value };
    for (const intent of ['verify', 'bootstrap'] as const) {
      assert.throws(() => createBenchmarkClient(intent), { message: 'BENCHMARK_TARGET_INVALID' });
    }
    assert.deepEqual(await verifyBenchmarkTarget(), { status: 'BENCHMARK_TARGET_INVALID' });
    assert.deepEqual(await bootstrapBenchmarkMarker(), { status: 'BENCHMARK_TARGET_INVALID' });
  }
  assert.equal(connects, 0);
});

test('benchmark static policy exact allowlist and intent gates', async t => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) await t.test(`allows ${host}`, () => {
    assert.equal(benchmarkTargetRejection('verify', { ...approved(), TEST_DATABASE_URL: url(host) }), null);
  });
  for (const host of ['example.com', 'localhost.example.com', '127.0.0.1.example.com',
    '0.0.0.0', '10.0.0.1', '172.16.0.1', '192.168.1.1', '8.8.8.8', '%2Ftmp']) {
    await t.test(`rejects ${host}`, () => assert.notEqual(
      benchmarkTargetRejection('verify', { ...approved(), TEST_DATABASE_URL: url(host) }), null));
  }
  for (const value of ['', 'true', 'yes', '01', ' 1', '1 ']) await t.test(`exact opt-in ${JSON.stringify(value)}`, () => {
    assert.equal(benchmarkTargetRejection('verify', { ...approved(), [VERIFY_OPT_IN]: value }), 'BENCHMARK_VERIFY_OPT_IN_REQUIRED');
    assert.equal(benchmarkTargetRejection('bootstrap', { ...approved(), [BOOTSTRAP_OPT_IN]: value }), 'BOOTSTRAP_OPT_IN_REQUIRED');
  });
  for (const connection of ['invalid_SENTINEL', url() + '?password=query_SENTINEL', url() + '#secret',
    url().replace('postgresql:', 'https:'), url().replace('/alpha_twin_benchmark_test', '/'),
    url('127.0.0.1', 'other_test'), url().replace('synthetic_user', '%00'), url() + ' ']) {
    await t.test('rejects malformed or unsupported URL without secret diagnostic', () => {
      const result = benchmarkTargetRejection('verify', { ...approved(), TEST_DATABASE_URL: connection });
      assert.ok(result);
      assert.ok(!JSON.stringify(result).includes('SENTINEL'));
    });
  }
  assert.equal(benchmarkTargetRejection('verify', { ...approved(), NODE_ENV: 'production' }), 'BENCHMARK_PRODUCTION_ENVIRONMENT');
  assert.equal(benchmarkTargetRejection('verify', { ...approved(), TEST_DATABASE_URL: undefined, DATABASE_URL: url() }), 'BENCHMARK_TARGET_INVALID');
});

test('both public entry points reject unsafe input before driver connect and redact driver errors', async t => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  let connects = 0;
  t.mock.method(Client.prototype, 'connect', async () => { connects++; throw new Error('password_SENTINEL query_SENTINEL synthetic_user'); });
  t.mock.method(Client.prototype, 'query', async () => { throw new Error('password_SENTINEL'); });
  t.mock.method(Client.prototype, 'end', async () => {});
  const logs: unknown[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => { logs.push(args); });
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  for (const change of [
    { TEST_DATABASE_URL: url('example.com') }, { TEST_DATABASE_URL: url('10.0.0.1') },
    { TEST_DATABASE_URL: url('127.0.0.1', 'other_test') }, { NODE_ENV: 'production' },
    { [VERIFY_OPT_IN]: '', [BOOTSTRAP_OPT_IN]: '' }, { TEST_DATABASE_URL: url() + '?secret=query_SENTINEL' },
  ]) {
    process.env = { ...original, ...approved(), ...change };
    for (const action of [verifyBenchmarkTarget, bootstrapBenchmarkMarker]) {
      const result = await action();
      assert.ok(!JSON.stringify(result).includes('SENTINEL'));
    }
  }
  assert.equal(connects, 0);
  process.env = { ...original, ...approved() };
  assert.deepEqual(await verifyBenchmarkTarget(), { status: 'BENCHMARK_CONNECTION_FAILED' });
  assert.deepEqual(await bootstrapBenchmarkMarker(), { status: 'BOOTSTRAP_FAILED' });
  assert.equal(connects, 2);
  assert.deepEqual(logs, []);
});

test('runtime identity and read-only checks fail closed; trusted evidence cannot be fabricated', async () => {
  assert.throws(() => assertBenchmarkRuntimeIdentity('other_test'), /BENCHMARK_RUNTIME_DB_MISMATCH/);
  assertBenchmarkRuntimeIdentity('alpha_twin_benchmark_test');
  const queries: string[] = [];
  const fake = { query: async (sql: string) => {
    queries.push(sql); return { rows: [{ transaction_read_only: 'off' }] };
  } } as unknown as Client;
  await assert.rejects(beginBenchmarkReadOnly(fake), /BENCHMARK_READ_ONLY_NOT_ENFORCED/);
  assert.equal(queries.length, 2);
  assert.equal(isTrustedBenchmarkTarget(Object.freeze({ readOnlyVerified: true, schemaVerified: true })), false);
  assert.equal(isTrustedBenchmarkTarget(null), false);
});

test('bootstrap snapshot ordering and isolation fail closed without a database', async t => {
  const begin = 'BEGIN ISOLATION LEVEL READ COMMITTED';
  for (const scenario of ['success', 'changed fingerprint', 'repeatable read', 'serializable', 'missing isolation',
    'begin failure', 'isolation failure', 'advisory failure', 'relation failure', 'inspection failure'] as const) {
    await t.test(scenario, async t => {
      const original = { ...process.env };
      process.env = { ...original, ...approved() };
      t.after(() => { process.env = original; });
      t.mock.method(Client.prototype, 'connect', async () => {});
      t.mock.method(Client.prototype, 'end', async () => {});
      const queries: string[] = [];
      let locked = false;
      let created = false;
      const relation = { oid: 1, relkind: 'r', relpersistence: 'p', relrowsecurity: false,
        relforcerowsecurity: false, relhasrules: false, triggers: false, inheritance: false };
      t.mock.method(Client.prototype, 'query', async (sql: string) => {
        queries.push(sql);
        if ((scenario === 'begin failure' && sql === begin)
          || (scenario === 'isolation failure' && sql === 'SHOW transaction_isolation')
          || (scenario === 'advisory failure' && sql.includes('pg_advisory_xact_lock'))
          || (scenario === 'relation failure' && sql.startsWith('LOCK TABLE'))
          || (scenario === 'inspection failure' && locked && sql.includes('string_agg'))) {
          throw new Error('synthetic failure');
        }
        if (sql === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: 'on' }] };
        if (sql === 'SHOW transaction_isolation') return { rows: scenario === 'missing isolation' ? [] : [
          { transaction_isolation: ['repeatable read', 'serializable'].includes(scenario) ? scenario : 'read committed' },
        ] };
        if (sql === 'SELECT current_database() AS name') return { rows: [{ name: BENCHMARK_IDENTITY.databaseName }] };
        if (sql.startsWith('LOCK TABLE')) { locked = true; return { rows: [] }; }
        if (sql === BENCHMARK_MARKER_DDL) { created = true; return { rows: [] }; }
        if (sql.includes('FROM pg_catalog.pg_class')) return {
          rows: sql.includes("c.relname='benchmark_environment_marker'") && !created ? [] : [relation],
        };
        if (sql.includes('FROM pg_catalog.pg_attribute')) return { rows: ['marker_id', 'purpose', 'database_name']
          .map(attname => ({ attname, type: 25, attnotnull: true, atthasdef: false,
            attidentity: '', attgenerated: '', attisdropped: false })) };
        if (sql.includes('FROM pg_catalog.pg_constraint')) return { rows: [
          ['benchmark_environment_marker_pkey', 'PRIMARY KEY (marker_id)'],
          ['benchmark_marker_id_check', `CHECK ((marker_id = '${BENCHMARK_IDENTITY.markerId}'::text))`],
          ['benchmark_marker_purpose_check', `CHECK ((purpose = '${BENCHMARK_IDENTITY.purpose}'::text))`],
          ['benchmark_marker_database_check', `CHECK ((database_name = '${BENCHMARK_IDENTITY.databaseName}'::text))`],
        ].map(([conname, definition]) => ({ conname, definition, convalidated: true, condeferrable: false })) };
        if (sql.includes('FROM public.benchmark_environment_marker LIMIT 2')) return { rows: [{
          marker_id: BENCHMARK_IDENTITY.markerId, purpose: BENCHMARK_IDENTITY.purpose,
          database_name: BENCHMARK_IDENTITY.databaseName,
        }] };
        if (sql.startsWith('SELECT name FROM public.pgmigrations')) return {
          rows: REQUIRED_BENCHMARK_MIGRATIONS.map(name => ({ name })),
        };
        if (sql.includes('string_agg')) return { rows: [{ count: 1,
          fingerprint: locked && scenario === 'changed fingerprint' ? 'changed' : 'original' }] };
        if (sql.startsWith('BEGIN') || sql.includes('pg_advisory_xact_lock')
          || sql.startsWith('INSERT INTO public.benchmark_environment_marker')
          || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
        assert.fail('Unexpected SQL in bootstrap fixture');
      });
      const result = await bootstrapBenchmarkMarker();
      const expected = scenario === 'success' ? 'BOOTSTRAPPED'
        : scenario === 'changed fingerprint' ? 'BOOTSTRAP_CORPUS_IDENTITY_INSUFFICIENT'
          : scenario === 'inspection failure' ? 'BOOTSTRAP_SCHEMA_INCOMPATIBLE' : 'BOOTSTRAP_FAILED';
      assert.equal(result.status, expected);
      assert.ok(queries.includes(begin));
      assert.equal(queries.includes('BEGIN'), false);
      assert.equal(queries.at(-1), 'ROLLBACK');
      if (scenario !== 'success') {
        assert.equal(created, false);
        assert.equal(queries.some(q => q.startsWith('INSERT INTO')), false);
        assert.equal(queries.includes('COMMIT'), false);
      }
      if (['repeatable read', 'serializable', 'missing isolation', 'begin failure', 'isolation failure'].includes(scenario)) {
        assert.equal(queries.some(q => q.includes('pg_advisory_xact_lock')), false);
        assert.equal(locked, false);
      }
      if (scenario === 'success' || scenario === 'changed fingerprint') {
        const b = queries.indexOf(begin);
        const isolation = queries.indexOf('SHOW transaction_isolation');
        const advisory = queries.findIndex(q => q.includes('pg_advisory_xact_lock'));
        const lock = queries.findIndex(q => q.startsWith('LOCK TABLE'));
        const inspections = queries.map((q, i) => q.includes('string_agg') ? i : -1).filter(i => i >= 0);
        assert.ok(b < isolation && isolation < advisory && advisory < lock);
        assert.ok(queries[lock]?.endsWith('IN SHARE MODE'));
        assert.equal(inspections.length, 20);
        assert.ok(inspections[9]! < b && inspections[10]! > lock);
        if (scenario === 'success') {
          const marker = queries.findIndex((q, i) => i > inspections[19]! && q.includes("c.relname='benchmark_environment_marker'"));
          const ddl = queries.indexOf(BENCHMARK_MARKER_DDL);
          const insert = queries.findIndex(q => q.startsWith('INSERT INTO public.benchmark_environment_marker'));
          assert.ok(inspections[19]! < marker && marker < ddl && ddl < insert && insert < queries.indexOf('COMMIT'));
        }
      }
    });
  }
});
