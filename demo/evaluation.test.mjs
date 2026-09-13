import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conversation } from './chat.mjs';
import { loadDevelopmentChecks } from './scenario-checks.mjs';
import { assertExpectedHeldoutDenominators, EVALUATION_COST_CEILING_USD, EVALUATION_MODELS, nearestRank, PRICING,
  scoreFailedTurn, scoreTurn, summarizeRun } from './evaluation.mjs';
import { assertDeclaredEvaluationControls, assertFreezeMatches, finalizeJsonArtifact,
  readExportArtifact, readFreeze, reserveJsonArtifact, resolveExportPath, writeJsonExclusive } from './evaluation-freeze.mjs';
import { executeCases, parseArguments, priorHeldoutCost, sanitizeErrorMessage } from './evaluate.mjs';

test('dedicated evaluation arguments require every explicit held-out control', () => {
  assert.deepEqual(parseArguments(['freeze', '--output', 'local-exports/phase-6-freeze.json']), {
    mode: 'freeze', output: 'local-exports/phase-6-freeze.json', freeze: undefined, model: undefined, run: undefined,
  });
  assert.deepEqual(parseArguments(['run', '--model', 'gpt-5.6-terra', '--run', '2', '--output',
    'local-exports/phase-6-gpt-5.6-terra-run-2.json', '--freeze', 'local-exports/phase-6-freeze.json']), {
    mode: 'run', output: 'local-exports/phase-6-gpt-5.6-terra-run-2.json', freeze: 'local-exports/phase-6-freeze.json',
    model: 'gpt-5.6-terra', run: 2,
  });
  for (const args of [[], ['development'], ['run', '--model', 'other'],
    ['run', '--model', 'gpt-5.6-terra', '--run', '0', '--output', 'x', '--freeze', 'y'],
    ['run', '--model', 'gpt-5.6-terra', '--run', '1', '--output',
      'local-exports/alternate.json', '--freeze', 'local-exports/phase-6-freeze.json'],
    ['freeze', '--output', 'x', '--output', 'y']]) assert.throws(() => parseArguments(args));
});

test('development checks compile without passing rubrics into the demo interface', async () => {
  const { cases: checks } = await loadDevelopmentChecks();
  assert.equal(checks.length, 21);
  assert.equal(checks.filter(check => check.turnIndex > 0).length, 8);
  assert.deepEqual(checks.find(check => check.id === 'dev-studio-injection').tags,
    ['untrusted_instruction']);
  assert.ok(checks.every(check => typeof check.question === 'string' && check.facts.every(fact =>
    fact.patterns.every(pattern => pattern instanceof RegExp))));
});

test('held-out denominator guard is anchored to the approved constants without loading the split', () => {
  const statuses = Array(9).fill('answered').concat('clarify', 'insufficient_evidence');
  let turn = 0, source = 0, answered = 0;
  const suite = { cases: [2, 2, 2, 1, 1, 1, 1, 1].map((count, caseIndex) => ({
    id: `synthetic-${caseIndex}`,
    turns: Array.from({ length: count }, () => {
      const status = statuses[turn++];
      const factCount = status === 'answered' ? (answered++ < 3 ? 2 : 1) : 0;
      return { expected: { status, facts: Array.from({ length: factCount }, () =>
        ({ sourceId: `source-${source++}` })) } };
    }),
  })) };
  assert.deepEqual(assertExpectedHeldoutDenominators(suite), {
    conversations: 8, turns: 11, expectedAnswers: 9, expectedClarifications: 1,
    expectedAbstentions: 1, expectedSourcePairs: 12, followUps: 3,
  });
  suite.cases[0].turns.pop();
  assert.throws(() => assertExpectedHeldoutDenominators(suite), /approved frozen evaluation plan/);
});

test('an execution error blocks only dependent turns and is never retried', async () => {
  const tests = [
    { id: 'first', conversation: 'a', tags: [], turnIndex: 0, question: 'First?', status: 'answered', facts: [] },
    { id: 'dependent', conversation: 'a', tags: [], turnIndex: 1, question: 'Then?', status: 'answered', facts: [] },
    { id: 'independent', conversation: 'b', tags: [], turnIndex: 0, question: 'Other?', status: 'clarify', facts: [] },
  ];
  let sends = 0;
  const secret = 'phase-six-secret-canary';
  const shapedSecret = ['sk', 'example12345678'].join('-');
  const demo = { newConversation: ({ observeStage }) => ({ history: [], send: async question => {
    sends++;
    observeStage({ stage: 'resolution', status: 'completed', startedAt: 'start', completedAt: 'end',
      returnedModel: 'returned-resolver', usage: { input_tokens: 2, output_tokens: 1 } });
    if (question === 'First?') throw new Error(`failure ${secret} ${shapedSecret}\nprivate detail`);
    return { status: 'clarify', answer: 'Which policy?', query: '', claims: [], citations: [], retrieved: [],
      timings: { resolutionMs: 1, retrievalMs: 0, answerMs: 0, totalMs: 1 }, usage: {} };
  } }) };
  const results = await executeCases(tests, demo, { logger: () => {} });
  assert.equal(sends, 2);
  assert.deepEqual(results.map(result => result.executionStatus), ['error', 'blocked', 'completed']);
  assert.match(results[1].error, /not sent/);
  assert.equal(results[0].stageEvents[0].returnedModel, 'returned-resolver');
  assert.doesNotMatch(results[0].error, /sk-example|\n/);
});

test('conversation exposes successful billed stages before a later stage failure', async () => {
  const events = [];
  const conversation = new Conversation({
    provider: {
      resolve: async () => ({ value: { action: 'retrieve', query: 'standalone', clarification: '' },
        usage: { input_tokens: 4, output_tokens: 2 }, model: 'resolver-model' }),
      answer: async () => {
        const error = new Error('answer failed');
        error.responseMetadata = { model: 'failed-answer-model', usage: { input_tokens: 5, output_tokens: 1 } };
        throw error;
      },
    },
    retriever: { retrieve: async () => ({ matches: [], usage: { prompt_tokens: 3 }, model: 'embedding-model' }) },
    observeStage: event => events.push(event),
  });
  await assert.rejects(conversation.send('Question?'), /answer failed/);
  assert.deepEqual(events.map(event => [event.stage, event.status, event.returnedModel]), [
    ['resolution', 'completed', 'resolver-model'],
    ['queryEmbedding', 'completed', 'embedding-model'],
    ['answer', 'failed', 'failed-answer-model'],
  ]);
  assert.deepEqual(events[2].usage, { input_tokens: 5, output_tokens: 1 });
  assert.ok(events.every(event => event.startedAt && event.completedAt && Number.isFinite(event.durationMs)));
  assert.deepEqual(conversation.history, []);
});

test('error sanitization redacts the configured key and generic OpenAI-shaped secrets', () => {
  const shapedSecret = ['sk', 'redaction_canary_1234567890'].join('-');
  const message = sanitizeErrorMessage(new Error(`bad key-canary and ${shapedSecret}\nresponse body`), ['key-canary']);
  assert.equal(message, 'bad [REDACTED] and [REDACTED] response body');
});

test('turn scoring separates retrieval ranks, fixture checks, and structural citations', () => {
  const sources = [
    { id: 'src.one', file: 'one.md', section: 'One', text: 'The limit is five days.' },
    { id: 'src.two', file: 'two.md', section: 'Two', text: 'Approval comes from Finance.' },
  ];
  const testCase = { status: 'answered', facts: [
    { sourceId: 'src.one', section: 'One', patterns: [/five days/iu] },
    { sourceId: 'src.one', section: 'One', patterns: [/limit/iu] },
    { sourceId: 'src.two', section: 'Two', patterns: [/Finance/iu] },
  ], forbidden: [], question: 'What are the rules?' };
  const claims = sources.map(source => ({ text: source.text, sourceId: source.id, quote: source.text }));
  const result = { status: 'answered', answer: claims.map(claim => claim.text).join('\n'), claims,
    citations: sources.map(source => ({ ...source, quotes: [source.text] })),
    retrieved: [sources[0], { id: 'other', text: 'Other.' }, sources[1]], query: 'rules' };
  const scored = scoreTurn(testCase, result);
  assert.deepEqual(scored.retrievalRanks, { 'src.one': 1, 'src.two': 3 });
  assert.equal(scored.expectedSourceCitationCoverage, 2);
  assert.equal(scored.expectedFactPatternCoverage, 2);
  assert.equal(scored.structuralClaimChecks.filter(claim => claim.valid).length, 2);
  assert.equal(scored.rubricPassed, true);
  assert.equal(scoreFailedTurn(testCase, 'Error', 'failed').rubricPassed, false);
});

test('run summary preserves planned denominators, percentiles, usage, and estimated cost', () => {
  const answerTest = { status: 'answered', facts: [
    { sourceId: 'src.one', section: 'One', patterns: [/five/iu] },
    { sourceId: 'src.two', section: 'Two', patterns: [/Finance/iu] },
  ], forbidden: [] };
  const sources = [
    { id: 'src.one', file: 'one.md', section: 'One', text: 'five' },
    { id: 'src.two', file: 'two.md', section: 'Two', text: 'Finance' },
  ];
  const answerResult = { status: 'answered', answer: 'five\nFinance', query: 'rules',
    claims: sources.map(source => ({ text: source.text, sourceId: source.id, quote: source.text })),
    citations: sources.map(source => ({ ...source, quotes: [source.text] })),
    retrieved: [sources[0], { id: 'other', text: 'Other' }, sources[1]],
  };
  const clarifyTest = { status: 'clarify', facts: [], answer: /which/iu, forbidden: [] };
  const clarifyResult = { status: 'clarify', answer: 'Which deadline?', query: '', claims: [], citations: [], retrieved: [] };
  const results = [
    { expectedStatus: 'answered', turnIndex: 0, executionStatus: 'completed', status: 'answered',
      attemptMs: 30, timings: { resolutionMs: 10, retrievalMs: 5, answerMs: 15, totalMs: 30 },
      usage: { resolution: { input_tokens: 100, output_tokens: 10 }, embedding: { prompt_tokens: 5 },
        answer: { input_tokens: 200, output_tokens: 20 } }, ...answerResult,
      automatic: scoreTurn(answerTest, answerResult) },
    { expectedStatus: 'clarify', turnIndex: 1, executionStatus: 'completed', status: 'clarify',
      attemptMs: 12, timings: { resolutionMs: 12, retrievalMs: 0, answerMs: 0, totalMs: 12 },
      usage: { resolution: { input_tokens: 50, output_tokens: 5 } }, ...clarifyResult,
      automatic: { ...scoreTurn(clarifyTest, clarifyResult),
        expectedSourceCitationCoverage: 99, expectedFactPatternCoverage: 99 } },
    { expectedStatus: 'answered', turnIndex: 0, executionStatus: 'error', status: 'error', attemptMs: 7,
      automatic: { ...scoreFailedTurn({ status: 'answered', facts: [
        { sourceId: 'src.three', patterns: [] },
      ] }, 'Error', 'failed'), structuralClaimChecks: [] } },
  ];
  const summary = summarizeRun({ results, index: { embeddingMs: 100, usage: { prompt_tokens: 1000 } },
    generationModel: 'gpt-5.6-terra', pricing: PRICING });
  assert.deepEqual(summary.planned, { turns: 3, expectedAnswers: 2, expectedNonAnswers: 1,
    expectedSourcePairs: 3, followUps: 1 });
  assert.deepEqual(summary.expectedStatus, { numerator: 2, denominator: 3 });
  assert.deepEqual(summary.retrieval.at1, { hit: { numerator: 1, denominator: 2 },
    recall: { numerator: 1, denominator: 3 } });
  assert.deepEqual(summary.retrieval.at3, { hit: { numerator: 1, denominator: 2 },
    recall: { numerator: 2, denominator: 3 } });
  assert.deepEqual(summary.expectedSourceCitationCoverage, { numerator: 2, denominator: 3 });
  assert.deepEqual(summary.expectedFactPatternCoverage, { numerator: 2, denominator: 3 });
  assert.deepEqual(summary.latency.attempt, { n: 3, p50Ms: 12, p95Ms: 30 });
  assert.equal(summary.latency.retrieval.n, 1);
  assert.equal(summary.estimatedCost.usd, 0.0011401);
  assert.deepEqual(summary.humanReview, { status: 'pending' });
  assert.equal(nearestRank([30, 7, 12], 0.5), 12);
  assert.throws(() => nearestRank([1], 0));
});

test('run summary charges usage returned with a failed provider stage', () => {
  const automatic = scoreFailedTurn({ status: 'answered', facts: [] }, 'Error', 'failed');
  const summary = summarizeRun({
    results: [{ expectedStatus: 'answered', turnIndex: 0, executionStatus: 'error', status: 'error',
      attemptMs: 5, automatic, stageEvents: [
        { stage: 'resolution', status: 'completed', usage: { input_tokens: 100, output_tokens: 10 } },
        { stage: 'answer', status: 'failed', usage: { input_tokens: 200, output_tokens: 20 } },
      ] }],
    index: {}, generationModel: 'gpt-5.6-terra', pricing: PRICING,
  });
  assert.deepEqual(summary.usage.resolution, {
    inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, totalTokens: 0,
  });
  assert.deepEqual(summary.usage.answer, {
    inputTokens: 200, cachedInputTokens: 0, outputTokens: 20, totalTokens: 0,
  });
  assert.equal(summary.estimatedCost.usd, 0.00096);
  assert.equal(summary.estimatedCost.usageUnavailableForFailedCalls, 0);
});

test('freeze comparison ignores creation time but detects source or configuration changes', () => {
  const first = { createdAt: 'first', git: { revision: 'abc', branch: 'feature', sourceState: 'clean tracked checkout' },
    execution: { repetitions: 3 }, artifacts: [{ path: 'a', sha256: '1' }] };
  const second = { ...structuredClone(first), createdAt: 'second', git: { ...first.git, branch: '' } };
  assert.doesNotThrow(() => assertFreezeMatches(first, second));
  assert.equal(first.git.branch, 'feature');
  assert.equal(second.git.branch, '');
  second.git.revision = 'def';
  assert.throws(() => assertFreezeMatches(first, second), /does not match/);
  second.git.revision = first.git.revision;
  second.artifacts[0].sha256 = '2';
  assert.throws(() => assertFreezeMatches(first, second), /does not match/);
});

test('declared evaluation controls reject modified model, repetition, retry, and ceiling values', () => {
  const frozen = { execution: { models: [...EVALUATION_MODELS], embeddingModel: 'text-embedding-3-small',
    repetitions: 3, retries: 0, costCeilingUsd: EVALUATION_COST_CEILING_USD } };
  assert.doesNotThrow(() => assertDeclaredEvaluationControls(frozen));
  for (const mutate of [
    value => value.execution.models.push('other'),
    value => { value.execution.repetitions = 4; },
    value => { value.execution.retries = 1; },
    value => { value.execution.costCeilingUsd = EVALUATION_COST_CEILING_USD + 1; },
  ]) {
    const altered = structuredClone(frozen);
    mutate(altered);
    assert.throws(() => assertDeclaredEvaluationControls(altered), /unapproved/);
  }
});

test('evaluation artifacts are confined to local exports and never overwritten', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rag-evaluation-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.throws(() => resolveExportPath('/tmp/result.json', root), /under local-exports/);
  assert.throws(() => resolveExportPath('../result.json', root), /under local-exports/);
  const written = await writeJsonExclusive('local-exports/run.json', { safe: true }, root);
  assert.match(written.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(await readFile(written.path, 'utf8')), { safe: true });
  await assert.rejects(writeJsonExclusive('local-exports/run.json', { safe: false }, root), /Refusing to overwrite/);

  const reservation = await reserveJsonArtifact('local-exports/reserved.json', { reserved: true }, root);
  const finalized = await finalizeJsonArtifact(reservation, { completed: true });
  assert.match(finalized.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(await readFile(finalized.path, 'utf8')), { completed: true });
  await assert.rejects(reserveJsonArtifact('local-exports/reserved.json', {}, root), /Refusing to overwrite/);

  const insideRepository = join(root, 'elsewhere');
  await mkdir(insideRepository);
  await symlink(insideRepository, join(root, 'local-exports', 'internal-redirect'), 'dir');
  await assert.rejects(reserveJsonArtifact('local-exports/internal-redirect/child/run.json', {}, root),
    /escapes local-exports/);
  await assert.rejects(readFile(join(insideRepository, 'child', 'run.json')), error => error.code === 'ENOENT');

  const outsideRepository = await mkdtemp(join(tmpdir(), 'rag-evaluation-outside-'));
  t.after(() => rm(outsideRepository, { recursive: true, force: true }));
  await symlink(outsideRepository, join(root, 'local-exports', 'external-redirect'), 'dir');
  await assert.rejects(reserveJsonArtifact('local-exports/external-redirect/child/run.json', {}, root),
    /escapes local-exports/);
  await assert.rejects(readFile(join(outsideRepository, 'child', 'run.json')), error => error.code === 'ENOENT');

  const linkedFreezeTarget = join(insideRepository, 'freeze.json');
  await writeFile(linkedFreezeTarget, JSON.stringify({ schemaVersion: 1,
    kind: 'Frozen local RAG held-out evaluation baseline' }));
  await symlink(linkedFreezeTarget, join(root, 'local-exports', 'linked-freeze.json'), 'file');
  await assert.rejects(readExportArtifact('local-exports/linked-freeze.json', root), /escapes local-exports/);
  await assert.rejects(readFreeze('local-exports/linked-freeze.json', root), /escapes local-exports/);
  await assert.rejects(writeJsonExclusive('local-exports/linked-freeze.json', {}, root), /Refusing to overwrite/);

  const linkedRoot = await mkdtemp(join(tmpdir(), 'rag-evaluation-linked-root-'));
  t.after(() => rm(linkedRoot, { recursive: true, force: true }));
  await mkdir(join(linkedRoot, 'elsewhere'));
  await symlink(join(linkedRoot, 'elsewhere'), join(linkedRoot, 'local-exports'), 'dir');
  await assert.rejects(writeJsonExclusive('local-exports/run.json', {}, linkedRoot), /physical local-exports/);

  const externalRoot = await mkdtemp(join(tmpdir(), 'rag-evaluation-external-root-'));
  const externalStore = await mkdtemp(join(tmpdir(), 'rag-evaluation-external-store-'));
  t.after(() => Promise.all([rm(externalRoot, { recursive: true, force: true }),
    rm(externalStore, { recursive: true, force: true })]));
  await symlink(externalStore, join(externalRoot, 'local-exports'), 'dir');
  await assert.rejects(writeJsonExclusive('local-exports/run.json', {}, externalRoot), /physical local-exports/);
});

test('cost ledger reserves a full run share when a prior artifact has unknown billed usage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rag-evaluation-cost-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeJsonExclusive('local-exports/phase-6-gpt-5.6-terra-run-1.json', {
    schemaVersion: 1, kind: 'Failed immutable held-out evaluation run', model: 'gpt-5.6-terra', run: 1,
    freeze: { sha256: 'freeze-hash', revision: 'revision' },
  }, root);
  const freeze = { git: { revision: 'revision' }, pricing: PRICING,
    plannedDenominatorsPerRun: { turns: 11 },
    execution: { priorDevelopmentEstimatedCostUsd: 0.1, costCeilingUsd: EVALUATION_COST_CEILING_USD } };
  const total = await priorHeldoutCost(freeze, 'local-exports/phase-6-gpt-5.6-terra-run-2.json',
    'freeze-hash', root);
  assert.equal(Number(total.toFixed(8)), 0.43333333);

  await writeJsonExclusive('local-exports/phase-6-gpt-5.6-luna-run-1.json', {
    schemaVersion: 1, kind: 'Failed immutable held-out evaluation run', model: 'wrong-model', run: 1,
    freeze: { sha256: 'freeze-hash', revision: 'revision' },
  }, root);
  await assert.rejects(priorHeldoutCost(freeze, 'local-exports/phase-6-gpt-5.6-terra-run-2.json',
    'freeze-hash', root), /inconsistent experiment identity/);
});
