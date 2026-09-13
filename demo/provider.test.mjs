import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from './provider.mjs';

const completed = value => ({ status: 'completed', model: 'fake-model', usage: { output_tokens: 7 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const mockProvider = (payload, model = 'fake-model') => {
  const calls = [];
  const provider = new OpenAIProvider({ apiKey: 'test-only-key', model, embeddingModel: 'fake-embedding',
    fetchImpl: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => payload }; },
  });
  return { provider, calls };
};

test('provider requires a nonempty credential without network access', () => {
  assert.throws(() => new OpenAIProvider({ apiKey: '' }), /OPENAI_API_KEY is required/);
  assert.throws(() => new OpenAIProvider({ apiKey: '   ' }), /OPENAI_API_KEY is required/);
});

test('resolution uses strict REST schema, disables storage, and keeps history in data', async () => {
  const value = { action: 'retrieve', query: 'annual leave allowance', clarification: '' };
  const { provider, calls } = mockProvider(completed(value));
  const history = [{ question: 'Previous question', answer: 'Previous answer' }];
  const result = await provider.resolve('How many days?', history);
  assert.deepEqual(result.value, value);
  assert.equal(result.model, 'fake-model');
  assert.deepEqual(result.usage, { output_tokens: 7 });
  const request = calls[0];
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.Authorization, 'Bearer test-only-key');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.ok(request.signal instanceof AbortSignal);
  assert.equal(request.body.store, false);
  assert.equal(request.body.model, 'fake-model');
  assert.equal(request.body.max_output_tokens, 512);
  assert.deepEqual(JSON.parse(request.body.input), { history, question: 'How many days?' });
  const format = request.body.text.format;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.strict, true);
  assert.equal(format.name, 'resolve_question');
  assert.equal(format.schema.additionalProperties, false);
  assert.deepEqual(format.schema.required, ['action', 'query', 'clarification']);
  assert.deepEqual(format.schema.properties.action.enum, ['retrieve', 'clarify']);
});

test('answer request includes only supplied evidence fields and enforces claim shape', async () => {
  const { provider, calls } = mockProvider(completed({ status: 'insufficient_evidence', claims: [] }));
  await provider.answer('Annual leave?', [{ id: 'leave#1', file: 'leave.md', section: 'Allowance', text: '20 days.',
    score: 0.2, line: 4, internal: 'not evidence' }]);
  const body = calls[0].body;
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 4096);
  assert.deepEqual(JSON.parse(body.input), { question: 'Annual leave?', evidence: [
    { sourceId: 'leave#1', file: 'leave.md', section: 'Allowance', text: '20 days.' },
  ] });
  const schema = body.text.format.schema;
  assert.deepEqual(schema.properties.status.enum, ['answered', 'insufficient_evidence']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.claims.items.additionalProperties, false);
  assert.deepEqual(schema.properties.claims.items.required, ['text', 'sourceId', 'quote']);
});

test('Terra and Luna preserve non-reasoning structured requests and omit temperature', async () => {
  for (const model of ['gpt-5.6-terra', 'gpt-5.6-luna']) {
    const { provider, calls } = mockProvider(completed({}), model);
    await provider.resolve('Question', []);
    await provider.answer('Question', []);
    for (const request of calls) {
      assert.equal(request.body.model, model);
      assert.deepEqual(request.body.reasoning, { effort: 'none' });
      assert.equal(Object.hasOwn(request.body, 'temperature'), false);
      assert.equal(request.body.text.format.strict, true);
      assert.equal(request.body.store, false);
    }
    assert.deepEqual(calls.map(request => request.body.max_output_tokens), [512, 4096]);
  }
});

test('temperature is restricted to known GPT-4.1 and GPT-4o models and snapshots', async () => {
  for (const model of ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1-mini-2025-04-14',
    'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06', 'gpt-4o-mini-2024-07-18']) {
    const { provider, calls } = mockProvider(completed({}), model);
    await provider.resolve('Question', []);
    assert.equal(calls[0].body.temperature, 0, model);
    assert.equal(Object.hasOwn(calls[0].body, 'reasoning'), false, model);
  }
  for (const model of ['gpt-5', 'o3', 'fake-model', 'gpt-4o-search-preview', 'gpt-4.10']) {
    const { provider, calls } = mockProvider(completed({}), model);
    await provider.resolve('Question', []);
    assert.equal(Object.hasOwn(calls[0].body, 'temperature'), false, model);
  }
});

test('embeddings restore input order and preserve usage', async () => {
  const { provider, calls } = mockProvider({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }],
    usage: { total_tokens: 4 }, model: 'fake-embedding' });
  const result = await provider.embed(['first', 'second']);
  assert.deepEqual(result.vectors, [[1, 0], [0, 1]]);
  assert.deepEqual(result.usage, { total_tokens: 4 });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/embeddings');
  assert.deepEqual(calls[0].body, { model: 'fake-embedding', input: ['first', 'second'], encoding_format: 'float' });
});

test('embedding count and index mismatches fail closed', async () => {
  for (const data of [undefined, [], [{ index: 0, embedding: [1, 0] }]]) {
    const { provider } = mockProvider({ data });
    await assert.rejects(provider.embed(['first', 'second']), /embedding count/);
  }
  for (const indices of [[0, 0], [1, 2], [-1, 0]]) {
    const { provider } = mockProvider({ data: indices.map(index => ({ index, embedding: [1, 0] })) });
    await assert.rejects(provider.embed(['first', 'second']), /embedding indices/);
  }
});

test('refusals, incomplete responses, and invalid structured text are rejected', async () => {
  const cases = [
    [{ ...completed({}), status: 'incomplete' }, /did not complete/],
    [{ ...completed({}), output: [{ content: [{ type: 'refusal', refusal: 'No.' }] }] }, /declined/],
    [{ ...completed({}), output: [{ content: [{ type: 'output_text', text: 'not JSON' }] }] }, /invalid structured/],
    [{ ...completed({}), output: [] }, /invalid structured/],
  ];
  for (const [payload, pattern] of cases) {
    const { provider } = mockProvider(payload);
    await assert.rejects(provider.resolve('Question', []), pattern);
  }
});

test('structured-response failures preserve returned model and billed usage metadata', async () => {
  const { provider } = mockProvider({ ...completed({}), status: 'incomplete' });
  await assert.rejects(provider.resolve('Question', []), error => {
    assert.match(error.message, /did not complete/);
    assert.deepEqual(error.responseMetadata, { model: 'fake-model', usage: { output_tokens: 7 } });
    return true;
  });
});

test('incomplete responses explain recognized causes without exposing provider details', async () => {
  const cases = [
    ['max_output_tokens', 'OpenAI reached the output token limit before completing the response. Try a narrower question or increase the output token limit.'],
    ['content_filter', 'OpenAI stopped the response because of a content filter. Try rephrasing the question.'],
    ['private request content test-only-key', 'OpenAI did not complete the structured response.'],
  ];
  for (const [reason, message] of cases) {
    const { provider } = mockProvider({ ...completed({}), status: 'incomplete',
      incomplete_details: { reason, message: 'private request content test-only-key' } });
    await assert.rejects(provider.resolve('private request content', []), { message });
  }
});

test('HTTP errors give safe guidance without reading provider response bodies', async () => {
  for (const [status, message] of [
    [429, 'OpenAI request failed (HTTP 429): rate or quota limit reached. Retry later for rate limits; check API credits and spending limits for quota issues.'],
    [500, 'OpenAI responses request failed (HTTP 500).'],
  ]) {
    let bodyRead = false;
    const provider = new OpenAIProvider({ apiKey: 'test-only-key', fetchImpl: async () => ({
      ok: false, status, json: async () => { bodyRead = true; return { message: 'private request content' }; },
      text: async () => { bodyRead = true; return 'private request content'; },
    }) });
    await assert.rejects(provider.resolve('private request content', []), { message });
    assert.equal(bodyRead, false);
  }
});

test('transport exceptions and invalid JSON are redacted', async () => {
  const transport = new OpenAIProvider({ apiKey: 'test-only-key', fetchImpl: async () => {
    throw new Error('private request content test-only-key');
  } });
  await assert.rejects(transport.embed(['private request content']), {
    message: 'OpenAI request failed or timed out; check connectivity and retry.',
  });
  const malformed = new OpenAIProvider({ apiKey: 'test-only-key', fetchImpl: async () => ({
    ok: true, json: async () => { throw new Error('private response content'); },
  }) });
  await assert.rejects(malformed.resolve('Question', []), { message: 'OpenAI returned invalid JSON.' });
});

for (const stage of ['fetch', 'response body']) {
  test(`deadline aborts ${stage} without retries and the next request succeeds`, { timeout: 1000 }, async t => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', milliseconds => {
      assert.equal(milliseconds, 30_000);
      return timeout(5);
    });
    // AbortSignal deadlines are unref'ed; keep the event loop alive for this test.
    const keepAlive = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keepAlive));
    let attempts = 0;
    let expiredSignal;
    const value = { action: 'retrieve', query: 'annual leave', clarification: '' };
    const provider = new OpenAIProvider({ apiKey: 'test-only-key', fetchImpl: async (url, { signal }) => {
      attempts++;
      if (attempts > 1) return { ok: true, json: async () => completed(value) };
      expiredSignal = signal;
      const aborted = () => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      if (stage === 'fetch') return aborted();
      return { ok: true, json: aborted };
    } });
    await assert.rejects(provider.resolve('private request content', []), {
      message: 'OpenAI request failed or timed out; check connectivity and retry.',
    });
    assert.equal(expiredSignal.aborted, true);
    assert.equal(attempts, 1);
    assert.deepEqual((await provider.resolve('Retry', [])).value, value);
    assert.equal(attempts, 2);
  });
}
