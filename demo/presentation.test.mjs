import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { runCli } from './cli.mjs';
import { validateAnswer } from './chat.mjs';

const source = { id: 'travel#1', file: 'travel.md', section: 'Approvals', line: 3,
  text: 'The supervisor approves trips. Part-time staff use the same process.' };
const claim = { text: 'The supervisor approves trips.', sourceId: source.id, quote: 'The supervisor approves trips.' };

test('source citations reuse numbers and preserve distinct evidence quotes and claim links', () => {
  const second = { text: 'Part-time staff use the same process.', sourceId: source.id, quote: 'Part-time staff use the same process.' };
  const other = { ...source, id: 'tuition#2', file: 'tuition.md' };
  const result = validateAnswer({ status: 'answered', claims: [claim, second, claim, { ...claim, sourceId: other.id }] }, [source, other]);
  assert.deepEqual(result.claims.map(item => item.citation), [1, 1, 1, 2]);
  assert.equal(result.citations.length, 2);
  assert.deepEqual(result.citations[0].quotes, [claim.quote, second.quote]);
  assert.match(result.answer, /Part-time staff use the same process\. \[1\]/);
  assert.match(result.answer, /\[2\]$/);
});

function capture() {
  let text = '';
  const stream = new Writable({ write(chunk, encoding, done) { text += chunk; done(); } });
  stream.columns = 80;
  return { stream, text: () => text };
}

async function session(lines, interactive) {
  const stdin = new PassThrough();
  stdin.isTTY = interactive;
  const stdout = capture(), stderr = capture(), histories = [];
  let conversations = 0;
  const setup = async () => ({ retriever: { diagnostics: { chunks: 1 } }, newConversation: () => {
    conversations++;
    let turns = 0;
    return { send: async question => {
      if (question === 'fail') throw new Error('Temporary failure');
      histories.push(turns++);
      return { ...validateAnswer({ status: 'answered', claims: [claim] }, [source]),
        query: question, retrieved: [source], timings: { totalMs: 1 }, usage: {} };
    } };
  } });
  const pending = runCli({ args: [], stdin, stdout: stdout.stream, stderr: stderr.stream, setup });
  setImmediate(() => stdin.end(lines.join('\n') + '\n'));
  const code = await pending;
  return { code, stdout: stdout.text(), stderr: stderr.text(), histories, conversations };
}

test('batch input preserves any failure while later questions still run', async () => {
  const result = await session(['fail', 'success', '/exit'], false);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /The supervisor approves trips/);
  assert.match(result.stderr, /Temporary failure/);
});

test('interactive success clears a recovered failure but the latest failed turn stays nonzero', async () => {
  assert.equal((await session(['fail', 'success', '/exit'], true)).code, 0);
  assert.equal((await session(['success', 'fail', '/exit'], true)).code, 1);
});

test('answers and quotations stay on stdout; diagnostics and session messages go to stderr', async () => {
  const result = await session(['first', '/new', 'second', '/exit', 'ignored'], false);
  assert.equal(result.code, 0);
  assert.deepEqual(result.histories, [0, 0]);
  assert.equal(result.conversations, 2);
  assert.match(result.stdout, /travel.md:3/);
  assert.doesNotMatch(result.stdout, /Fictional document demo|Index:|resolvedQuery|Started a new/);
  assert.match(result.stderr, /Fictional document demo/);
  assert.match(result.stderr, /resolvedQuery/);
  assert.match(result.stderr, /Started a new conversation/);
});

test('single-question failures propagate to the executable error handler', async () => {
  const output = capture();
  await assert.rejects(runCli({ args: ['question'], stdout: output.stream, stderr: output.stream,
    setup: async () => ({ retriever: { diagnostics: {} }, newConversation: () => ({ send: async () => { throw new Error('Failed turn'); } }) }) }), /Failed turn/);
});
