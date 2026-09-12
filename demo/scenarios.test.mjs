import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, checkScenario } from './scenario-checks.mjs';
import { validateAnswer } from './chat.mjs';

const travel = { id: 'travel#1', file: 'travel.md', section: 'Overnight trip approval', line: 3,
  text: 'An employee must obtain approval from their direct supervisor before booking an overnight work trip.' };
const purchase = { id: 'purchase#2', file: 'purchasing.md', section: 'Purchasing approval', line: 3,
  text: 'The department head approves purchase requests before an employee places an order.' };
const resultFor = (texts, sources = [travel]) => ({
  ...validateAnswer({ status: 'answered', claims: texts.map((text, i) => ({
    text, sourceId: sources[i].id, quote: sources[i].text,
  })) }, sources), query: 'approval process', retrieved: sources,
});
const direct = cases.find(item => item.id === 'travel-direct');

test('smoke checks reject negated approval claims despite valid sources and quotes', () => {
  assert.deepEqual(checkScenario(direct, resultFor([travel.text])), []);
  for (const text of [
    'Your supervisor must not approve an overnight trip.',
    'Supervisor approval is not required.',
    "Supervisor approval isn't necessary.",
    'Book the overnight trip without approval from your supervisor.',
    'No supervisor approval is required.',
    'The supervisor cannot approve an overnight trip.',
    "The supervisor can't approve an overnight trip.",
  ]) assert.ok(checkScenario(direct, resultFor([text])).includes('Answer contradicts a known fixture rule.'), text);
});

test('negating a different approver does not reverse the supervisor requirement', () => {
  assert.deepEqual(checkScenario(direct, resultFor(['Supervisor approval is required, not department head approval.'])), []);
});

test('full-time tuition exclusion after six months is rejected but the waiting period is allowed', () => {
  const scenario = cases.find(item => item.id === 'tuition-direct');
  const tuition = { ...travel, id: 'tuition#4', file: 'tuition.md', section: 'Tuition assistance eligibility', text: 'Full-time employees become eligible for tuition assistance after six months of employment.' };
  const wrong = resultFor(['Full-time staff with six months of service are not eligible for tuition assistance.'], [tuition]);
  assert.ok(checkScenario(scenario, wrong).includes('Answer contradicts a known fixture rule.'));
  const waiting = resultFor(['Full-time employees are not eligible until they complete six months of employment.'], [tuition]);
  assert.deepEqual(checkScenario(scenario, waiting), []);
});

test('tuition eligibility accepts can receive while retaining the source, waiting period, and exclusion checks', () => {
  const scenario = cases.find(item => item.id === 'tuition-direct');
  const tuition = { ...travel, id: 'tuition#4', file: 'tuition.md', section: 'Tuition assistance eligibility', text: 'Full-time employees become eligible for tuition assistance after six months of employment.' };
  const text = 'Full-time employees can receive tuition assistance after six months of employment.';
  assert.deepEqual(checkScenario(scenario, resultFor([text], [tuition])), []);
  assert.ok(checkScenario(scenario, resultFor([text], [travel])).includes('Missing citation to Tuition assistance eligibility.'));
  assert.ok(checkScenario(scenario, resultFor(['Full-time employees can receive tuition assistance.'], [tuition])).includes('Missing expected fact supported by Tuition assistance eligibility.'));
  for (const exclusion of ['cannot receive', "can't receive", 'can not receive']) {
    const wrong = resultFor([`Full-time employees ${exclusion} tuition assistance after six months of employment.`], [tuition]);
    assert.ok(checkScenario(scenario, wrong).includes('Answer contradicts a known fixture rule.'), exclusion);
  }
  const waiting = resultFor(['Full-time employees cannot receive tuition assistance until they complete six months of employment, when they can receive it.'], [tuition]);
  assert.deepEqual(checkScenario(scenario, waiting), []);
});

test('purchasing accepts signs off and rejects reversed approval requirements', () => {
  const scenario = cases.find(item => item.id === 'clarification-reply');
  const text = 'The department head signs off on purchase requests before an employee places an order.';
  assert.deepEqual(checkScenario(scenario, resultFor([text], [purchase])), []);
  assert.ok(checkScenario(scenario, resultFor([text], [travel])).includes('Missing citation to Purchasing approval.'));
  for (const wrong of [
    'The department head signs off on purchase requests but this is not required.',
    "The department head's sign-off is not required before an employee places an order.",
    'The department head must not sign off on purchase requests.',
  ]) assert.ok(checkScenario(scenario, resultFor([wrong], [purchase])).includes('Answer contradicts a known fixture rule.'), wrong);
});

test('comparison requires factual claims linked to each of the two sources', () => {
  const comparison = cases.find(item => item.id === 'comparison');
  assert.deepEqual(checkScenario(comparison, resultFor([travel.text, purchase.text], [travel, purchase])), []);
  const incomplete = resultFor([travel.text]);
  incomplete.citations.push({ ...purchase, quotes: [purchase.text] });
  assert.ok(checkScenario(comparison, incomplete).includes('Missing expected fact supported by Purchasing approval.'));
  const swapped = resultFor([purchase.text, travel.text], [travel, purchase]);
  assert.ok(checkScenario(comparison, swapped).some(failure => failure.startsWith('Missing expected fact')));
});

test('part-time tuition checks reject contradictions and accept explicit exclusion', () => {
  const scenario = cases.find(item => item.id === 'tuition-follow-up');
  const tuition = { ...travel, id: 'tuition#3', file: 'tuition.md', section: 'Part-time tuition eligibility', text: 'Part-time staff are not eligible for tuition assistance.' };
  const valid = { ...resultFor([tuition.text], [tuition]), query: 'part-time tuition eligibility' };
  assert.deepEqual(checkScenario(scenario, valid), []);
  const wrong = { ...resultFor(['Part-time staff are not eligible initially, but part-time staff are eligible after six months.'], [tuition]), query: valid.query };
  assert.ok(checkScenario(scenario, wrong).includes('Answer contradicts a known fixture rule.'));
});

test('a no-change travel follow-up is not mistaken for a negated approval requirement', () => {
  const scenario = cases.find(item => item.id === 'travel-follow-up');
  const source = { ...travel, section: 'Part-time travel eligibility' };
  const result = { ...resultFor(['Part-time staff follow the same approval process: their supervisor approves the trip. Employment status does not change who approves it.'], [source]), query: 'part-time travel' };
  assert.deepEqual(checkScenario(scenario, result), []);
});
