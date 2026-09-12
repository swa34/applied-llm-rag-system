import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, validateRuntime } from './config.mjs';
import { OpenAIProvider } from './provider.mjs';

const pinnedVersion = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();

test('runtime accepts the pinned release and later patches in its major only', () => {
  const [major, minor, patch] = pinnedVersion.split('.').map(Number);
  for (const version of [pinnedVersion, `${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`]) {
    assert.doesNotThrow(() => validateRuntime(version));
  }
  for (const version of ['22.9.0', `${major}.${minor - 1}.0`, `${major + 1}.0.0`, `${pinnedVersion}-rc.1`, 'invalid']) {
    assert.throws(() => validateRuntime(version), /Use Node.js .* from .nvmrc/);
  }
});

test('configuration defaults only omitted model settings and preserves explicit overrides', () => {
  assert.deepEqual(readConfig({ OPENAI_API_KEY: 'test-only-key' }), {
    apiKey: 'test-only-key', model: 'gpt-5.6-terra', embeddingModel: 'text-embedding-3-small',
  });
  assert.deepEqual(readConfig({ OPENAI_API_KEY: 'test-only-key', DEMO_MODEL: 'fake-model', DEMO_EMBED_MODEL: 'fake-embed' }), {
    apiKey: 'test-only-key', model: 'fake-model', embeddingModel: 'fake-embed',
  });
});

test('invalid settings fail before any provider call and never echo their values', () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Unexpected network call'); };
  for (const apiKey of ['', '   ', 'private key', 'private-key\n']) {
    assert.throws(() => new OpenAIProvider({ apiKey, fetchImpl }), /OPENAI_API_KEY (?:is required|must not contain whitespace)/);
  }
  for (const [option, setting] of [['model', 'DEMO_MODEL'], ['embeddingModel', 'DEMO_EMBED_MODEL']]) {
    for (const value of ['', ' ', 'private model', 'private-model\n', null, 123]) {
      assert.throws(() => new OpenAIProvider({ apiKey: 'test-only-key', [option]: value, fetchImpl }), {
        message: `${setting} must be a nonempty model identifier without whitespace; unset it to use the default.`,
      });
    }
  }
  assert.equal(calls, 0);
});

function check(args, env = {}) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check.mjs', import.meta.url)), ...args], {
    encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, ...env },
  });
  assert.ifError(result.error);
  return result;
}

test('offline preflight runs without credentials and configuration preflight rejects missing key', () => {
  const offline = check([]);
  assert.equal(offline.status, 0, offline.stderr);
  assert.match(offline.stdout, /Runtime and fictional corpus OK: \d+ passages/);
  const missing = check(['--config']);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /OPENAI_API_KEY is required/);
});

test('configuration preflight accepts a fake key without contacting the provider or printing settings', () => {
  const result = check(['--config'], { OPENAI_API_KEY: 'test-only-key', DEMO_MODEL: 'fake-model' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /credentials and model access were not checked with the provider/);
  assert.doesNotMatch(result.stdout + result.stderr, /test-only-key|fake-model/);
  const invalid = check(['--config'], { OPENAI_API_KEY: 'test-only-key', DEMO_EMBED_MODEL: 'private model' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /DEMO_EMBED_MODEL must be/);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /test-only-key|private model/);
});

test('invalid preflight arguments report usage and fail', () => {
  const result = check(['--unknown']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: npm run check/);
});

test('missing or unreadable runtime pin produces a clear startup error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rag-runtime-pin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(new URL('./', import.meta.url), join(directory, 'demo'), { recursive: true });
  for (const state of ['missing', 'unreadable']) {
    if (state === 'unreadable') await mkdir(join(directory, '.nvmrc'));
    for (const entrypoint of ['check.mjs', 'cli.mjs', 'scenarios.mjs']) {
      const result = spawnSync(process.execPath, [join(directory, 'demo', entrypoint)], {
        encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, `${state}: ${entrypoint}`);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Cannot read .nvmrc\. Restore the repository root runtime pin and try again\./);
      assert.doesNotMatch(result.stderr, /ENOENT|EISDIR|\n\s+at |file:\/\//);
    }
  }
});
