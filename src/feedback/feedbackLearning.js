/**
 * Feedback Learning System
 *
 * Learns from user feedback to improve retrieval quality over time.
 * Features:
 * - Source quality scoring based on helpful/not-helpful ratings
 * - Query pattern learning for frequently successful searches
 * - Retrieval score adjustment using learned patterns
 * - Hybrid comment analysis (regex + LLM)
 *
 * This creates a continuous improvement loop where user feedback
 * directly influences future search results.
 *
 * @author Scott Anderson
 */

import 'dotenv/config';
import pg from 'pg';
import CommentScorer from './commentScorer.js';

const { Pool } = pg;

class FeedbackLearning {
  constructor(options = {}) {
    this.pool = new Pool({
      host: options.dbHost || process.env.DB_HOST,
      port: options.dbPort || process.env.DB_PORT || 5432,
      database: options.dbName || process.env.DB_DATABASE,
      user: options.dbUser || process.env.DB_USERNAME,
      password: options.dbPassword || process.env.DB_PASSWORD,
      ssl: options.ssl !== undefined ? options.ssl : false,
      max: options.maxConnections || 10
    });

    this.commentScorer = new CommentScorer(options.scorerOptions);
    this.initialized = false;

    // Configuration
    this.config = {
      // How much to weight not-helpful vs helpful
      notHelpfulMultiplier: options.notHelpfulMultiplier || 2.0,
      // How much feedback score affects retrieval
      feedbackAdjustmentFactor: options.feedbackAdjustmentFactor || 0.1,
      // Boost for pattern-matched queries
      patternMatchBoost: options.patternMatchBoost || 1.2,
      // Minimum weight threshold for tracking patterns
      patternWeightThreshold: options.patternWeightThreshold || 0.5
    };
  }

  /**
   * Initialize database connection and verify tables exist
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Test connection
      const client = await this.pool.connect();
      client.release();

      // Ensure tables exist
      await this.ensureTables();

      this.initialized = true;
      console.log('✅ Feedback learning system initialized');
    } catch (error) {
      console.error('Failed to initialize feedback learning:', error.message);
      throw error;
    }
  }

  /**
   * Create required database tables if they don't exist
   */
  async ensureTables() {
    const client = await this.pool.connect();

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS source_scores (
          source_key TEXT PRIMARY KEY,
          helpful INTEGER DEFAULT 0,
          not_helpful INTEGER DEFAULT 0,
          helpful_with_issues INTEGER DEFAULT 0,
          total INTEGER DEFAULT 0,
          score REAL DEFAULT 0,
          issue_types JSONB DEFAULT '{}',
          updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS query_patterns (
          pattern_key TEXT PRIMARY KEY,
          count INTEGER DEFAULT 0,
          sources JSONB DEFAULT '[]',
          updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS feedback_cache_meta (
          id INTEGER PRIMARY KEY DEFAULT 1,
          last_updated TIMESTAMP,
          sources_analyzed INTEGER DEFAULT 0,
          patterns_identified INTEGER DEFAULT 0,
          total_feedback INTEGER DEFAULT 0,
          llm_analyzed INTEGER DEFAULT 0
        );

        INSERT INTO feedback_cache_meta (id) VALUES (1)
        ON CONFLICT (id) DO NOTHING;
      `);
    } finally {
      client.release();
    }
  }

  /**
   * Process feedback data and update learning tables
   * @param {Array} feedbackData - Array of feedback objects
   */
  async analyzeFeedback(feedbackData) {
    await this.initialize();

    console.log(`📊 Analyzing ${feedbackData.length} feedback entries...`);

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Clear existing analysis for fresh rebuild
      await client.query('DELETE FROM source_scores');
      await client.query('DELETE FROM query_patterns');

      const sourceScores = {};
      const queryPatterns = {};
      let llmCallCount = 0;

      // Process each feedback entry
      for (const feedback of feedbackData) {
        if (!feedback.sources || !feedback.rating) continue;

        // Score the feedback using hybrid approach
        const scoreResult = await this.commentScorer.smartScore(feedback);
        if (scoreResult.needsLLM) llmCallCount++;

        // Update source scores
        for (const source of feedback.sources) {
          const sourceKey = source.sourceFile || source.url || source.id;
          if (!sourceKey) continue;

          if (!sourceScores[sourceKey]) {
            sourceScores[sourceKey] = {
              helpful: 0,
              notHelpful: 0,
              helpfulWithIssues: 0,
              total: 0,
              issueTypes: {}
            };
          }

          sourceScores[sourceKey].total++;

          if (feedback.rating === 'helpful') {
            if (scoreResult.adjustedRating === 'helpful_with_issues') {
              sourceScores[sourceKey].helpfulWithIssues++;
              sourceScores[sourceKey].helpful += scoreResult.weight;

              // Track issue types for this source
              scoreResult.issues.forEach(issue => {
                if (!sourceScores[sourceKey].issueTypes[issue]) {
                  sourceScores[sourceKey].issueTypes[issue] = 0;
                }
                sourceScores[sourceKey].issueTypes[issue]++;
              });
            } else {
              sourceScores[sourceKey].helpful++;
            }
          } else if (feedback.rating === 'not-helpful') {
            sourceScores[sourceKey].notHelpful++;
          }
        }

        // Track successful query patterns
        if (feedback.rating === 'helpful' &&
            scoreResult.weight > this.config.patternWeightThreshold &&
            feedback.question) {
          const queryKey = this.normalizeQuery(feedback.question);

          if (!queryPatterns[queryKey]) {
            queryPatterns[queryKey] = {
              count: 0,
              sources: []
            };
          }

          queryPatterns[queryKey].count++;

          // Track which sources worked for this query pattern
          feedback.sources.forEach(source => {
            const sourceKey = source.sourceFile || source.url || source.id;
            if (sourceKey && !queryPatterns[queryKey].sources.includes(sourceKey)) {
              queryPatterns[queryKey].sources.push(sourceKey);
            }
          });
        }
      }

      // Persist source scores
      for (const [sourceKey, stats] of Object.entries(sourceScores)) {
        // Score formula: helpful - (notHelpful * multiplier) / total
        const score = (stats.helpful - (stats.notHelpful * this.config.notHelpfulMultiplier)) /
                      Math.max(stats.total, 1);

        await client.query(
          `INSERT INTO source_scores
           (source_key, helpful, not_helpful, helpful_with_issues, total, score, issue_types, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (source_key)
           DO UPDATE SET
             helpful = $2,
             not_helpful = $3,
             helpful_with_issues = $4,
             total = $5,
             score = $6,
             issue_types = $7,
             updated_at = NOW()`,
          [
            sourceKey,
            Math.round(stats.helpful), // Round weighted helpful count
            stats.notHelpful,
            stats.helpfulWithIssues,
            stats.total,
            score,
            JSON.stringify(stats.issueTypes)
          ]
        );
      }

      // Persist query patterns
      for (const [patternKey, data] of Object.entries(queryPatterns)) {
        await client.query(
          `INSERT INTO query_patterns (pattern_key, count, sources, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (pattern_key)
           DO UPDATE SET count = $2, sources = $3, updated_at = NOW()`,
          [patternKey, data.count, JSON.stringify(data.sources)]
        );
      }

      // Update metadata
      await client.query(
        `UPDATE feedback_cache_meta SET
         last_updated = NOW(),
         sources_analyzed = $1,
         patterns_identified = $2,
         total_feedback = $3,
         llm_analyzed = $4
         WHERE id = 1`,
        [
          Object.keys(sourceScores).length,
          Object.keys(queryPatterns).length,
          feedbackData.length,
          llmCallCount
        ]
      );

      await client.query('COMMIT');

      const result = {
        sourcesAnalyzed: Object.keys(sourceScores).length,
        patternsIdentified: Object.keys(queryPatterns).length,
        totalFeedback: feedbackData.length,
        llmAnalyzed: llmCallCount,
        lastUpdated: new Date().toISOString()
      };

      if (llmCallCount > 0) {
        console.log(`🤖 Used LLM for ${llmCallCount} ambiguous comments`);
      }

      console.log(`✅ Analysis complete: ${result.sourcesAnalyzed} sources, ${result.patternsIdentified} patterns`);

      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Normalize query for pattern matching
   * Removes punctuation, sorts words for order-independent matching
   */
  normalizeQuery(query) {
    return query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .sort()
      .join(' ');
  }

  /**
   * Adjust retrieval scores based on learned feedback
   * Call this after initial retrieval to re-rank results
   */
  async adjustRetrievalScores(results, query) {
    await this.initialize();

    const client = await this.pool.connect();

    try {
      // Load source scores
      const sourceScoresResult = await client.query(
        'SELECT source_key, score FROM source_scores'
      );

      const sourceScoresMap = {};
      sourceScoresResult.rows.forEach(row => {
        sourceScoresMap[row.source_key] = parseFloat(row.score);
      });

      // Adjust each result's score
      const adjustedResults = results.map(result => {
        const sourceKey = result.metadata?.sourceFile ||
                         result.metadata?.source ||
                         result.metadata?.url;

        if (sourceKey && sourceScoresMap[sourceKey] !== undefined) {
          const adjustment = sourceScoresMap[sourceKey] * this.config.feedbackAdjustmentFactor;
          result.adjustedScore = result.score * (1 + adjustment);
          result.feedbackAdjustment = adjustment;
        } else {
          result.adjustedScore = result.score;
        }

        return result;
      });

      // Check for query pattern matches
      const normalizedQuery = this.normalizeQuery(query);
      const patternResult = await client.query(
        'SELECT sources FROM query_patterns WHERE pattern_key = $1',
        [normalizedQuery]
      );

      if (patternResult.rows.length > 0) {
        const sources = patternResult.rows[0].sources;
        const patternSources = typeof sources === 'string' ? JSON.parse(sources) : sources;

        // Boost results that match known successful patterns
        adjustedResults.forEach(result => {
          const sourceKey = result.metadata?.sourceFile ||
                           result.metadata?.source ||
                           result.metadata?.url;

          if (sourceKey && patternSources.includes(sourceKey)) {
            result.adjustedScore *= this.config.patternMatchBoost;
            result.patternMatch = true;
          }
        });
      }

      // Re-sort by adjusted score
      return adjustedResults.sort((a, b) => b.adjustedScore - a.adjustedScore);
    } finally {
      client.release();
    }
  }

  /**
   * Increment feedback for a single source (real-time updates)
   */
  async recordFeedback(sourceKey, rating, issues = []) {
    await this.initialize();

    const client = await this.pool.connect();

    try {
      const isHelpful = rating === 'helpful';
      const hasIssues = issues.length > 0;

      await client.query(`
        INSERT INTO source_scores
        (source_key, helpful, not_helpful, helpful_with_issues, total, updated_at)
        VALUES ($1, $2, $3, $4, 1, NOW())
        ON CONFLICT (source_key)
        DO UPDATE SET
          helpful = source_scores.helpful + $2,
          not_helpful = source_scores.not_helpful + $3,
          helpful_with_issues = source_scores.helpful_with_issues + $4,
          total = source_scores.total + 1,
          score = (source_scores.helpful + $2 - (source_scores.not_helpful + $3) * $5) /
                  GREATEST(source_scores.total + 1, 1),
          updated_at = NOW()
      `, [
        sourceKey,
        isHelpful && !hasIssues ? 1 : (hasIssues ? 0.7 : 0),
        isHelpful ? 0 : 1,
        hasIssues ? 1 : 0,
        this.config.notHelpfulMultiplier
      ]);

      return true;
    } finally {
      client.release();
    }
  }

  /**
   * Get comprehensive report on source performance
   */
  async getSourceReport() {
    await this.initialize();

    const client = await this.pool.connect();

    try {
      const result = await client.query(`
        SELECT
          source_key as source,
          helpful,
          not_helpful,
          helpful_with_issues,
          total,
          score,
          issue_types,
          CASE
            WHEN total > 0 THEN ROUND((helpful::decimal / total * 100), 1)
            ELSE 0
          END as helpful_rate
        FROM source_scores
        ORDER BY score DESC
      `);

      return {
        topPerformers: result.rows.filter(s => s.score > 0).slice(0, 10),
        lowPerformers: result.rows.filter(s => s.score < -0.5).slice(0, 5),
        needsReview: result.rows.filter(s => {
          const issues = typeof s.issue_types === 'string' ?
                        JSON.parse(s.issue_types) : s.issue_types;
          return Object.keys(issues).length > 0;
        }),
        allSources: result.rows
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get successful query patterns
   */
  async getQueryPatterns(limit = 20) {
    await this.initialize();

    const client = await this.pool.connect();

    try {
      const result = await client.query(`
        SELECT
          pattern_key as pattern,
          count as success_count,
          sources as top_sources
        FROM query_patterns
        ORDER BY count DESC
        LIMIT $1
      `, [limit]);

      return result.rows.map(row => ({
        pattern: row.pattern,
        successCount: row.success_count,
        topSources: (typeof row.top_sources === 'string' ?
                    JSON.parse(row.top_sources) : row.top_sources).slice(0, 5)
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get system metadata and statistics
   */
  async getMetadata() {
    await this.initialize();

    const client = await this.pool.connect();

    try {
      const result = await client.query(
        'SELECT * FROM feedback_cache_meta WHERE id = 1'
      );

      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  /**
   * Close database connections
   */
  async close() {
    await this.pool.end();
  }
}

/**
 * CLI interface for running feedback analysis
 */
async function runCLI() {
  console.log('\n📊 Feedback Learning System');
  console.log('='.repeat(50));

  const system = new FeedbackLearning();

  try {
    // This would typically load from your feedback source
    // For demo, we show the report structure
    console.log('\nTo use this system:');
    console.log('1. Load feedback data from your source (API, database, sheets)');
    console.log('2. Call analyzeFeedback(feedbackArray)');
    console.log('3. Use adjustRetrievalScores() during retrieval');
    console.log('\nExample:');
    console.log(`
const system = new FeedbackLearning();
await system.analyzeFeedback(feedbackData);
const adjustedResults = await system.adjustRetrievalScores(results, query);
`);

    const metadata = await system.getMetadata();
    if (metadata && metadata.total_feedback > 0) {
      console.log('\nCurrent Statistics:');
      console.log(`  Sources analyzed: ${metadata.sources_analyzed}`);
      console.log(`  Patterns identified: ${metadata.patterns_identified}`);
      console.log(`  Total feedback: ${metadata.total_feedback}`);
      console.log(`  Last updated: ${metadata.last_updated}`);
    }

    await system.close();
  } catch (error) {
    console.error('Error:', error.message);
    await system.close();
    process.exit(1);
  }
}

// Run CLI if called directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runCLI();
}

export default FeedbackLearning;
