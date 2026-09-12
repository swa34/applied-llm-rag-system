import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conversation, validateAnswer } from './chat.mjs';
import { cosine, loadDocuments, LocalRetriever } from './retrieval.mjs';

const source = { id: 'leave.md#abc', file: 'leave.md', section: 'Annual leave', line: 4,
  title: 'Leave policy', text: 'Employees receive 20 days of annual leave.' };
const answer = { status: 'answered', claims: [{ text: 'Employees receive 20 days of annual leave.',
  sourceId: source.id, quote: source.text }] };
const resolved = query => ({ value: { action: 'retrieve', query, clarification: '' }, model: 'fake-resolver' });
const generated = () => ({ value: structuredClone(answer), model: 'fake-answer', usage: { output_tokens: 10 } });

test('validated answers carry exact evidence and source locations', () => {
  assert.deepEqual(validateAnswer(answer, [source]), {
    status: 'answered', answer: `${source.text} [1]`,
    citations: [{ id: source.id, file: source.file, section: source.section, line: 4, quote: source.text }],
  });
});

test('invalid or missing evidence fails closed', () => {
  for (const claim of [
    { ...answer.claims[0], sourceId: 'invented.md#123' },
    { ...answer.claims[0], quote: 'Employees receive 30 days of annual leave.' },
    { ...answer.claims[0], quote: '' },
    { ...answer.claims[0], quote: '   ' },
    { ...answer.claims[0], text: '' },
    { text: 'There is a benefit.' },
  ]) assert.throws(() => validateAnswer({ status: 'answered', claims: [claim] }, [source]));
  assert.throws(() => validateAnswer(answer, []));
  assert.throws(() => validateAnswer({ status: 'answered', claims: [] }, [source]));
  assert.throws(() => validateAnswer({ status: 'insufficient_evidence', claims: answer.claims }, [source]));
  assert.throws(() => validateAnswer({ status: 'unknown', claims: [] }, [source]));
  assert.throws(() => validateAnswer(null, [source]));
  const result = validateAnswer({ status: 'insufficient_evidence', claims: [] }, [source]);
  assert.equal(result.status, 'insufficient_evidence');
  assert.deepEqual(result.citations, []);
});

test('follow-ups and topic changes use resolved queries and retrieve fresh evidence', async () => {
  const histories = [], queries = [], answerInputs = [];
  const resolvedQueries = ['annual leave allowance', 'annual leave carryover', 'remote work eligibility'];
  const conversation = new Conversation({
    provider: {
      resolve: async (question, history) => {
        histories.push({ question, history });
        return resolved(resolvedQueries[histories.length - 1]);
      },
      answer: async (query, matches) => { answerInputs.push({ query, matches }); return generated(); },
    },
    retriever: { retrieve: async query => { queries.push(query); return { matches: [{ ...source, call: queries.length }] }; } },
  });
  for (const question of [' How much annual leave? ', 'Can I carry it over?', 'Who can work remotely?']) {
    const result = await conversation.send(question);
    assert.ok(result.timings.totalMs >= 0);
    assert.equal(result.resolutionModel, 'fake-resolver');
  }
  assert.deepEqual(queries, resolvedQueries);
  assert.deepEqual(answerInputs.map(input => input.query), resolvedQueries);
  assert.deepEqual(answerInputs.map(input => input.matches[0].call), [1, 2, 3]);
  assert.deepEqual(histories.map(item => item.history.length), [0, 1, 2]);
  assert.equal(histories[1].history[0].question, 'How much annual leave?');
  assert.equal(histories[2].history[1].resolvedQuery, 'annual leave carryover');
});

test('clarification bypasses retrieval and answers, then supplies context to resolution', async () => {
  let calls = 0;
  const conversation = new Conversation({
    provider: {
      resolve: async (question, history) => {
        calls++;
        if (calls === 1) return { value: { action: 'clarify', query: '', clarification: 'Leave or remote work?' } };
        assert.equal(history[0].status, 'clarify');
        assert.equal(history[0].question, 'Who is eligible?');
        assert.equal(question, 'Leave');
        return resolved('Who is eligible for annual leave?');
      },
      answer: async () => generated(),
    },
    retriever: { retrieve: async query => {
      assert.equal(calls, 2);
      assert.equal(query, 'Who is eligible for annual leave?');
      return { matches: [source] };
    } },
  });
  const clarification = await conversation.send('Who is eligible?');
  assert.equal(clarification.status, 'clarify');
  assert.deepEqual(clarification.retrieved, []);
  assert.deepEqual(clarification.citations, []);
  assert.equal(clarification.timings.retrievalMs, 0);
  assert.equal((await conversation.send('Leave')).status, 'answered');
});

test('conversations keep independent histories and isolate provider mutations', async () => {
  const seen = [];
  const dependencies = {
    provider: {
      resolve: async (question, history) => {
        seen.push(history.length);
        history.push({ question: 'provider mutation' });
        return resolved(question);
      }, answer: async () => generated(),
    },
    retriever: { retrieve: async () => ({ matches: [source] }) },
  };
  const first = new Conversation(dependencies), second = new Conversation(dependencies);
  await first.send('Annual leave?');
  await first.send('Carryover?');
  await second.send('Remote work?');
  assert.deepEqual(seen, [0, 1, 0]);
  assert.equal(first.history.length, 2);
  assert.equal(second.history.length, 1);
  assert.equal(first.history[0].question, 'Annual leave?');
});

test('failed turns roll back history and release the busy guard', async () => {
  let fail = false;
  const conversation = new Conversation({
    provider: { resolve: async question => resolved(question), answer: async () => {
      if (fail) return { value: { status: 'answered', claims: [{ ...answer.claims[0], sourceId: 'missing' }] } };
      return generated();
    } },
    retriever: { retrieve: async () => ({ matches: [source] }) },
  });
  await conversation.send('Annual leave?');
  const before = structuredClone(conversation.history);
  fail = true;
  await assert.rejects(conversation.send('Invalid answer'), /Citation validation failed/);
  assert.deepEqual(conversation.history, before);
  assert.equal(conversation.busy, false);
  fail = false;
  await conversation.send('Retry');
  assert.equal(conversation.history.length, 2);
});

test('concurrent sends are rejected without adding a failed turn', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const conversation = new Conversation({
    provider: { resolve: async question => { await gate; return resolved(question); }, answer: async () => generated() },
    retriever: { retrieve: async () => ({ matches: [source] }) },
  });
  const pending = conversation.send('First');
  await assert.rejects(conversation.send('Second'), /Wait for the current turn/);
  release();
  await pending;
  assert.equal(conversation.history.length, 1);
  assert.equal(conversation.busy, false);
});

test('question validation and history bounds prevent unbounded context', async () => {
  const conversation = new Conversation({
    provider: { resolve: async question => resolved(question), answer: async () => generated() },
    retriever: { retrieve: async () => ({ matches: [source] }) },
  });
  for (const question of ['', '   ', null, 'x'.repeat(2001)]) {
    await assert.rejects(conversation.send(question), /between 1 and 2000/);
  }
  for (let i = 0; i < 8; i++) await conversation.send(`Question ${i}`);
  assert.equal(conversation.history.length, 6);
  assert.equal(conversation.history[0].question, 'Question 2');
});

test('Markdown corpus excludes README and produces stable IDs with source metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rag-corpus-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(join(directory, 'README.md'), '# Read me\nThis is not evidence.'),
    writeFile(join(directory, 'leave.md'), '# Leave policy\r\n\r\n## Annual leave\r\nEmployees receive 20 days.\r\n'),
    writeFile(join(directory, 'ignore.txt'), 'Do not ingest me.'),
  ]);
  const first = await loadDocuments(directory), second = await loadDocuments(directory);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].file, 'leave.md');
  assert.equal(first[0].title, 'Leave policy');
  assert.equal(first[0].section, 'Annual leave');
  assert.equal(first[0].line, 4);
  assert.equal(first[0].text, 'Employees receive 20 days.');
  assert.match(first[0].id, /^leave\.md#[a-f0-9]{12}$/);
  await writeFile(join(directory, 'leave.md'), '# Leave policy\n\n## Annual leave\nEmployees receive 21 days.\n');
  assert.notEqual((await loadDocuments(directory))[0].id, first[0].id);
});

test('empty evidence corpus is rejected', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rag-empty-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'README.md'), 'Setup only.');
  await assert.rejects(loadDocuments(directory), /No Markdown evidence/);
});

test('cosine handles directions and rejects invalid embedding vectors', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  for (const vector of [[], [0, 0], [1], [NaN, 1], [Infinity, 1], null, 'bad']) {
    assert.throws(() => cosine(vector, [1, 0]), /Invalid embedding/);
    assert.throws(() => cosine([1, 0], vector), /Invalid embedding/);
  }
});

test('hybrid retrieval adds lexical evidence to injected semantic rankings', async () => {
  const chunks = [
    { ...source, id: 'a', title: 'Remote work', section: 'Remote work', text: 'Flexible locations.' },
    { ...source, id: 'b', text: 'Annual leave carryover is limited to five days.' },
  ];
  const inputs = [];
  const embedder = { embed: async texts => {
    inputs.push(texts);
    return { vectors: texts.length === 2 ? [[1, 0], [0, 1]] : [[1, 0]], usage: { total_tokens: texts.length }, model: 'fake-embed' };
  } };
  const retriever = await LocalRetriever.create(chunks, embedder);
  assert.deepEqual(inputs[0], chunks.map(chunk => `${chunk.title}\n${chunk.section}\n${chunk.text}`));
  assert.equal(retriever.diagnostics.chunks, 2);
  const result = await retriever.retrieve('annual leave carryover', 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, 'b');
  assert.equal(result.matches[0].semanticScore, 0);
  assert.equal(result.matches[0].keywordScore, 3);
  assert.deepEqual(result.usage, { total_tokens: 1 });
  assert.deepEqual(inputs[1], ['annual leave carryover']);
  await retriever.retrieve('remote work');
  assert.equal(inputs.length, 3);
});

test('index creation rejects wrong embedding counts and dimensions', async () => {
  await assert.rejects(LocalRetriever.create([source], { embed: async () => ({ vectors: [] }) }), /count/);
  await assert.rejects(LocalRetriever.create([source, { ...source, id: 'second' }], {
    embed: async () => ({ vectors: [[1, 0], [1]] }),
  }), /Invalid embedding/);
});
