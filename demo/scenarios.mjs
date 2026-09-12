import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createDemo, corpusDirectory } from './setup.mjs';

import { checkScenario, loadDevelopmentChecks } from './scenario-checks.mjs';
import { developmentSuitePath } from './dataset.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) {
    throw new Error('Usage: npm run demo:cases -- [--output local-exports/development-v1-results.json]');
  }
  const demo = await createDemo();
  const { cases, suite: developmentSuite } = await loadDevelopmentChecks();
  const conversations = new Map();
  const results = [];
  for (const test of cases) {
    if (!conversations.has(test.conversation)) conversations.set(test.conversation, demo.newConversation());
    const priorTurns = structuredClone(conversations.get(test.conversation).history);
    try {
      const result = await conversations.get(test.conversation).send(test.question);
      const failures = checkScenario(test, result);
      results.push({ id: test.id, conversation: test.conversation, expectedStatus: test.status,
        expectedSections: (test.facts ?? []).map(fact => fact.section),
        manualReviewRequired: Boolean(test.manualReviewReason), manualReviewReason: test.manualReviewReason,
        priorTurns, passed: failures.length === 0, failures, ...result });
    } catch (error) {
      results.push({ id: test.id, conversation: test.conversation, question: test.question,
        expectedStatus: test.status, manualReviewRequired: Boolean(test.manualReviewReason),
        manualReviewReason: test.manualReviewReason,
        priorTurns, passed: false, failures: [error.message] });
    }
    console.error(`${results.at(-1).passed ? 'PASS' : 'FAIL'} ${test.id}`);
  }
  const files = [...new Set(demo.retriever.chunks.map(chunk => chunk.file))];
  const corpus = await Promise.all(files.map(async file => ({ file,
    sha256: createHash('sha256').update(await readFile(join(corpusDirectory, file))).digest('hex') })));
  const suiteSha256 = createHash('sha256').update(await readFile(developmentSuitePath)).digest('hex');
  let baseRevision = 'unavailable';
  try { baseRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  const report = {
    kind: 'Development live checks; pattern checks do not establish semantic correctness',
    timestamp: new Date().toISOString(), baseRevision, sourceState: 'working checkout; may include uncommitted changes',
    runtime: process.version, model: demo.provider.model, embeddingModel: demo.provider.embeddingModel,
    dataset: { id: demo.dataset.corpusId, version: demo.dataset.corpusVersion,
      manifestSha256: demo.dataset.manifestSha256 },
    suite: { id: developmentSuite.suiteId, version: developmentSuite.suiteVersion,
      split: developmentSuite.split, sha256: suiteSha256 },
    retrieval: { type: 'local cosine and keyword reciprocal rank fusion',
      lexicalScoring: 'distinct query-term overlap; no IDF or length normalization',
      topK: 6, rankConstant: 60, answerCache: false },
    corpus, index: demo.retriever.diagnostics, passed: results.filter(result => result.passed).length,
    total: results.length, results,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (args[1]) {
    await mkdir(dirname(args[1]), { recursive: true });
    await writeFile(args[1], json);
    console.error(`Saved ${args[1]} (${report.passed}/${report.total} smoke checks passed).`);
  } else process.stdout.write(json);
  if (report.passed !== report.total) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
