import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createDemo, corpusDirectory } from './setup.mjs';

// These are smoke-check criteria for known fixtures, not a held-out quality benchmark.
const cases = [
  { id: 'travel-direct', conversation: 'travel', question: 'Who approves an overnight trip?',
    status: 'answered', section: 'Overnight trip approval', answer: /supervisor/i },
  { id: 'tuition-direct', conversation: 'tuition', question: 'Who can receive tuition assistance?',
    status: 'answered', section: 'Tuition assistance eligibility', answer: /six|6/i },
  { id: 'travel-follow-up', conversation: 'travel', question: 'Does that change for part-time staff?',
    status: 'answered', section: 'Part-time travel eligibility', answer: /supervisor/i, query: /travel|trip/i },
  { id: 'tuition-follow-up', conversation: 'tuition', question: 'Does that change for part-time staff?',
    status: 'answered', section: 'Part-time tuition eligibility', answer: /not eligible|ineligible|do not qualify|not qualify/i, query: /tuition/i },
  { id: 'comparison', conversation: 'ambiguous', question: 'Compare travel and purchasing approvals.',
    status: 'answered', section: 'Purchasing approval', secondSection: 'Overnight trip approval',
    answer: /supervisor[\s\S]*department head|department head[\s\S]*supervisor/i },
  { id: 'ambiguous-follow-up', conversation: 'ambiguous', question: 'Who signs off on that?',
    status: 'clarify', answer: /travel|purchasing/i },
  { id: 'clarification-reply', conversation: 'ambiguous', question: 'Purchasing approvals.',
    status: 'answered', section: 'Purchasing approval', answer: /department head/i },
  { id: 'topic-switch', conversation: 'travel', question: 'How do I reset my password?',
    status: 'answered', section: 'Self-service password reset', answer: /reset/i, query: /password/i,
    onlyFile: 'password-reset.md' },
  { id: 'missing-evidence', conversation: 'gap', question: 'Does the travel policy reimburse pet-sitting during overnight trips?',
    status: 'insufficient_evidence' },
  { id: 'missing-antecedent', conversation: 'orphan', question: 'Who signs off on that?', status: 'clarify' },
];

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) {
    throw new Error('Usage: npm run demo:cases -- [--output local-exports/phase-3-results.json]');
  }
  const demo = await createDemo();
  const conversations = new Map();
  const results = [];
  for (const test of cases) {
    if (!conversations.has(test.conversation)) conversations.set(test.conversation, demo.newConversation());
    const priorTurns = structuredClone(conversations.get(test.conversation).history);
    try {
      const result = await conversations.get(test.conversation).send(test.question);
      const failures = [];
      if (result.status !== test.status) failures.push(`Expected ${test.status}, received ${result.status}.`);
      if (test.section && !result.citations.some(source => source.section === test.section)) failures.push(`Missing citation to ${test.section}.`);
      if (test.secondSection && !result.citations.some(source => source.section === test.secondSection)) failures.push(`Missing citation to ${test.secondSection}.`);
      if (test.answer && !test.answer.test(result.answer)) failures.push('Answer did not match the smoke-check factual pattern.');
      if (test.query && !test.query.test(result.query)) failures.push('Resolved query lost the expected subject.');
      if (test.onlyFile && result.citations.some(source => source.file !== test.onlyFile)) failures.push('Citations retained the previous subject.');
      if (test.status !== 'answered' && result.citations.length) failures.push('Unexpected citations in non-answer.');
      if (test.status === 'clarify' && result.retrieved.length) failures.push('Clarification unexpectedly retrieved evidence.');
      results.push({ id: test.id, conversation: test.conversation, expectedStatus: test.status,
        expectedSection: test.section, expectedSecondSection: test.secondSection,
        priorTurns, passed: failures.length === 0, failures, ...result });
    } catch (error) {
      results.push({ id: test.id, conversation: test.conversation, question: test.question,
        expectedStatus: test.status, priorTurns, passed: false, failures: [error.message] });
    }
    console.error(`${results.at(-1).passed ? 'PASS' : 'FAIL'} ${test.id}`);
  }
  const files = [...new Set(demo.retriever.chunks.map(chunk => chunk.file))];
  const corpus = await Promise.all(files.map(async file => ({ file,
    sha256: createHash('sha256').update(await readFile(join(corpusDirectory, file))).digest('hex') })));
  let baseRevision = 'unavailable';
  try { baseRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  const report = {
    kind: 'Phase 3 live smoke checks; pattern checks do not establish semantic correctness',
    timestamp: new Date().toISOString(), baseRevision, sourceState: 'working checkout; may include uncommitted changes',
    runtime: process.version, model: demo.provider.model, embeddingModel: demo.provider.embeddingModel,
    retrieval: { type: 'local cosine and keyword reciprocal rank fusion', topK: 6, rankConstant: 60, answerCache: false },
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
