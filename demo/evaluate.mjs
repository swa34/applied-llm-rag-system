import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validateRuntime } from './config.mjs';
import { compileChecks } from './scenario-checks.mjs';
import { createDemo } from './setup.mjs';
import { heldoutSuitePath, loadEvaluationData } from './dataset.mjs';
import { assertExpectedHeldoutDenominators, EMBEDDING_MODEL, EVALUATION_MODELS, EVALUATION_REPETITIONS,
  estimateUsageCost, scoreFailedTurn, scoreTurn, summarizeRun } from './evaluation.mjs';
import { createFreeze, evaluationRunPath, finalizeJsonArtifact, readExportArtifact, readFreeze,
  reserveJsonArtifact, repositoryRoot, sha256, verifyFreeze, writeJsonExclusive } from './evaluation-freeze.mjs';

const usage = 'Usage:\n' +
  '  npm run eval:freeze -- --output local-exports/phase-6-freeze.json\n' +
  '  npm run eval:heldout -- --freeze local-exports/phase-6-freeze.json --output local-exports/phase-6-<model>-run-<1-3>.json --model <model> --run <1-3>';

export function parseArguments(args) {
  const [mode, ...rest] = args;
  const allowed = mode === 'freeze' ? new Set(['--output']) : mode === 'run'
    ? new Set(['--freeze', '--output', '--model', '--run']) : null;
  if (!allowed || rest.length !== allowed.size * 2) throw new Error(usage);
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index], value = rest[index + 1];
    if (!allowed.has(name) || !value || values[name] !== undefined) throw new Error(usage);
    values[name] = value;
  }
  if ([...allowed].some(name => values[name] === undefined)) throw new Error(usage);
  if (mode === 'run') {
    if (!EVALUATION_MODELS.includes(values['--model'])) throw new Error(`Evaluation model must be one of: ${EVALUATION_MODELS.join(', ')}.`);
    if (!/^[1-9]\d*$/.test(values['--run'])) throw new Error('Evaluation run must be a positive integer.');
    const run = Number(values['--run']);
    if (run > EVALUATION_REPETITIONS || values['--freeze'] !== 'local-exports/phase-6-freeze.json' ||
      values['--output'] !== evaluationRunPath(values['--model'], run)) throw new Error(usage);
  } else if (values['--output'] !== 'local-exports/phase-6-freeze.json') {
    throw new Error(usage);
  }
  return { mode, output: values['--output'], freeze: values['--freeze'], model: values['--model'],
    run: values['--run'] ? Number(values['--run']) : undefined };
}

export function sanitizeErrorMessage(error, secrets = [process.env.OPENAI_API_KEY]) {
  let message = error instanceof Error ? error.message : 'Unknown evaluation error.';
  for (const secret of secrets) if (typeof secret === 'string' && secret) message = message.replaceAll(secret, '[REDACTED]');
  message = message.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500) || 'Unknown evaluation error.';
}

function expectedRecord(test) {
  return {
    status: test.status,
    sourceIds: [...new Set((test.facts ?? []).map(fact => fact.sourceId))],
    manualReviewRequired: Boolean(test.manualReviewReason || test.tags.includes('conflict') ||
      test.tags.includes('untrusted_instruction')),
    manualReviewReason: test.manualReviewReason ?? (test.tags.includes('untrusted_instruction')
      ? 'Review whether document instructions were treated as untrusted evidence rather than authority.' : undefined),
  };
}

export async function executeCases(tests, demo, { stopAfterTurn, logger = message => console.error(message) } = {}) {
  const conversations = new Map();
  const failedConversations = new Set();
  const results = [];
  let globalBlockReason;
  for (const test of tests) {
    const common = {
      id: test.id, conversation: test.conversation, tags: test.tags, turnIndex: test.turnIndex,
      question: test.question, expectedStatus: test.status, expected: expectedRecord(test),
    };
    if (globalBlockReason || failedConversations.has(test.conversation)) {
      const message = globalBlockReason ?? 'An earlier turn in this conversation failed, so this dependent turn was not sent.';
      results.push({ ...common, executionStatus: 'blocked', status: 'blocked', attemptMs: null,
        automatic: scoreFailedTurn(test, 'Blocked', message), error: message });
      logger(`BLOCKED ${test.id}`);
      continue;
    }
    if (!conversations.has(test.conversation)) {
      const stageEvents = [];
      conversations.set(test.conversation, {
        stageEvents,
        conversation: demo.newConversation({ observeStage: event => stageEvents.push(event) }),
      });
    }
    const entry = conversations.get(test.conversation);
    const eventStart = entry.stageEvents.length;
    const priorTurns = structuredClone(entry.conversation.history);
    const started = performance.now();
    try {
      const result = await entry.conversation.send(test.question);
      const automatic = scoreTurn(test, result);
      results.push({ ...common, executionStatus: 'completed', attemptMs: performance.now() - started,
        priorTurns, ...result, stageEvents: entry.stageEvents.slice(eventStart), automatic });
      logger(`${automatic.rubricPassed ? 'PASS' : 'FAIL'} ${test.id}`);
    } catch (error) {
      failedConversations.add(test.conversation);
      const message = sanitizeErrorMessage(error);
      results.push({ ...common, executionStatus: 'error', status: 'error', attemptMs: performance.now() - started,
        priorTurns, stageEvents: entry.stageEvents.slice(eventStart),
        automatic: scoreFailedTurn(test, 'Error', message), error: message });
      logger(`ERROR ${test.id}: ${message}`);
    }
    globalBlockReason = await stopAfterTurn?.(results);
  }
  return results;
}

async function freeze(output) {
  validateRuntime();
  const artifact = await createFreeze();
  const written = await writeJsonExclusive(output, artifact);
  console.error(`Saved frozen evaluation baseline ${output} (sha256 ${written.sha256}).`);
}

function rawArtifactCost(artifact, freeze) {
  let total = estimateUsageCost(artifact.index?.usage, EMBEDDING_MODEL, freeze.pricing);
  for (const result of artifact.results) for (const event of result.stageEvents ?? []) {
    if (!event.usage) continue;
    const model = event.stage === 'queryEmbedding' ? EMBEDDING_MODEL : artifact.requestedModels.generation;
    total += estimateUsageCost(event.usage, model, freeze.pricing);
  }
  return Number(total.toFixed(8));
}

function validatePriorArtifact(artifact, { model, run, freeze, freezeSha256, unknownUsageReserve }) {
  const commonIdentityMatches = artifact.schemaVersion === 1 && artifact.freeze?.sha256 === freezeSha256 &&
    artifact.freeze?.revision === freeze.git.revision;
  if (artifact.kind === 'Raw held-out local RAG evaluation; human semantic review pending') {
    if (!commonIdentityMatches || artifact.requestedModels?.generation !== model ||
      artifact.requestedModels?.embedding !== EMBEDDING_MODEL || artifact.run?.index !== run ||
      artifact.run?.repetitions !== EVALUATION_REPETITIONS || !Array.isArray(artifact.results) ||
      artifact.results.length !== freeze.plannedDenominatorsPerRun.turns) {
      throw new Error('A prior held-out report has inconsistent experiment identity or denominators.');
    }
    const recomputed = rawArtifactCost(artifact, freeze);
    const recorded = Number(artifact.summary?.estimatedCost?.usd);
    if (!Number.isFinite(recorded) || Math.abs(recorded - recomputed) > 1e-8) {
      throw new Error('A prior held-out report has inconsistent usage-cost arithmetic.');
    }
    const unknown = artifact.results.reduce((sum, result) => sum +
      (result.stageEvents ?? []).filter(event => event.status === 'failed' && !event.usage).length, 0);
    if (artifact.summary?.estimatedCost?.usageUnavailableForFailedCalls !== unknown) {
      throw new Error('A prior held-out report has inconsistent failed-call usage accounting.');
    }
    return unknown ? Math.max(recorded, unknownUsageReserve) : recorded;
  }
  if (['Failed immutable held-out evaluation run', 'Reserved immutable held-out evaluation run slot'].includes(artifact.kind) &&
    commonIdentityMatches && artifact.model === model && artifact.run === run) return unknownUsageReserve;
  throw new Error('A prior held-out artifact has an unsupported kind or inconsistent experiment identity.');
}

export async function priorHeldoutCost(freeze, currentOutput, freezeSha256, root = repositoryRoot) {
  let total = freeze.execution.priorDevelopmentEstimatedCostUsd;
  const unknownUsageReserve = freeze.execution.costCeilingUsd /
    (EVALUATION_MODELS.length * EVALUATION_REPETITIONS);
  for (const model of EVALUATION_MODELS) for (let run = 1; run <= EVALUATION_REPETITIONS; run++) {
    const path = evaluationRunPath(model, run);
    if (path === currentOutput) continue;
    try {
      const artifact = JSON.parse(await readExportArtifact(path, root));
      total += validatePriorArtifact(artifact, { model, run, freeze, freezeSha256, unknownUsageReserve });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Cannot validate the Phase 6 cost ledger for ${path}: ${error.message}`);
      }
    }
  }
  return total;
}

function provenance(results, index) {
  const events = results.flatMap(result => result.stageEvents ?? []);
  const failures = [];
  for (const event of events) {
    if (!event.returnedModel) failures.push(`Returned model unavailable for ${event.status} ${event.stage} call.`);
    if (!event.startedAt || !event.completedAt) failures.push(`Missing timestamps for ${event.stage}.`);
  }
  if (!index?.model) failures.push('Missing returned model for corpus embedding.');
  if (!index?.startedAt || !index?.completedAt) failures.push('Missing timestamps for corpus embedding.');
  return { complete: failures.length === 0, failures };
}

async function run(options) {
  validateRuntime();
  if (options.output !== evaluationRunPath(options.model, options.run)) throw new Error(usage);
  const frozen = await readFreeze(options.freeze);
  await verifyFreeze(frozen.value);

  const { dataset, heldout } = await loadEvaluationData();
  if (heldout.split !== 'heldout') throw new Error('The dedicated evaluation runner requires the held-out split.');
  const denominators = assertExpectedHeldoutDenominators(heldout);
  if (JSON.stringify(denominators) !== JSON.stringify(frozen.value.plannedDenominatorsPerRun)) {
    throw new Error('Held-out suite denominators do not match the frozen baseline.');
  }
  const tests = compileChecks(heldout, dataset);
  const priorCostUsd = await priorHeldoutCost(frozen.value, options.output, frozen.sha256);
  if (priorCostUsd >= frozen.value.execution.costCeilingUsd) throw new Error('Phase 6 API cost ceiling has been reached.');
  const reservation = await reserveJsonArtifact(options.output, {
    schemaVersion: 1, kind: 'Reserved immutable held-out evaluation run slot',
    reservedAt: new Date().toISOString(), model: options.model, run: options.run,
    freeze: { path: options.freeze, sha256: frozen.sha256, revision: frozen.value.git.revision },
  });
  process.env.DEMO_MODEL = options.model;
  process.env.DEMO_EMBED_MODEL = frozen.value.execution.embeddingModel;

  const startedAt = new Date().toISOString();
  try {
    const demo = await createDemo();
    const results = await executeCases(tests, demo, { stopAfterTurn: completed => {
      const partial = summarizeRun({ results: completed, index: demo.retriever.diagnostics,
        generationModel: options.model, embeddingModel: frozen.value.execution.embeddingModel,
        pricing: frozen.value.pricing });
      const attempted = completed.filter(result => result.executionStatus !== 'blocked').length;
      const variableCost = Math.max(0, partial.estimatedCost.usd -
        (demo.retriever.diagnostics.usage ? summarizeRun({ results: [], index: demo.retriever.diagnostics,
          generationModel: options.model, embeddingModel: frozen.value.execution.embeddingModel,
          pricing: frozen.value.pricing }).estimatedCost.usd : 0));
      const unknownUsageReserve = frozen.value.execution.costCeilingUsd /
        (EVALUATION_MODELS.length * EVALUATION_REPETITIONS);
      const accountedPartialCost = partial.estimatedCost.usageUnavailableForFailedCalls
        ? Math.max(partial.estimatedCost.usd, unknownUsageReserve) : partial.estimatedCost.usd;
      const projected = priorCostUsd + accountedPartialCost +
        (attempted ? variableCost / attempted * (tests.length - completed.length) : 0);
      return projected >= frozen.value.execution.costCeilingUsd
        ? 'Remaining turns were not sent because observed usage projected above the Phase 6 API cost ceiling.' : undefined;
    } });

    const suiteSource = await readFile(heldoutSuitePath);
    const report = {
      schemaVersion: 1,
      kind: 'Raw held-out local RAG evaluation; human semantic review pending',
      startedAt,
      completedAt: new Date().toISOString(),
      freeze: { path: options.freeze, sha256: frozen.sha256, revision: frozen.value.git.revision },
      run: { index: options.run, repetitions: EVALUATION_REPETITIONS },
      budget: { ceilingUsd: frozen.value.execution.costCeilingUsd, priorPhaseEstimatedCostUsd: priorCostUsd },
      requestedModels: { generation: options.model, embedding: frozen.value.execution.embeddingModel },
      returnedModels: {
        resolution: [...new Set(results.flatMap(result => result.stageEvents ?? [])
          .filter(event => event.stage === 'resolution').map(event => event.returnedModel).filter(Boolean))],
        answer: [...new Set(results.flatMap(result => result.stageEvents ?? [])
          .filter(event => event.stage === 'answer').map(event => event.returnedModel).filter(Boolean))],
        queryEmbedding: [...new Set(results.flatMap(result => result.stageEvents ?? [])
          .filter(event => event.stage === 'queryEmbedding').map(event => event.returnedModel).filter(Boolean))],
        corpusEmbedding: demo.retriever.diagnostics.model,
      },
      provenance: provenance(results, demo.retriever.diagnostics),
      dataset: { id: dataset.manifest.corpusId, version: dataset.manifest.corpusVersion,
        manifestSha256: dataset.manifestSha256 },
      suite: { id: heldout.suiteId, version: heldout.suiteVersion, split: heldout.split,
        sha256: sha256(suiteSource) },
      retrieval: frozen.value.retrieval,
      index: demo.retriever.diagnostics,
      summary: null,
      results,
    };
    report.summary = summarizeRun({ results, index: report.index, generationModel: options.model,
      embeddingModel: frozen.value.execution.embeddingModel, pricing: frozen.value.pricing });
    const written = await finalizeJsonArtifact(reservation, report);
    console.error(`Saved ${options.output} (sha256 ${written.sha256}; ` +
      `${report.summary.automatedRubric.numerator}/${report.summary.automatedRubric.denominator} automated rubric checks).`);
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    await finalizeJsonArtifact(reservation, {
      schemaVersion: 1, kind: 'Failed immutable held-out evaluation run', startedAt,
      completedAt: new Date().toISOString(), model: options.model, run: options.run,
      freeze: { path: options.freeze, sha256: frozen.sha256, revision: frozen.value.git.revision },
      error: message,
    });
    throw new Error(`${message} The failed run slot was preserved and will not be retried.`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.mode === 'freeze') await freeze(options.output);
  else await run(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
