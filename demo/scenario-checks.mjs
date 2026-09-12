// Development-fixture checks, not a general entailment checker or held-out evaluation.
import { developmentSuitePath, loadCaseSuite, loadDataset } from './dataset.mjs';

const approvalContradictions = [
  /\b(?:supervisor|department head)\b[^.!?;,\n]*\b(?:not|never|cannot)\b[^.!?;,\n]*\b(?:approv\w*|sign|required|needed)\b/i,
  /\b(?:approval|signs?[- ]off)\b[^.!?;,\n]*\b(?:not|never|cannot)\b[^.!?;,\n]*\b(?:required|needed|necessary)\b/i,
  /\b(?:without|no need for)\s+(?:prior\s+|any\s+)?(?:approval|supervisor|department head)/i,
  /\b(?:no|neither)\s+(?:supervisor|department head|approval)\b[^.!?;\n]*\b(?:required|needed|necessary)/i,
];
const tuitionContradictions = [
  /\bpart.time\b[^.!?;\n]*\b(?:are|is|become|remain)\s+(?:also\s+)?eligible\b/i,
  /\bpart.time\b[^.!?;\n]*\b(?:can|may)\s+(?:also\s+)?(?:receive|claim|qualify)\b/i,
  /\b(?:all|every)\s+(?:staff|employees)\b[^.!?;\n]*\beligible\b/i,
  /\bfull.time\b(?![^.!?;,\n]*\b(?:before|until|unless|yet)\b)[^.!?;,\n]*\b(?:not|never|cannot)\s+(?:eligible|qualif\w*|receive)\b/i,
];
const legacyForbidden = new Map([
  ['travel-direct', approvalContradictions], ['travel-follow-up', approvalContradictions],
  ['comparison', approvalContradictions], ['clarification-reply', approvalContradictions],
  ['tuition-direct', tuitionContradictions], ['tuition-follow-up', tuitionContradictions],
]);

const regex = pattern => new RegExp(pattern, 'iu');

export async function loadDevelopmentChecks() {
  const dataset = await loadDataset();
  const suite = await loadCaseSuite(developmentSuitePath, dataset);
  const chunks = new Map(dataset.chunks.map(chunk => [chunk.id, chunk]));
  const documentFiles = new Map(dataset.manifest.documents.map(document => [document.id, document.file]));
  const cases = suite.cases.flatMap(testCase => testCase.turns.map(turn => {
    const expected = turn.expected;
    return {
      id: turn.id,
      conversation: testCase.id,
      question: turn.question,
      status: expected.status,
      facts: (expected.facts ?? []).map(fact => ({
        sourceId: fact.sourceId,
        section: chunks.get(fact.sourceId).section,
        patterns: fact.patterns.map(regex),
      })),
      forbidden: [...(legacyForbidden.get(turn.id) ?? []), ...(expected.forbiddenPatterns ?? []).map(regex)],
      answer: expected.answerPattern ? regex(expected.answerPattern) : undefined,
      query: expected.queryPattern ? regex(expected.queryPattern) : undefined,
      onlyFiles: expected.onlyDocumentIds?.map(documentId => documentFiles.get(documentId)),
      onlySourceIds: expected.onlySourceIds,
    };
  }));
  return { cases, suite };
}

const normalize = text => text.replaceAll('’', "'")
  .replace(/\b(is|are|was|were|do|does|did|could|should|would|must)n't\b/gi, '$1 not')
  .replace(/\bcan't\b/gi, 'cannot').replace(/\bwon't\b/gi, 'will not');

export function checkScenario(test, result) {
  const failures = [];
  if (result.status !== test.status) failures.push(`Expected ${test.status}, received ${result.status}.`);
  for (const fact of test.facts ?? []) {
    const matchingSourceIds = new Set(result.citations.filter(source => source.id === fact.sourceId).map(source => source.id));
    if (!matchingSourceIds.size) failures.push(`Missing citation to ${fact.section}.`);
    const text = normalize((result.claims ?? []).filter(claim => matchingSourceIds.has(claim.sourceId))
      .map(claim => claim.text).join('\n'));
    if (!fact.patterns.every(pattern => pattern.test(text))) failures.push(`Missing expected fact supported by ${fact.section}.`);
  }
  const clauses = normalize(result.answer).split(/[.!?;,\n]+/);
  if ((test.forbidden ?? []).some(pattern => clauses.some(clause => pattern.test(clause)))) {
    failures.push('Answer contradicts a known fixture rule.');
  }
  if (test.answer && !test.answer.test(result.answer)) failures.push('Answer did not match the smoke-check pattern.');
  if (test.query && !test.query.test(result.query)) failures.push('Resolved query lost the expected subject.');
  if (test.onlyFiles && result.citations.some(source => !test.onlyFiles.includes(source.file))) {
    failures.push('Citations retained or introduced an unexpected subject.');
  }
  if (test.onlySourceIds && result.citations.some(source => !test.onlySourceIds.includes(source.id))) {
    failures.push('Answer cited a source outside the allowed evidence passages.');
  }
  if (test.status !== 'answered' && (result.citations.length || result.claims?.length)) failures.push('Unexpected claims or citations in non-answer.');
  if (test.status === 'clarify' && result.retrieved.length) failures.push('Clarification unexpectedly retrieved evidence.');
  return failures;
}
