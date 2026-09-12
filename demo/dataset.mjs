import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocuments } from './retrieval.mjs';

export const datasetDirectory = fileURLToPath(new URL('../sample-data/fictional/v1/', import.meta.url));
export const developmentSuitePath = fileURLToPath(new URL('../evaluation/fictional/v1/development.json', import.meta.url));
export const heldoutSuitePath = fileURLToPath(new URL('../evaluation/fictional/v1/heldout.json', import.meta.url));

const idPattern = /^[a-z][a-z0-9.-]*$/;
const tagPattern = /^[a-z][a-z0-9_]*$/;
const statuses = new Set(['answered', 'clarify', 'insufficient_evidence']);
const splits = new Set(['development', 'heldout']);
const requiredTags = new Set([
  'exact_lookup', 'paraphrase', 'multi_turn_context', 'topic_switch', 'ambiguity',
  'conflict', 'missing_evidence', 'untrusted_instruction',
]);

function fail(message) {
  throw new Error(`Invalid fictional dataset: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a nonempty string.`);
  return value;
}

function id(value, label) {
  nonempty(value, label);
  if (!idPattern.test(value)) fail(`${label} must use lowercase letters, digits, dots, and hyphens.`);
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} must be unique.`);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof SyntaxError ? 'invalid JSON' : error.message}`);
  }
}

async function assertSafeDocument(root, file) {
  nonempty(file, 'document file');
  if (isAbsolute(file) || !file.startsWith('documents/') || !file.endsWith('.md') || file.split(/[\\/]/).includes('..')) {
    fail(`unsafe document path ${file}.`);
  }
  const rootPath = await realpath(root);
  const target = resolve(root, file);
  const targetPath = await realpath(target).catch(() => fail(`missing document ${file}.`));
  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${sep}`)) fail(`document escapes corpus root: ${file}.`);
  const stat = await lstat(target);
  if (!stat.isFile()) fail(`document is not a regular file: ${file}.`);
}

export async function loadDataset(root = datasetDirectory) {
  const manifest = object(await readJson(join(root, 'corpus.json')), 'corpus manifest');
  if (manifest.schemaVersion !== 1) fail('unsupported corpus schemaVersion.');
  id(manifest.corpusId, 'corpusId');
  nonempty(manifest.corpusVersion, 'corpusVersion');
  if (!Array.isArray(manifest.documents) || !manifest.documents.length) fail('documents must be a nonempty array.');

  const documentIds = [], files = [], passageIds = [], passageMap = new Map(), passageToDocument = new Map();
  for (const document of manifest.documents) {
    object(document, 'document');
    documentIds.push(id(document.id, 'document id'));
    files.push(nonempty(document.file, 'document file'));
    await assertSafeDocument(root, document.file);
    if (!Array.isArray(document.passages) || !document.passages.length) fail(`${document.id} passages must be nonempty.`);
    const headings = [];
    for (const passage of document.passages) {
      object(passage, 'passage');
      const sourceId = id(passage.id, 'passage id');
      const heading = nonempty(passage.heading, 'passage heading');
      passageIds.push(sourceId); headings.push(heading);
      passageMap.set(`${document.file}\0${heading}`, sourceId);
      passageToDocument.set(sourceId, document.id);
    }
    unique(headings, `${document.id} passage headings`);
  }
  unique(documentIds, 'document ids');
  unique(files, 'document files');
  unique(passageIds, 'passage ids');

  const chunks = await loadDocuments(root, { files, passageIds: passageMap });
  const loadedIds = chunks.map(chunk => chunk.id);
  unique(loadedIds, 'loaded passage ids');
  if (loadedIds.length !== passageIds.length || passageIds.some(sourceId => !loadedIds.includes(sourceId))) {
    fail('manifest passages must map one-to-one to nonempty document sections no longer than 1,800 characters.');
  }
  return { manifest, chunks, passageToDocument };
}

function compilePattern(pattern, label) {
  nonempty(pattern, label);
  try { new RegExp(pattern, 'iu'); } catch { fail(`${label} is not a valid regular expression.`); }
}

function validateExpected(expected, sourceIds, documentIds, label) {
  object(expected, `${label} expected`);
  if (!statuses.has(expected.status)) fail(`${label} has an unsupported status.`);
  const facts = expected.facts ?? [];
  if (!Array.isArray(facts)) fail(`${label} facts must be an array.`);
  if (expected.status === 'answered' && !facts.length) fail(`${label} answered turns need at least one fact.`);
  if (expected.status !== 'answered' && facts.length) fail(`${label} non-answer turns cannot declare facts.`);
  for (const fact of facts) {
    object(fact, `${label} fact`);
    if (!sourceIds.has(fact.sourceId)) fail(`${label} references unknown source ${fact.sourceId}.`);
    if (!Array.isArray(fact.patterns) || !fact.patterns.length) fail(`${label} fact patterns must be nonempty.`);
    fact.patterns.forEach((pattern, index) => compilePattern(pattern, `${label} fact pattern ${index + 1}`));
  }
  for (const field of ['forbiddenPatterns']) {
    const patterns = expected[field] ?? [];
    if (!Array.isArray(patterns)) fail(`${label} ${field} must be an array.`);
    patterns.forEach((pattern, index) => compilePattern(pattern, `${label} ${field} ${index + 1}`));
  }
  for (const field of ['answerPattern', 'queryPattern']) {
    if (expected[field] !== undefined) compilePattern(expected[field], `${label} ${field}`);
  }
  if (expected.onlyDocumentIds !== undefined && !Array.isArray(expected.onlyDocumentIds)) {
    fail(`${label} onlyDocumentIds must be an array.`);
  }
  for (const documentId of expected.onlyDocumentIds ?? []) {
    if (!documentIds.has(documentId)) fail(`${label} references unknown document ${documentId}.`);
  }
  if (expected.onlySourceIds !== undefined && !Array.isArray(expected.onlySourceIds)) {
    fail(`${label} onlySourceIds must be an array.`);
  }
  for (const sourceId of expected.onlySourceIds ?? []) {
    if (!sourceIds.has(sourceId)) fail(`${label} references unknown allowed source ${sourceId}.`);
  }
  if (expected.status !== 'answered' && (expected.onlyDocumentIds || expected.onlySourceIds || expected.forbiddenPatterns)) {
    fail(`${label} non-answer turns cannot declare answer-source constraints.`);
  }
  if (expected.manualReviewReason !== undefined) nonempty(expected.manualReviewReason, `${label} manualReviewReason`);
}

export async function loadCaseSuite(path, dataset) {
  const suite = object(await readJson(path), 'case suite');
  if (suite.schemaVersion !== 1) fail('unsupported suite schemaVersion.');
  id(suite.suiteId, 'suiteId');
  nonempty(suite.suiteVersion, 'suiteVersion');
  if (!splits.has(suite.split)) fail('suite split must be development or heldout.');
  if (!path.endsWith(`${suite.split}.json`)) fail(`suite split does not match ${path}.`);
  object(suite.corpus, 'suite corpus');
  if (suite.corpus.id !== dataset.manifest.corpusId || suite.corpus.version !== dataset.manifest.corpusVersion) {
    fail(`${suite.suiteId} targets a different corpus id or version.`);
  }
  if (!Array.isArray(suite.cases) || !suite.cases.length) fail(`${suite.suiteId} cases must be nonempty.`);
  const sourceIds = new Set(dataset.chunks.map(chunk => chunk.id));
  const documentIds = new Set(dataset.manifest.documents.map(document => document.id));
  const caseIds = [], turnIds = [];
  for (const testCase of suite.cases) {
    object(testCase, 'case'); caseIds.push(id(testCase.id, 'case id'));
    if (!Array.isArray(testCase.tags) || !testCase.tags.length) fail(`${testCase.id} tags must be nonempty.`);
    testCase.tags.forEach(tag => {
      nonempty(tag, `${testCase.id} tag`);
      if (!tagPattern.test(tag)) fail(`${testCase.id} tags must use lowercase letters, digits, and underscores.`);
    });
    if (!Array.isArray(testCase.turns) || !testCase.turns.length) fail(`${testCase.id} turns must be nonempty.`);
    for (const turn of testCase.turns) {
      object(turn, 'turn'); turnIds.push(id(turn.id, 'turn id'));
      const question = nonempty(turn.question, `${turn.id} question`).trim();
      if (question.length > 2000) fail(`${turn.id} question exceeds 2,000 characters.`);
      validateExpected(turn.expected, sourceIds, documentIds, turn.id);
    }
  }
  unique(caseIds, `${suite.suiteId} case ids`);
  unique(turnIds, `${suite.suiteId} turn ids`);
  const tags = new Set(suite.cases.flatMap(testCase => testCase.tags));
  for (const tag of requiredTags) if (!tags.has(tag)) fail(`${suite.suiteId} is missing required coverage tag ${tag}.`);
  return suite;
}

const normalize = question => question.normalize('NFKC').toLowerCase().replaceAll('’', "'")
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

export function validateSplitIsolation(development, heldout) {
  const devCaseIds = new Set(development.cases.map(testCase => testCase.id));
  const devTurnIds = new Set(development.cases.flatMap(testCase => testCase.turns.map(turn => turn.id)));
  for (const testCase of heldout.cases) if (devCaseIds.has(testCase.id)) fail(`case id appears in both splits: ${testCase.id}.`);
  for (const turn of heldout.cases.flatMap(testCase => testCase.turns)) {
    if (devTurnIds.has(turn.id)) fail(`turn id appears in both splits: ${turn.id}.`);
  }

  const signatures = suite => suite.cases.map(testCase => testCase.turns.map(turn => normalize(turn.question)));
  const devSequences = signatures(development), evalSequences = signatures(heldout);
  const devFirst = new Set(devSequences.map(sequence => sequence[0]));
  for (const sequence of evalSequences) {
    if (devFirst.has(sequence[0])) fail(`normalized first question appears in both splits: ${sequence[0]}.`);
    for (const candidate of devSequences) {
      const shared = Math.min(candidate.length, sequence.length);
      if (candidate.slice(0, shared).every((question, index) => question === sequence[index])) {
        fail('a normalized conversation is duplicated or prefix-equivalent across splits.');
      }
    }
  }
}

export async function loadEvaluationData(root = datasetDirectory, developmentPath = developmentSuitePath,
  heldoutPath = heldoutSuitePath) {
  const dataset = await loadDataset(root);
  const development = await loadCaseSuite(developmentPath, dataset);
  const heldout = await loadCaseSuite(heldoutPath, dataset);
  validateSplitIsolation(development, heldout);
  return { dataset, development, heldout };
}
