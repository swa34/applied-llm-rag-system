/**
 * Hybrid Search with LLM Re-ranking
 *
 * This module implements advanced retrieval techniques for RAG systems:
 * - Hybrid search combining dense (semantic) and sparse (keyword) vectors
 * - LLM-based re-ranking for uncertain results
 * - Metadata filtering based on query intent
 * - Feedback-adjusted scoring
 *
 * Production considerations:
 * - Graceful fallbacks when re-ranking fails
 * - Configurable thresholds via environment
 * - Support for multiple LLM providers (GPT-4, GPT-5)
 * - Performance timing and debugging
 *
 * @author Scott Anderson
 */

import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEBUG_RAG = process.env.DEBUG_RAG === 'true';

// ============================================================================
// SPARSE VECTOR GENERATION
// ============================================================================

/**
 * Creates a sparse vector from text for keyword matching.
 *
 * Sparse vectors complement dense (embedding) vectors by capturing
 * exact keyword matches that semantic search might miss.
 *
 * NOTE: This is a simplified demonstration tokenizer. For production,
 * use a dedicated library like '@pinecone-database/sparse-vector-encoder'
 * with a fixed vocabulary.
 *
 * @param {string} text - The input text
 * @returns {{indices: number[], values: number[]}} Pinecone sparse vector
 */
export function createSparseVector(text) {
  if (!text) {
    return { indices: [], values: [] };
  }

  const termFrequencies = new Map();

  // Simple tokenization: lowercase, extract words 3+ chars
  const tokens = text.toLowerCase().match(/\b\w{3,}\b/g) || [];

  tokens.forEach(token => {
    termFrequencies.set(token, (termFrequencies.get(token) || 0) + 1);
  });

  // Map tokens to indices using hash (production: use fixed vocabulary)
  const indices = [];
  const values = [];

  for (const [term, freq] of termFrequencies.entries()) {
    let hash = 0;
    for (let i = 0; i < term.length; i++) {
      hash = (hash << 5) - hash + term.charCodeAt(i);
      hash |= 0; // Convert to 32-bit integer
    }
    indices.push(Math.abs(hash));
    values.push(freq);
  }

  // Sort by index (required by Pinecone)
  const sortedPairs = indices
    .map((index, i) => ({ index, value: values[i] }))
    .sort((a, b) => a.index - b.index);

  // Remove duplicates from hash collisions
  const uniquePairs = [];
  const seenIndices = new Set();
  for (const pair of sortedPairs) {
    if (!seenIndices.has(pair.index)) {
      uniquePairs.push(pair);
      seenIndices.add(pair.index);
    }
  }

  return {
    indices: uniquePairs.map(p => p.index),
    values: uniquePairs.map(p => p.value),
  };
}

// ============================================================================
// LLM RE-RANKING
// ============================================================================

// Configuration
const ENABLE_LLM_RERANKING = process.env.ENABLE_LLM_RERANKING !== 'false';
const RERANK_SCORE_THRESHOLD = parseFloat(process.env.RERANK_SCORE_THRESHOLD || '0.05');
const RERANK_MODEL = process.env.RERANK_MODEL || 'gpt-4o-mini';

/**
 * LLM-based re-ranker for uncertain retrieval results.
 *
 * Only called when vector scores are too similar to confidently rank.
 * Uses a fast, cheap model (gpt-4o-mini by default) for cost efficiency.
 *
 * @param {Array} matches - Retrieved document matches
 * @param {string} query - User's query
 * @returns {Array} Re-ordered matches
 */
export async function llmRerank(matches, query) {
  if (!matches || matches.length <= 2) {
    return matches; // Not enough to re-rank
  }

  try {
    const isGPT5Model = RERANK_MODEL?.startsWith('gpt-5');

    // Build prompt with truncated passages
    const passagesText = matches
      .map((m, i) => {
        const text = m.metadata?.text || '';
        const preview = text.length > 400 ? text.substring(0, 400) + '...' : text;
        const source = m.metadata?.sourceFile || m.metadata?.url || 'Unknown';
        return `[${i}] Source: ${source}\nContent: ${preview}`;
      })
      .join('\n\n');

    const prompt = `You are a relevance ranking expert. Rank the passages by relevance to the question.
Return ONLY the indices in descending order${isGPT5Model ? ' as a JSON array: {"indices": [5,0,3,2,1]}' : ', comma-separated'}. No explanation.

Question: "${query}"

Passages:
${passagesText}`;

    let rankingText;

    if (isGPT5Model) {
      // Use Responses API for GPT-5 models
      const response = await openai.responses.create({
        model: RERANK_MODEL,
        input: prompt,
        reasoning: { effort: 'minimal' },
        text: {
          verbosity: 'low',
          format: { type: 'json_object' }
        },
        max_output_tokens: 50
      });

      const output = response.output_text || response.output[0].content[0].text;
      const parsed = JSON.parse(output);
      rankingText = parsed.indices.join(',');
    } else {
      // Use Chat Completions API for older models
      const response = await openai.chat.completions.create({
        model: RERANK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 50,
      });
      rankingText = response.choices[0].message.content.trim();
    }

    // Parse ranking (e.g., "3,0,5,1,2")
    const indices = rankingText
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 0 && n < matches.length);

    // Include any indices the LLM missed
    const missingIndices = matches
      .map((_, i) => i)
      .filter(i => !indices.includes(i));
    const completeIndices = [...indices, ...missingIndices];

    // Reorder matches
    const reranked = completeIndices.map(i => matches[i]).filter(Boolean);

    if (DEBUG_RAG) {
      console.log('LLM Re-ranking applied:', {
        originalOrder: matches.slice(0, 5).map((m, i) => ({
          index: i,
          score: m.adjustedScore || m.score
        })),
        newOrder: reranked.slice(0, 5).map((m, i) => ({
          index: i,
          score: m.adjustedScore || m.score,
          source: m.metadata?.sourceFile || 'Unknown'
        })),
        llmRanking: rankingText
      });
    }

    return reranked;
  } catch (error) {
    console.error('LLM re-ranking failed, using original order:', error.message);
    return matches; // Graceful fallback
  }
}

/**
 * Determine if query needs LLM re-ranking.
 *
 * Triggers on:
 * 1. Uncertain results (top scores too similar)
 * 2. Temporal queries ("latest", "most recent")
 * 3. Comparison queries ("difference", "compare")
 *
 * @param {string} query - User's query
 * @param {Array} matches - Retrieved matches
 * @returns {{should: boolean, reason: string}} Decision and reason
 */
export function shouldTriggerReranking(query, matches) {
  if (!ENABLE_LLM_RERANKING || matches.length < 3) {
    return { should: false, reason: 'disabled or too few results' };
  }

  // Check 1: Top scores too similar (uncertainty)
  const scores = matches.slice(0, 3).map(m => m.adjustedScore || m.score);
  const topScore = scores[0] || 0;
  const thirdScore = scores[2] || 0;
  const scoreSpread = topScore - thirdScore;

  if (scoreSpread < RERANK_SCORE_THRESHOLD) {
    return {
      should: true,
      reason: `uncertain (top 3 scores within ${scoreSpread.toFixed(3)})`,
      scoreSpread
    };
  }

  // Check 2: Temporal keywords
  const temporalKeywords = ['latest', 'most recent', 'current', 'newest', 'up to date', 'now'];
  const queryLower = query.toLowerCase();
  if (temporalKeywords.some(kw => queryLower.includes(kw))) {
    return {
      should: true,
      reason: 'temporal query detected',
      keywords: temporalKeywords.filter(kw => queryLower.includes(kw))
    };
  }

  // Check 3: Comparison queries
  const comparisonKeywords = ['difference', 'compare', 'versus', 'vs', 'better than'];
  if (comparisonKeywords.some(kw => queryLower.includes(kw))) {
    return {
      should: true,
      reason: 'comparison query detected',
      keywords: comparisonKeywords.filter(kw => queryLower.includes(kw))
    };
  }

  return { should: false, reason: 'confident ranking' };
}

// ============================================================================
// METADATA FILTERING
// ============================================================================

/**
 * Detect metadata filters from query keywords.
 *
 * Analyzes query to determine if specific content types are mentioned,
 * then returns appropriate Pinecone filter object.
 *
 * @param {string} query - User's query
 * @returns {{filter: Object|null, reason: string}} Filter and detection reason
 */
export function detectMetadataFilters(query) {
  const queryLower = query.toLowerCase();

  // Category mappings based on query content
  const categoryMappings = {
    'policy': { category: { $in: ['policies', 'procedures'] }, priority: { $gte: 7 } },
    'policies': { category: { $in: ['policies', 'procedures'] }, priority: { $gte: 7 } },
    'help': { category: { $in: ['documentation', 'help'] } },
    'training': { category: { $in: ['training', 'tutorials'] } },
    'guide': { category: { $in: ['documentation', 'guides'] } },
    'faq': { category: 'faq' },
  };

  // Check for category matches
  for (const [keyword, filter] of Object.entries(categoryMappings)) {
    if (queryLower.includes(keyword)) {
      return { filter, reason: `Detected '${keyword}' -> filtering by category` };
    }
  }

  // Source type filters
  if (queryLower.includes('document') || queryLower.includes('pdf')) {
    return {
      filter: { sourceType: { $in: ['document', 'pdf'] } },
      reason: 'Document-specific query -> filtering by sourceType'
    };
  }

  return { filter: null, reason: 'No specific content type detected' };
}

// ============================================================================
// DATE EXTRACTION
// ============================================================================

/**
 * Extract date from filename or source metadata.
 *
 * Useful for boosting more recent documents in results.
 *
 * @param {string} source - Source filename or path
 * @returns {Date|null} Extracted date or null
 */
export function extractDateFromSource(source) {
  if (!source) return null;

  const patterns = [
    /\b(202[0-9])\b/,                                    // Year only
    /(\d{2})\.(\d{2})\.(\d{2,4})/,                       // MM.DD.YY
    /(\d{2})-(\d{2})-(\d{2,4})/,                         // MM-DD-YY
    /(\d{4})-(\d{2})-(\d{2})/,                           // YYYY-MM-DD
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,  // Month Year
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      // Year-only pattern
      if (match[0].length === 4 && /^\d{4}$/.test(match[0])) {
        return new Date(parseInt(match[0]), 0, 1);
      }
      // Other patterns - simplified parsing
      try {
        const date = new Date(match[0]);
        if (!isNaN(date.getTime())) {
          return date;
        }
      } catch {
        // Continue to next pattern
      }
    }
  }

  return null;
}

// ============================================================================
// MAIN RETRIEVAL FUNCTION
// ============================================================================

/**
 * Retrieve relevant document chunks using hybrid search.
 *
 * This is the main entry point for RAG retrieval. It:
 * 1. Generates dense (embedding) and sparse (keyword) vectors
 * 2. Queries the vector database with hybrid search
 * 3. Applies feedback-based score adjustments
 * 4. Triggers LLM re-ranking when results are uncertain
 * 5. Returns ranked matches with metadata
 *
 * @param {string} userQuestion - The user's question
 * @param {Object} options - Configuration options
 * @param {number} options.topK - Number of results to return (default: 8)
 * @param {Object} options.vectorIndex - Pinecone index namespace
 * @param {Object} options.feedbackLearning - Feedback adjustment service
 * @param {string} options.embeddingModel - Model for embeddings
 * @returns {Object} Results with matches and metadata
 */
export async function retrieveRelevantChunks(userQuestion, options = {}) {
  const {
    topK = 8,
    vectorIndex,
    feedbackLearning,
    embeddingModel = 'text-embedding-3-large'
  } = options;

  const startTime = Date.now();
  const timings = {};

  // Generate dense vector (embedding)
  timings.embeddingStart = Date.now();
  const embedRes = await openai.embeddings.create({
    model: embeddingModel,
    input: userQuestion,
  });
  const queryVector = embedRes.data[0].embedding;
  timings.embedding = Date.now() - timings.embeddingStart;

  // Generate sparse vector for keyword matching
  const querySparseVector = createSparseVector(userQuestion);

  // Detect metadata filters
  const filterDetection = detectMetadataFilters(userQuestion);

  // Build query options for hybrid search
  const queryOptions = {
    vector: queryVector,           // Dense vector for semantic meaning
    sparseVector: querySparseVector, // Sparse vector for keyword matching
    topK,
    includeMetadata: true,
    alpha: 0.5  // Balance: 1.0 = pure dense, 0.0 = pure sparse
  };

  // Apply metadata filter if detected
  if (filterDetection.filter) {
    queryOptions.filter = filterDetection.filter;
    console.log(`Metadata filter applied: ${filterDetection.reason}`);
  }

  // Execute hybrid search
  timings.queryStart = Date.now();
  const result = await vectorIndex.query(queryOptions);
  timings.pineconeQuery = Date.now() - timings.queryStart;

  let matches = result.matches ?? [];

  // Add date extraction to each match
  matches = matches.map(match => {
    const source = match.metadata?.sourceFile || match.metadata?.source || '';
    const extractedDate = extractDateFromSource(source);
    return {
      ...match,
      extractedDate,
      dateValue: extractedDate ? extractedDate.getTime() : 0
    };
  });

  // Apply feedback-based score adjustments
  timings.feedbackStart = Date.now();
  let adjustedMatches = matches;
  if (feedbackLearning) {
    adjustedMatches = await feedbackLearning.adjustRetrievalScores(matches, userQuestion);
  }
  timings.feedbackAdjustment = Date.now() - timings.feedbackStart;

  // Sort by adjusted score, then by date for similar scores
  adjustedMatches.sort((a, b) => {
    const scoreA = a.adjustedScore || a.score;
    const scoreB = b.adjustedScore || b.score;

    // If scores very similar, prioritize by date
    if (Math.abs(scoreA - scoreB) < 0.02) {
      return b.dateValue - a.dateValue;
    }
    return scoreB - scoreA;
  });

  // Check thresholds
  const threshold = Number(process.env.MIN_SIMILARITY || 0.75);
  const topScore = adjustedMatches[0]?.adjustedScore || adjustedMatches[0]?.score || 0;
  const belowThreshold = adjustedMatches.length === 0 || topScore < threshold;

  // Check if LLM re-ranking should be triggered
  const rerankCheck = shouldTriggerReranking(userQuestion, adjustedMatches);
  let finalMatches = adjustedMatches;
  let rerankingApplied = false;

  if (rerankCheck.should) {
    console.log(`Triggering LLM re-ranking: ${rerankCheck.reason} (model: ${RERANK_MODEL})`);
    timings.rerankStart = Date.now();
    finalMatches = await llmRerank(adjustedMatches, userQuestion);
    timings.reranking = Date.now() - timings.rerankStart;
    rerankingApplied = true;
  }

  // Log performance
  const totalTime = Date.now() - startTime;
  console.log('Retrieval Performance:', {
    embedding: `${timings.embedding}ms`,
    pineconeQuery: `${timings.pineconeQuery}ms`,
    feedbackAdjustment: `${timings.feedbackAdjustment}ms`,
    reranking: timings.reranking ? `${timings.reranking}ms` : 'N/A',
    total: `${totalTime}ms`,
    matchesFound: matches.length,
    rerankingApplied
  });

  if (DEBUG_RAG) {
    console.log('--- RAG DEBUG ---');
    console.log('Question:', userQuestion);
    console.log('Metadata filter:', filterDetection.reason);
    console.log('Top score:', topScore, 'Threshold:', threshold);
    console.log('Re-ranking:', rerankCheck);
    console.log('Matches:', finalMatches.map(m => ({
      originalScore: m.score,
      adjustedScore: m.adjustedScore || m.score,
      source: m.metadata?.sourceFile || 'Unknown',
    })));
    console.log('-----------------');
  }

  return {
    matches: finalMatches,
    belowThreshold,
    topScore,
    rerankingApplied,
    metadataFilterApplied: !!filterDetection.filter,
    timings
  };
}

export default {
  retrieveRelevantChunks,
  createSparseVector,
  llmRerank,
  shouldTriggerReranking,
  detectMetadataFilters,
  extractDateFromSource
};
