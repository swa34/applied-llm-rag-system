export function validateAnswer(value, matches) {
  if (!value || !['answered', 'insufficient_evidence'].includes(value.status) || !Array.isArray(value.claims)) {
    throw new Error('Invalid answer structure.');
  }
  if (value.status === 'insufficient_evidence') {
    if (value.claims.length) throw new Error('Insufficient-evidence response contains claims.');
    return { status: value.status, answer: 'The retrieved documents do not provide enough evidence to answer that question.', claims: [], citations: [] };
  }
  if (!value.claims.length) throw new Error('An answered response must include supported claims.');
  const citations = [];
  const claims = value.claims.map(claim => {
    const source = matches.find(match => match.id === claim.sourceId);
    if (!source || typeof claim.text !== 'string' || !claim.text.trim() ||
      typeof claim.quote !== 'string' || !claim.quote.trim() || !source.text.includes(claim.quote)) {
      throw new Error('Citation validation failed: source or exact evidence quote is invalid.');
    }
    let index = citations.findIndex(citation => citation.id === source.id);
    if (index === -1) {
      index = citations.length;
      citations.push({ id: source.id, file: source.file, section: source.section, line: source.line, quotes: [] });
    }
    if (!citations[index].quotes.includes(claim.quote)) citations[index].quotes.push(claim.quote);
    return { text: claim.text, sourceId: source.id, quote: claim.quote, citation: index + 1 };
  });
  return { status: 'answered', answer: claims.map(claim => `${claim.text} [${claim.citation}]`).join('\n'), claims, citations };
}

export class Conversation {
  constructor({ provider, retriever, observeStage = () => {} }) {
    this.provider = provider;
    this.retriever = retriever;
    this.observeStage = observeStage;
    this.history = [];
    this.busy = false;
  }

  async runStage(stage, operation) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const result = await operation();
      try {
        this.observeStage({ stage, status: 'completed', startedAt, completedAt: new Date().toISOString(),
          durationMs: performance.now() - started, returnedModel: result?.model ?? null,
          usage: result?.usage ?? null });
      } catch {}
      return result;
    } catch (error) {
      try {
        this.observeStage({ stage, status: 'failed', startedAt, completedAt: new Date().toISOString(),
          durationMs: performance.now() - started, returnedModel: error.responseMetadata?.model ?? null,
          usage: error.responseMetadata?.usage ?? null });
      } catch {}
      throw error;
    }
  }

  async send(question) {
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
      throw new Error('Enter a question between 1 and 2000 characters.');
    }
    if (this.busy) throw new Error('Wait for the current turn before sending another question.');
    this.busy = true;
    try {
      const start = performance.now();
      const resolution = await this.runStage('resolution', () =>
        this.provider.resolve(question.trim(), structuredClone(this.history)));
      const timings = { resolutionMs: performance.now() - start, retrievalMs: 0, answerMs: 0 };
      const usage = { resolution: resolution.usage };
      let result;
      if (resolution.value?.action === 'clarify' && resolution.value.clarification?.trim()) {
        result = { status: 'clarify', answer: resolution.value.clarification, query: '', claims: [], citations: [], retrieved: [] };
      } else if (resolution.value?.action === 'retrieve' && resolution.value.query?.trim()) {
        const retrievalStart = performance.now();
        const retrieval = await this.runStage('queryEmbedding', () => this.retriever.retrieve(resolution.value.query));
        timings.retrievalMs = performance.now() - retrievalStart;
        usage.embedding = retrieval.usage;
        const answerStart = performance.now();
        const generated = await this.runStage('answer', () => this.provider.answer(resolution.value.query, retrieval.matches));
        result = { ...validateAnswer(generated.value, retrieval.matches), query: resolution.value.query,
          retrieved: retrieval.matches, model: generated.model, embeddingModel: retrieval.model };
        timings.answerMs = performance.now() - answerStart;
        usage.answer = generated.usage;
      } else throw new Error('Invalid context resolution.');
      timings.totalMs = performance.now() - start;
      // Only completed turns enter history; failures leave the previous context intact.
      this.history.push({ question: question.trim(), resolvedQuery: result.query, answer: result.answer, status: result.status });
      this.history = this.history.slice(-6);
      return { ...result, question: question.trim(), timings, usage, resolutionModel: resolution.model };
    } finally {
      this.busy = false;
    }
  }
}
