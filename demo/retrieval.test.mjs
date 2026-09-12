import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosine, loadDocuments, LocalRetriever } from './retrieval.mjs';

async function loadFixture(t, markdown) {
  const directory = await mkdtemp(join(tmpdir(), 'rag-chunks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'policy.md'), markdown);
  const chunks = await loadDocuments(directory);
  assert.deepEqual(await loadDocuments(directory), chunks);
  assert.equal(new Set(chunks.map(chunk => chunk.id)).size, chunks.length);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 1800);
    assert.ok(markdown.includes(chunk.text), 'Every passage is an exact contiguous source substring.');
  }
  return chunks;
}

test('exactly 1800 characters including the joining newline remain one chunk', async t => {
  const text = `${'a'.repeat(900)}\n${'b'.repeat(899)}`;
  const chunks = await loadFixture(t, `# Policy\n${text}`);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, text);
  assert.equal(chunks[0].line, 2);
});

test('1801 characters including a newline split with accurate line locations', async t => {
  const lines = ['a'.repeat(900), 'b'.repeat(900)];
  const chunks = await loadFixture(t, `# Policy\n${lines.join('\n')}`);
  assert.deepEqual(chunks.map(chunk => chunk.text), lines);
  assert.deepEqual(chunks.map(chunk => chunk.line), [2, 3]);
});

test('multiline chunks track source lines across blank lines and headings', async t => {
  const first = 'a'.repeat(899), second = 'b'.repeat(899), third = 'c'.repeat(900);
  const chunks = await loadFixture(t, `# Policy\n\n## Rules\n\n${first}\n${second}\n${third}\n\n## Contact\n\nAsk Support.`);
  assert.deepEqual(chunks.map(chunk => chunk.text), [`${first}\n${second}`, third, 'Ask Support.']);
  assert.deepEqual(chunks.map(chunk => chunk.line), [5, 7, 11]);
  assert.deepEqual(chunks.map(chunk => chunk.section), ['Rules', 'Rules', 'Contact']);
});

test('long paragraphs split at word boundaries without losing source words', async t => {
  const paragraph = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
  const chunks = await loadFixture(t, `# Policy\nIntro.\n${paragraph}\nNext line.`);
  assert.equal(chunks[0].text, 'Intro.');
  assert.equal(chunks.at(-1).text, 'Next line.');
  const fragments = chunks.slice(1, -1);
  assert.ok(fragments.length > 1);
  assert.equal(fragments.map(chunk => chunk.text).join(' '), paragraph);
  assert.ok(fragments.every(chunk => chunk.line === 3));
  assert.equal(chunks.at(-1).line, 4);
});

test('oversized tokens split safely and repeated same-line fragments have distinct stable IDs', async t => {
  const token = 'x'.repeat(5401);
  const chunks = await loadFixture(t, `# Policy\n${token}`);
  assert.deepEqual(chunks.map(chunk => chunk.text.length), [1800, 1800, 1800, 1]);
  assert.equal(chunks.map(chunk => chunk.text).join(''), token);
  assert.ok(chunks.every(chunk => chunk.line === 2));
});

test('hard splits preserve Unicode surrogate pairs', async t => {
  const token = `${'x'.repeat(1799)}😀${'z'.repeat(2000)}`;
  const chunks = await loadFixture(t, `# Policy\n${token}`);
  assert.equal(chunks[0].text.length, 1799);
  assert.equal(chunks.map(chunk => chunk.text).join(''), token);
  assert.ok(chunks.every(chunk => chunk.text.isWellFormed()));
});

test('precomputed retrieval preserves unique-term scores, semantic order, and reciprocal rank fusion', async () => {
  const chunks = [
    { id: 'a', title: 'Remote', section: 'Work', text: 'Anywhere.' },
    { id: 'b', title: 'Leave', section: 'Policy', text: 'Annual leave carryover carryover.' },
    { id: 'c', title: 'Leave', section: 'Policy', text: 'Annual allowance.' },
  ];
  let calls = 0;
  const retriever = await LocalRetriever.create(chunks, { embed: async () => ({
    vectors: calls++ === 0 ? [[3, 0], [0, 7], [-2, 0]] : [[9, 0]],
  }) });
  const result = await retriever.retrieve('The ANNUAL leave, carryover carryover?');
  assert.deepEqual(result.matches.map(match => match.id), ['b', 'c', 'a']);
  assert.deepEqual(result.matches.map(match => match.keywordScore), [3, 2, 0]);
  assert.deepEqual(result.matches.map(match => match.semanticScore), [0, -1, 1]);
  assert.deepEqual(result.matches.map(match => match.score), [1 / 62 + 1 / 61, 1 / 63 + 1 / 62, 1 / 61]);
  assert.deepEqual((await retriever.retrieve('The ANNUAL leave, carryover carryover?')).matches, result.matches);
});

test('cosine accepts large dimensions and finite extreme magnitudes without argument overflow', () => {
  const large = Array(200000).fill(0);
  large[199999] = 1;
  assert.equal(cosine(large, large), 1);
  for (const magnitude of [Number.MAX_VALUE, Number.MIN_VALUE]) {
    assert.ok(Math.abs(cosine([magnitude, magnitude], [magnitude, magnitude]) - 1) < 1e-12);
  }
});

test('invalid corpus and query vectors fail validation before scoring', async () => {
  const chunks = [{ id: 'a', title: 'Policy', section: 'Leave', text: 'Allowance.' }];
  const invalid = [[], [0, 0], [1], [NaN, 1], [Infinity, 1], Array(2), null, 'bad'];
  for (const vector of invalid) {
    assert.throws(() => cosine(vector, [1, 0]), /Invalid embedding/);
    assert.throws(() => cosine([1, 0], vector), /Invalid embedding/);
    let calls = 0;
    const retriever = await LocalRetriever.create(chunks, { embed: async () => ({
      vectors: calls++ === 0 ? [[1, 0]] : [vector],
    }) });
    await assert.rejects(retriever.retrieve('Leave'), /Invalid embedding/);
  }
  for (const vector of [[0, 0], [NaN, 1], Array(2), null]) {
    await assert.rejects(LocalRetriever.create(chunks, { embed: async () => ({ vectors: [vector] }) }), /Invalid embedding/);
  }
  for (const vectors of [[], [[1, 0], [1, 0]]]) {
    let calls = 0;
    const retriever = await LocalRetriever.create(chunks, { embed: async () => ({
      vectors: calls++ === 0 ? [[1, 0]] : vectors,
    }) });
    await assert.rejects(retriever.retrieve('Leave'), /count does not match query/);
  }
});
