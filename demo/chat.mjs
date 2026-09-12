export function validateAnswer(value, matches) {
  if (!value || !['answered', 'insufficient_evidence'].includes(value.status) || !Array.isArray(value.claims)) {
    throw new Error('Invalid answer structure.');
  }
  if (value.status === 'insufficient_evidence') {
    if (value.claims.length) throw new Error('Insufficient-evidence response contains claims.');
    return { status: value.status, answer: 'The retrieved documents do not provide enough evidence to answer that question.', citations: [] };
  }
  if (!value.claims.length) throw new Error('An answered response must include supported claims.');
  const citations = value.claims.map(claim => {
    const source = matches.find(match => match.id === claim.sourceId);
    if (!source || typeof claim.text !== 'string' || !claim.text.trim() ||
      typeof claim.quote !== 'string' || !claim.quote.trim() || !source.text.includes(claim.quote)) {
      throw new Error('Citation validation failed: source or exact evidence quote is invalid.');
    }
    return { id: source.id, file: source.file, section: source.section, line: source.line, quote: claim.quote };
  });
  return { status: 'answered', answer: value.claims.map((claim, i) => `${claim.text} [${i + 1}]`).join('\n'), citations };
}

export class Conversation {
  constructor({ provider, retriever }) {
    this.provider = provider;
    this.retriever = retriever;
    this.history = [];
    this.busy = false;
  }

  async send(question) {
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
      throw new Error('Enter a question between 1 and 2000 characters.');
    }
    if (this.busy) throw new Error('Wait for the current turn before sending another question.');
    this.busy = true;
    try {
      const start = performance.now();
      const resolution = await this.provider.resolve(question.trim(), structuredClone(this.history));
      const timings = { resolutionMs: performance.now() - start, retrievalMs: 0, answerMs: 0 };
      const usage = { resolution: resolution.usage };
      let result;
      if (resolution.value?.action === 'clarify' && resolution.value.clarification?.trim()) {
        result = { status: 'clarify', answer: resolution.value.clarification, query: '', citations: [], retrieved: [] };
      } else if (resolution.value?.action === 'retrieve' && resolution.value.query?.trim()) {
        const retrievalStart = performance.now();
        const retrieval = await this.retriever.retrieve(resolution.value.query);
        timings.retrievalMs = performance.now() - retrievalStart;
        usage.embedding = retrieval.usage;
        const answerStart = performance.now();
        const generated = await this.provider.answer(resolution.value.query, retrieval.matches);
        result = { ...validateAnswer(generated.value, retrieval.matches), query: resolution.value.query,
          retrieved: retrieval.matches, model: generated.model };
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
