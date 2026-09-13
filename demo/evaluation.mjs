import { checkScenario } from './scenario-checks.mjs';

export const EVALUATION_MODELS = ['gpt-5.6-terra', 'gpt-5.6-luna'];
export const EVALUATION_REPETITIONS = 3;
export const EVALUATION_COST_CEILING_USD = 2;
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EXPECTED_HELDOUT_DENOMINATORS = {
  conversations: 8, turns: 11, expectedAnswers: 9, expectedClarifications: 1,
  expectedAbstentions: 1, expectedSourcePairs: 12, followUps: 3,
};

export const PRICING = {
  effectiveDate: '2026-09-12',
  currency: 'USD',
  unit: 'per_1m_tokens',
  sources: {
    'gpt-5.6-terra': 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
    'gpt-5.6-luna': 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    'text-embedding-3-small': 'https://developers.openai.com/api/docs/models/text-embedding-3-small',
  },
  rates: {
    'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
    'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
    'text-embedding-3-small': { input: 0.02, cachedInput: 0.02, output: 0 },
  },
};

export function plannedDenominators(suite) {
  const turns = suite.cases.flatMap(testCase => testCase.turns);
  return {
    conversations: suite.cases.length,
    turns: turns.length,
    expectedAnswers: turns.filter(turn => turn.expected.status === 'answered').length,
    expectedClarifications: turns.filter(turn => turn.expected.status === 'clarify').length,
    expectedAbstentions: turns.filter(turn => turn.expected.status === 'insufficient_evidence').length,
    expectedSourcePairs: turns.reduce((sum, turn) => sum +
      new Set((turn.expected.facts ?? []).map(fact => fact.sourceId)).size, 0),
    followUps: suite.cases.reduce((sum, testCase) => sum + Math.max(0, testCase.turns.length - 1), 0),
  };
}

export function assertExpectedHeldoutDenominators(suite) {
  const actual = plannedDenominators(suite);
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_HELDOUT_DENOMINATORS)) {
    throw new Error('Held-out suite denominators differ from the approved frozen evaluation plan.');
  }
  return actual;
}

const normalizeText = text => String(text ?? '').replaceAll('’', "'")
  .replace(/\b(is|are|was|were|do|does|did|could|should|would|must)n't\b/gi, '$1 not')
  .replace(/\bcan't\b/gi, 'cannot').replace(/\bwon't\b/gi, 'will not');

function factChecks(test, result) {
  return (test.facts ?? []).map(fact => {
    const claims = (result.claims ?? []).filter(claim => claim.sourceId === fact.sourceId);
    const text = normalizeText(claims.map(claim => claim.text).join('\n'));
    return {
      sourceId: fact.sourceId,
      cited: (result.citations ?? []).some(citation => citation.id === fact.sourceId),
      patternsPassed: fact.patterns.every(pattern => pattern.test(text)),
    };
  });
}

function structuralClaimChecks(result) {
  const retrieved = new Map((result.retrieved ?? []).map(source => [source.id, source]));
  return (result.claims ?? []).map((claim, index) => ({
    index,
    sourceId: claim.sourceId,
    valid: typeof claim.text === 'string' && Boolean(claim.text.trim()) &&
      typeof claim.quote === 'string' && Boolean(claim.quote.trim()) &&
      Boolean(retrieved.get(claim.sourceId)?.text.includes(claim.quote)),
  }));
}

export function scoreTurn(test, result) {
  const expectedSourceIds = [...new Set((test.facts ?? []).map(fact => fact.sourceId))];
  const retrievedIds = (result.retrieved ?? []).map(source => source.id);
  const retrievalRanks = Object.fromEntries(expectedSourceIds.map(sourceId => {
    const index = retrievedIds.indexOf(sourceId);
    return [sourceId, index === -1 ? null : index + 1];
  }));
  const facts = factChecks(test, result);
  const structuralClaims = structuralClaimChecks(result);
  const failures = checkScenario(test, result);
  const citations = new Set((result.citations ?? []).map(citation => citation.id));
  const factsBySource = new Map(expectedSourceIds.map(sourceId => [sourceId,
    facts.filter(fact => fact.sourceId === sourceId)]));
  return {
    expectedSourceIds,
    retrievalRanks,
    factChecks: facts,
    structuralClaimChecks: structuralClaims,
    statusCorrect: result.status === test.status,
    expectedSourceCitationCoverage: expectedSourceIds.filter(sourceId => citations.has(sourceId)).length,
    expectedFactPatternCoverage: expectedSourceIds.filter(sourceId =>
      factsBySource.get(sourceId).every(fact => fact.patternsPassed)).length,
    rubricPassed: failures.length === 0,
    failures,
  };
}

export function scoreFailedTurn(test, kind, message) {
  const expectedSourceIds = [...new Set((test.facts ?? []).map(fact => fact.sourceId))];
  return {
    expectedSourceIds,
    retrievalRanks: Object.fromEntries(expectedSourceIds.map(sourceId => [sourceId, null])),
    factChecks: expectedSourceIds.map(sourceId => ({ sourceId, cited: false, patternsPassed: false })),
    structuralClaimChecks: [],
    statusCorrect: false,
    expectedSourceCitationCoverage: 0,
    expectedFactPatternCoverage: 0,
    rubricPassed: false,
    failures: [`${kind}: ${message}`],
  };
}

export function nearestRank(values, percentile) {
  if (!Array.isArray(values) || !values.length) return null;
  if (!(percentile > 0 && percentile <= 1)) throw new Error('Percentile must be greater than zero and no more than one.');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function latencySummary(values) {
  const finite = values.filter(Number.isFinite);
  return { n: finite.length, p50Ms: nearestRank(finite, 0.5), p95Ms: nearestRank(finite, 0.95) };
}

export function normalizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0),
    cachedInputTokens: Number(usage.cachedInputTokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? usage.total_tokens ?? 0),
  };
}

function addUsage(total, usage) {
  const normalized = normalizeUsage(usage);
  for (const key of Object.keys(total)) total[key] += normalized[key];
}

function usageCost(usage, rate) {
  const normalized = normalizeUsage(usage);
  const cached = Math.min(normalized.cachedInputTokens, normalized.inputTokens);
  const uncached = normalized.inputTokens - cached;
  return (uncached * rate.input + cached * rate.cachedInput + normalized.outputTokens * rate.output) / 1_000_000;
}

export function estimateUsageCost(usage, model, pricing = PRICING) {
  const rate = pricing.rates[model];
  if (!rate) throw new Error(`Missing pricing for ${model}.`);
  return usageCost(usage, rate);
}

export function summarizeRun({ results, index, generationModel, embeddingModel = EMBEDDING_MODEL, pricing = PRICING }) {
  const expectedAnswers = results.filter(result => result.expectedStatus === 'answered');
  const expectedNonAnswers = results.filter(result => result.expectedStatus !== 'answered');
  const expectedClarifications = results.filter(result => result.expectedStatus === 'clarify');
  const expectedAbstentions = results.filter(result => result.expectedStatus === 'insufficient_evidence');
  const followUps = results.filter(result => result.turnIndex > 0);
  const sourceDenominator = expectedAnswers.reduce((sum, result) => sum + result.automatic.expectedSourceIds.length, 0);
  const retrieval = {};
  for (const k of [1, 3, 6]) {
    const hits = expectedAnswers.filter(result =>
      Object.values(result.automatic.retrievalRanks).some(rank => rank !== null && rank <= k)).length;
    const recalled = expectedAnswers.reduce((sum, result) => sum +
      Object.values(result.automatic.retrievalRanks).filter(rank => rank !== null && rank <= k).length, 0);
    retrieval[`at${k}`] = {
      hit: { numerator: hits, denominator: expectedAnswers.length },
      recall: { numerator: recalled, denominator: sourceDenominator },
    };
  }

  const usage = {
    resolution: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
    queryEmbedding: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
    answer: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
    corpusEmbedding: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
  addUsage(usage.corpusEmbedding, index?.usage);
  for (const result of results) {
    if (result.stageEvents?.length) {
      for (const event of result.stageEvents) {
        if (event.status !== 'completed' && !event.usage) continue;
        if (event.stage === 'resolution') addUsage(usage.resolution, event.usage);
        if (event.stage === 'queryEmbedding') addUsage(usage.queryEmbedding, event.usage);
        if (event.stage === 'answer') addUsage(usage.answer, event.usage);
      }
    } else {
      addUsage(usage.resolution, result.usage?.resolution);
      addUsage(usage.queryEmbedding, result.usage?.embedding);
      addUsage(usage.answer, result.usage?.answer);
    }
  }
  const generationRate = pricing.rates[generationModel];
  const embeddingRate = pricing.rates[embeddingModel];
  if (!generationRate || !embeddingRate) throw new Error('Missing pricing for an evaluation model.');
  const cost = usageCost(usage.resolution, generationRate) + usageCost(usage.answer, generationRate) +
    usageCost(usage.queryEmbedding, embeddingRate) + usageCost(usage.corpusEmbedding, embeddingRate);

  const emittedClaims = results.flatMap(result => result.claims ?? []);
  const structuralClaims = results.flatMap(result => result.automatic.structuralClaimChecks);
  return {
    planned: {
      turns: results.length,
      expectedAnswers: expectedAnswers.length,
      expectedNonAnswers: expectedNonAnswers.length,
      expectedSourcePairs: sourceDenominator,
      followUps: followUps.length,
    },
    completed: results.filter(result => result.executionStatus === 'completed').length,
    errors: results.filter(result => result.executionStatus === 'error').length,
    blocked: results.filter(result => result.executionStatus === 'blocked').length,
    expectedStatus: {
      numerator: results.filter(result => result.automatic.statusCorrect).length,
      denominator: results.length,
    },
    automatedRubric: {
      label: 'Narrow pattern/source checks; not semantic accuracy',
      numerator: results.filter(result => result.automatic.rubricPassed).length,
      denominator: results.length,
    },
    retrieval,
    expectedSourceCitationCoverage: {
      numerator: expectedAnswers.reduce((sum, result) => sum + result.automatic.expectedSourceCitationCoverage, 0),
      denominator: sourceDenominator,
    },
    expectedFactPatternCoverage: {
      numerator: expectedAnswers.reduce((sum, result) => sum + result.automatic.expectedFactPatternCoverage, 0),
      denominator: sourceDenominator,
    },
    followUpRubric: {
      numerator: followUps.filter(result => result.automatic.rubricPassed).length,
      denominator: followUps.length,
    },
    clarification: {
      numerator: expectedClarifications.filter(result => result.status === 'clarify').length,
      denominator: expectedClarifications.length,
    },
    abstention: {
      numerator: expectedAbstentions.filter(result => result.status === 'insufficient_evidence').length,
      denominator: expectedAbstentions.length,
    },
    overAbstention: {
      numerator: expectedAnswers.filter(result => ['clarify', 'insufficient_evidence'].includes(result.status)).length,
      denominator: expectedAnswers.length,
    },
    inventedAnswer: {
      numerator: expectedNonAnswers.filter(result => result.status === 'answered').length,
      denominator: expectedNonAnswers.length,
    },
    structuralCitationIntegrity: {
      numerator: structuralClaims.filter(claim => claim.valid).length,
      denominator: emittedClaims.length,
    },
    latency: {
      attempt: latencySummary(results.map(result => result.attemptMs)),
      resolution: latencySummary(results.map(result => result.timings?.resolutionMs)),
      retrieval: latencySummary(results.map(result => result.timings?.retrievalMs)
        .filter(value => value !== 0)),
      answer: latencySummary(results.map(result => result.timings?.answerMs)
        .filter(value => value !== 0)),
      total: latencySummary(results.map(result => result.timings?.totalMs)),
      corpusEmbeddingMs: index?.embeddingMs ?? null,
      timeToFirstContent: { available: false, reason: 'The structured Responses calls are non-streaming.' },
    },
    usage,
    estimatedCost: {
      currency: pricing.currency,
      usd: Number(cost.toFixed(8)),
      pricingEffectiveDate: pricing.effectiveDate,
      providerBillingConfirmed: false,
      usageUnavailableForFailedCalls: results.reduce((sum, result) => sum +
        (result.stageEvents ?? []).filter(event => event.status === 'failed' && !event.usage).length, 0),
    },
    humanReview: { status: 'pending' },
  };
}
