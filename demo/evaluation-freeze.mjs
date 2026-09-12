import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExpectedHeldoutDenominators, EMBEDDING_MODEL, EVALUATION_MODELS,
  EVALUATION_REPETITIONS, estimateUsageCost, PRICING } from './evaluation.mjs';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

const fixedArtifacts = [
  '.nvmrc', 'package.json',
  'demo/chat.mjs', 'demo/config.mjs', 'demo/dataset.mjs', 'demo/evaluate.mjs',
  'demo/evaluation-freeze.mjs', 'demo/evaluation.mjs', 'demo/provider.mjs',
  'demo/retrieval.mjs', 'demo/scenario-checks.mjs', 'demo/scenarios.mjs', 'demo/setup.mjs',
  'evaluation/fictional/v1/development.json', 'evaluation/fictional/v1/heldout.json',
  'sample-data/fictional/v1/corpus.json',
];

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const developmentReportPaths = {
  'gpt-5.6-terra': 'local-exports/phase-6-development-terra.json',
  'gpt-5.6-luna': 'local-exports/phase-6-development-luna.json',
};

function git(args, root) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

async function artifactPaths(root) {
  const corpus = JSON.parse(await readFile(resolve(root, 'sample-data/fictional/v1/corpus.json'), 'utf8'));
  return [...new Set([...fixedArtifacts,
    ...corpus.documents.map(document => `sample-data/fictional/v1/${document.file}`)])].sort();
}

function developmentCost(report) {
  let cost = estimateUsageCost(report.index?.usage, EMBEDDING_MODEL);
  for (const result of report.results ?? []) {
    cost += estimateUsageCost(result.usage?.resolution, report.model);
    cost += estimateUsageCost(result.usage?.embedding, EMBEDDING_MODEL);
    cost += estimateUsageCost(result.usage?.answer, report.model);
  }
  const usageUnavailableForFailedTurns = (report.results ?? []).filter(result => !result.passed && !result.usage).length;
  const conservativeCost = usageUnavailableForFailedTurns
    ? Math.max(cost, 2 / (EVALUATION_MODELS.length * EVALUATION_REPETITIONS)) : cost;
  return { observedUsageCostUsd: Number(cost.toFixed(8)),
    conservativeCostUsd: Number(conservativeCost.toFixed(8)), usageUnavailableForFailedTurns };
}

async function developmentShakedown(root, expected) {
  return Promise.all(EVALUATION_MODELS.map(async model => {
    const path = developmentReportPaths[model];
    let source;
    try { source = await readFile(resolve(root, path)); }
    catch { throw new Error(`Missing required development shakedown report ${path}.`); }
    let report;
    try { report = JSON.parse(source); } catch { throw new Error(`Development shakedown report ${path} is invalid JSON.`); }
    const actualTurnIds = (report.results ?? []).map(result => result.id);
    if (report.kind !== 'Development live checks; pattern checks do not establish semantic correctness' ||
      report.model !== model || report.embeddingModel !== EMBEDDING_MODEL || report.runtime !== process.version ||
      report.suite?.id !== expected.suite.suiteId || report.suite?.version !== expected.suite.suiteVersion ||
      report.suite?.split !== 'development' || report.suite?.sha256 !== expected.suiteSha256 ||
      report.dataset?.id !== expected.dataset.corpusId || report.dataset?.version !== expected.dataset.corpusVersion ||
      report.dataset?.manifestSha256 !== expected.manifestSha256 ||
      JSON.stringify(actualTurnIds) !== JSON.stringify(expected.turnIds) ||
      report.total !== expected.turnIds.length || report.passed !== (report.results ?? []).filter(result => result.passed).length ||
      report.index?.model !== EMBEDDING_MODEL || !report.index?.usage ||
      report.retrieval?.topK !== 6 || report.retrieval?.rankConstant !== 60 || report.retrieval?.answerCache !== false) {
      throw new Error(`Development shakedown report ${path} does not match the current runtime, dataset, suite, or controls.`);
    }
    return { path, sha256: sha256(source), model, timestamp: report.timestamp,
      baseRevision: report.baseRevision, passed: report.passed, total: report.total, ...developmentCost(report) };
  }));
}

export async function createFreeze({ root = repositoryRoot } = {}) {
  const status = git(['status', '--porcelain', '--untracked-files=normal'], root);
  if (status) throw new Error('Evaluation freeze requires a clean tracked checkout. Commit or remove public changes first.');
  const [heldoutSource, developmentSource, manifestSource] = await Promise.all([
    readFile(resolve(root, 'evaluation/fictional/v1/heldout.json')),
    readFile(resolve(root, 'evaluation/fictional/v1/development.json')),
    readFile(resolve(root, 'sample-data/fictional/v1/corpus.json')),
  ]);
  const heldout = JSON.parse(heldoutSource);
  const development = JSON.parse(developmentSource);
  const manifest = JSON.parse(manifestSource);
  const plannedDenominatorsPerRun = assertExpectedHeldoutDenominators(heldout);
  const artifacts = await Promise.all((await artifactPaths(root)).map(async path => ({
    path, sha256: sha256(await readFile(resolve(root, path))),
  })));
  const shakedown = await developmentShakedown(root, {
    dataset: manifest, manifestSha256: sha256(manifestSource), suite: development,
    suiteSha256: sha256(developmentSource), turnIds: development.cases.flatMap(testCase =>
      testCase.turns.map(turn => turn.id)),
  });
  const priorDevelopmentEstimatedCostUsd = Number(shakedown.reduce((sum, item) =>
    sum + item.conservativeCostUsd, 0).toFixed(8));
  return {
    schemaVersion: 1,
    kind: 'Frozen local RAG held-out evaluation baseline',
    createdAt: new Date().toISOString(),
    git: {
      revision: git(['rev-parse', 'HEAD'], root),
      branch: git(['branch', '--show-current'], root),
      sourceState: 'clean tracked checkout',
    },
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    execution: { models: [...EVALUATION_MODELS], embeddingModel: EMBEDDING_MODEL,
      repetitions: EVALUATION_REPETITIONS, retries: 0, costCeilingUsd: 2,
      priorDevelopmentEstimatedCostUsd },
    retrieval: {
      type: 'local cosine and keyword reciprocal rank fusion',
      lexicalScoring: 'distinct query-term overlap; no IDF or length normalization',
      topK: 6, rankConstant: 60, answerCache: false,
    },
    conversation: { completedTurnHistoryLimit: 6 },
    responses: { store: false, reasoningEffort: 'none', resolverMaxOutputTokens: 512, answerMaxOutputTokens: 4096 },
    dataset: { corpusId: manifest.corpusId, corpusVersion: manifest.corpusVersion,
      developmentSuiteId: development.suiteId, heldoutSuiteId: heldout.suiteId },
    plannedDenominatorsPerRun,
    pricing: structuredClone(PRICING),
    developmentShakedown: shakedown,
    artifacts,
  };
}

function comparable(freeze) {
  const copy = structuredClone(freeze);
  delete copy.createdAt;
  return copy;
}

export function assertFreezeMatches(frozen, current) {
  if (JSON.stringify(comparable(frozen)) !== JSON.stringify(comparable(current))) {
    throw new Error('Evaluation freeze does not match the current revision, runtime, configuration, pricing, or source hashes.');
  }
}

export function assertDeclaredEvaluationControls(frozen) {
  if (JSON.stringify(frozen.execution?.models) !== JSON.stringify(EVALUATION_MODELS) ||
    frozen.execution?.embeddingModel !== EMBEDDING_MODEL ||
    frozen.execution?.repetitions !== EVALUATION_REPETITIONS || frozen.execution?.retries !== 0 ||
    frozen.execution?.costCeilingUsd !== 2) {
    throw new Error('Evaluation freeze contains unapproved model, repetition, retry, or cost controls.');
  }
}

export async function verifyFreeze(frozen, options = {}) {
  assertDeclaredEvaluationControls(frozen);
  const current = await createFreeze(options);
  assertFreezeMatches(frozen, current);
  return current;
}

export async function readFreeze(path, root = repositoryRoot) {
  const source = await readFile(resolveExportPath(path, root));
  let value;
  try { value = JSON.parse(source); } catch { throw new Error('Evaluation freeze is not valid JSON.'); }
  if (value?.schemaVersion !== 1 || value?.kind !== 'Frozen local RAG held-out evaluation baseline') {
    throw new Error('Evaluation freeze has an unsupported schema or kind.');
  }
  return { value, sha256: sha256(source) };
}

export function resolveExportPath(path, root = repositoryRoot) {
  if (typeof path !== 'string' || !path.trim() || isAbsolute(path)) {
    throw new Error('Evaluation artifacts must use a relative path under local-exports/.');
  }
  const exportRoot = resolve(root, 'local-exports');
  const target = resolve(root, path);
  if (target === exportRoot || !target.startsWith(`${exportRoot}${sep}`) || relative(exportRoot, target).startsWith('..')) {
    throw new Error('Evaluation artifacts must use a relative path under local-exports/.');
  }
  return target;
}

export function evaluationRunPath(model, run) {
  return `local-exports/phase-6-${model}-run-${run}.json`;
}

export async function reserveJsonArtifact(path, value, root = repositoryRoot) {
  const target = resolveExportPath(path, root);
  await mkdir(dirname(target), { recursive: true });
  const [realRoot, realParent] = await Promise.all([realpath(root), realpath(dirname(target))]);
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`)) {
    throw new Error('Evaluation artifact directory escapes the repository.');
  }
  const source = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try { handle = await open(target, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Refusing to overwrite existing evaluation artifact ${path}.`);
    throw error;
  }
  try { await handle.writeFile(source); await handle.sync(); }
  catch (error) { await handle.close(); throw error; }
  return { path: target, relativePath: path, handle, sha256: sha256(source) };
}

export async function finalizeJsonArtifact(reservation, value) {
  const source = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await reservation.handle.truncate(0);
    await reservation.handle.write(source, 0, 'utf8');
    await reservation.handle.sync();
  } finally {
    await reservation.handle.close();
  }
  return { path: reservation.path, sha256: sha256(source) };
}

export async function writeJsonExclusive(path, value, root = repositoryRoot) {
  const reservation = await reserveJsonArtifact(path, value, root);
  await reservation.handle.close();
  return { path: reservation.path, sha256: reservation.sha256 };
}
