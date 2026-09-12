import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDevelopmentChecks } from './scenario-checks.mjs';
import { loadCaseSuite, loadDataset, loadEvaluationData, validateSplitIsolation } from './dataset.mjs';

test('versioned corpus and case splits pass structural validation', async () => {
  const { dataset, development, heldout } = await loadEvaluationData();
  assert.equal(dataset.manifest.corpusId, 'northbridge-fictional');
  assert.equal(dataset.manifest.corpusVersion, '1.0.0');
  assert.equal(dataset.manifest.documents.length, 10);
  assert.equal(dataset.chunks.length, 38);
  assert.equal(development.cases.length, 13);
  assert.equal(heldout.cases.length, 8);
  assert.ok(dataset.chunks.every(chunk => /^src\.[a-z0-9.-]+$/.test(chunk.id)));
  assert.ok(dataset.chunks.every(chunk => chunk.file.startsWith('documents/')));
});

test('the ten tuned smoke scenarios remain development fixtures only', async () => {
  const { development, heldout } = await loadEvaluationData();
  const { cases: smokeCases } = await loadDevelopmentChecks();
  const developmentTurns = new Map(development.cases.flatMap(testCase =>
    testCase.turns.map(turn => [turn.id, turn])));
  const heldoutTurnIds = new Set(heldout.cases.flatMap(testCase => testCase.turns.map(turn => turn.id)));
  const legacyIds = ['travel-direct', 'tuition-direct', 'travel-follow-up', 'tuition-follow-up', 'comparison',
    'ambiguous-follow-up', 'clarification-reply', 'topic-switch', 'missing-evidence', 'missing-antecedent'];
  assert.equal(smokeCases.length, 21);
  for (const smokeCase of smokeCases.filter(item => legacyIds.includes(item.id))) {
    const fixture = developmentTurns.get(smokeCase.id);
    assert.ok(fixture, `${smokeCase.id} is missing from the development manifest.`);
    assert.equal(fixture.question, smokeCase.question);
    assert.equal(fixture.expected.status, smokeCase.status);
    assert.equal(heldoutTurnIds.has(smokeCase.id), false);
  }
  assert.deepEqual(smokeCases.filter(item => legacyIds.includes(item.id)).map(item => item.id).sort(), legacyIds.sort());
});

test('every source-linked criterion is grounded in its labeled passage', async () => {
  const { dataset, development, heldout } = await loadEvaluationData();
  const chunks = new Map(dataset.chunks.map(chunk => [chunk.id, chunk]));
  for (const suite of [development, heldout]) {
    for (const testCase of suite.cases) {
      for (const turn of testCase.turns) {
        for (const fact of turn.expected.facts ?? []) {
          const source = chunks.get(fact.sourceId);
          assert.ok(source, `${turn.id} references missing source ${fact.sourceId}.`);
          for (const pattern of fact.patterns) {
            assert.match(source.text, new RegExp(pattern, 'iu'), `${turn.id} rubric is not present in ${fact.sourceId}.`);
          }
        }
      }
    }
  }
});

test('manifest allowlist excludes unlisted Markdown and keeps stable passage IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rag-versioned-corpus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'documents'));
  const manifest = {
    schemaVersion: 1, corpusId: 'test-corpus', corpusVersion: '1.0.0',
    documents: [{ id: 'doc.policy', file: 'documents/policy.md', passages: [
      { id: 'src.policy.rule', heading: 'Rule' },
    ] }],
  };
  await Promise.all([
    writeFile(join(root, 'corpus.json'), `${JSON.stringify(manifest)}\n`),
    writeFile(join(root, 'documents/policy.md'), '# Rule\nThe allowance is five days.\n'),
    writeFile(join(root, 'documents/rubric.md'), '# Secret rubric\nThis must never be evidence.\n'),
    writeFile(join(root, 'README.md'), '# Dataset notes\nThese are not evidence.\n'),
  ]);
  const first = await loadDataset(root);
  assert.deepEqual(first.chunks.map(chunk => chunk.id), ['src.policy.rule']);
  assert.deepEqual(first.chunks.map(chunk => chunk.file), ['documents/policy.md']);
  await writeFile(join(root, 'documents/policy.md'), '# Rule\nThe allowance is six days.\n');
  assert.deepEqual((await loadDataset(root)).chunks.map(chunk => chunk.id), ['src.policy.rule']);
});

test('split isolation rejects duplicate identities and conversation seeds', async () => {
  const { development, heldout } = await loadEvaluationData();
  const duplicateId = structuredClone(heldout);
  duplicateId.cases[0].id = development.cases[0].id;
  assert.throws(() => validateSplitIsolation(development, duplicateId), /case id appears in both splits/);

  const duplicateQuestion = structuredClone(heldout);
  duplicateQuestion.cases[0].turns[0].question = development.cases[0].turns[0].question.toUpperCase();
  assert.throws(() => validateSplitIsolation(development, duplicateQuestion), /first question appears in both splits/);
});

test('suite validation rejects unsupported statuses, source labels, and patterns', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rag-invalid-suite-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataset = await loadDataset();
  const valid = {
    schemaVersion: 1, suiteId: 'test-development', suiteVersion: '1.0.0', split: 'development',
    corpus: { id: dataset.manifest.corpusId, version: dataset.manifest.corpusVersion },
    cases: [{ id: 'test.case', tags: ['exact_lookup', 'paraphrase', 'multi_turn_context', 'topic_switch',
      'ambiguity', 'conflict', 'missing_evidence', 'untrusted_instruction'], turns: [{
      id: 'test-turn', question: 'What is the rule?', expected: { status: 'answered',
        facts: [{ sourceId: dataset.chunks[0].id, patterns: ['fictional'] }] },
    }] }],
  };
  const path = join(directory, 'development.json');
  for (const mutate of [
    suite => { suite.cases[0].turns[0].expected.status = 'maybe'; },
    suite => { suite.cases[0].turns[0].expected.facts[0].sourceId = 'src.missing'; },
    suite => { suite.cases[0].turns[0].expected.facts[0].patterns = ['[']; },
    suite => { suite.cases[0].turns[0].expected = { status: 'clarify', facts: [{
      sourceId: dataset.chunks[0].id, patterns: ['fictional'],
    }] }; },
  ]) {
    const candidate = structuredClone(valid); mutate(candidate);
    await writeFile(path, `${JSON.stringify(candidate)}\n`);
    await assert.rejects(loadCaseSuite(path, dataset), /Invalid fictional dataset/);
  }
});

test('evaluation rubrics live outside the retrievable corpus tree', async () => {
  const source = await readFile(new URL('../evaluation/fictional/v1/heldout.json', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sample-data\/fictional\/v1\/documents/);
  const { dataset } = await loadEvaluationData();
  assert.ok(dataset.chunks.every(chunk => !/evaluation|rubric|README/i.test(chunk.file)));
});
