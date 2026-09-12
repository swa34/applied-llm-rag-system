// Known-fixture smoke criteria, not a general entailment checker or held-out evaluation.
const travelFact = { section: 'Overnight trip approval', patterns: [/supervisor/i, /approv|signs?[- ]off/i] };
const purchasingFact = { section: 'Purchasing approval', patterns: [/department head/i, /approv|signs?[- ]off/i] };
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

export const cases = [
  { id: 'travel-direct', conversation: 'travel', question: 'Who approves an overnight trip?',
    status: 'answered', facts: [travelFact], forbidden: approvalContradictions },
  { id: 'tuition-direct', conversation: 'tuition', question: 'Who can receive tuition assistance?',
    status: 'answered', facts: [{ section: 'Tuition assistance eligibility', patterns: [/full.time/i, /six|\b6\b/i, /eligible|\bcan receive\b/i] }],
    forbidden: tuitionContradictions },
  { id: 'travel-follow-up', conversation: 'travel', question: 'Does that change for part-time staff?',
    status: 'answered', facts: [{ ...travelFact, section: 'Part-time travel eligibility', patterns: [/part.time/i, /supervisor/i, /same|unchanged|does not change|no change/i] }],
    forbidden: approvalContradictions, query: /travel|trip/i },
  { id: 'tuition-follow-up', conversation: 'tuition', question: 'Does that change for part-time staff?',
    status: 'answered', facts: [{ section: 'Part-time tuition eligibility', patterns: [/part.time/i, /not eligible|ineligible|do not qualify|not qualify/i] }],
    forbidden: tuitionContradictions, query: /tuition/i },
  { id: 'comparison', conversation: 'ambiguous', question: 'Compare travel and purchasing approvals.',
    status: 'answered', facts: [travelFact, purchasingFact], forbidden: approvalContradictions },
  { id: 'ambiguous-follow-up', conversation: 'ambiguous', question: 'Who signs off on that?',
    status: 'clarify', answer: /travel|purchasing/i },
  { id: 'clarification-reply', conversation: 'ambiguous', question: 'Purchasing approvals.',
    status: 'answered', facts: [purchasingFact], forbidden: approvalContradictions },
  { id: 'topic-switch', conversation: 'travel', question: 'How do I reset my password?',
    status: 'answered', facts: [{ section: 'Self-service password reset', patterns: [/reset/i, /password/i] }],
    query: /password/i, onlyFile: 'password-reset.md' },
  { id: 'missing-evidence', conversation: 'gap', question: 'Does the travel policy reimburse pet-sitting during overnight trips?',
    status: 'insufficient_evidence' },
  { id: 'missing-antecedent', conversation: 'orphan', question: 'Who signs off on that?', status: 'clarify' },
];

const normalize = text => text.replaceAll('’', "'")
  .replace(/\b(is|are|was|were|do|does|did|could|should|would|must)n't\b/gi, '$1 not')
  .replace(/\bcan't\b/gi, 'cannot').replace(/\bwon't\b/gi, 'will not');

export function checkScenario(test, result) {
  const failures = [];
  if (result.status !== test.status) failures.push(`Expected ${test.status}, received ${result.status}.`);
  for (const fact of test.facts ?? []) {
    const matchingSourceIds = new Set(result.citations.filter(source => source.section === fact.section).map(source => source.id));
    if (!matchingSourceIds.size) failures.push(`Missing citation to ${fact.section}.`);
    // Inspect only claims attached to this fact's source, rather than words anywhere in the answer.
    const text = normalize((result.claims ?? []).filter(claim => matchingSourceIds.has(claim.sourceId)).map(claim => claim.text).join('\n'));
    if (!fact.patterns.every(pattern => pattern.test(text))) failures.push(`Missing expected fact supported by ${fact.section}.`);
  }
  // Keep a negation in a contrasting clause from attaching to the previous approver.
  const clauses = normalize(result.answer).split(/[.!?;,\n]+/);
  if ((test.forbidden ?? []).some(pattern => clauses.some(clause => pattern.test(clause)))) {
    failures.push('Answer contradicts a known fixture rule.');
  }
  if (test.answer && !test.answer.test(result.answer)) failures.push('Answer did not match the smoke-check pattern.');
  if (test.query && !test.query.test(result.query)) failures.push('Resolved query lost the expected subject.');
  if (test.onlyFile && result.citations.some(source => source.file !== test.onlyFile)) failures.push('Citations retained the previous subject.');
  if (test.status !== 'answered' && (result.citations.length || result.claims?.length)) failures.push('Unexpected claims or citations in non-answer.');
  if (test.status === 'clarify' && result.retrieved.length) failures.push('Clarification unexpectedly retrieved evidence.');
  return failures;
}
