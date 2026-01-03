/**
 * Hybrid Comment Scorer
 *
 * Analyzes user feedback comments to detect issues that might not be
 * reflected in simple helpful/not-helpful ratings. Uses a hybrid approach:
 * 1. Fast regex patterns for clear-cut cases
 * 2. LLM analysis for ambiguous comments
 *
 * This reduces LLM API costs by 60-80% while maintaining accuracy.
 *
 * @author Scott Allen
 */

import 'dotenv/config';
import OpenAI from 'openai';

class CommentScorer {
  constructor(options = {}) {
    this.openai = new OpenAI({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY
    });
    this.model = options.model || 'gpt-4o-mini';

    // Cache to avoid re-analyzing identical comments
    this.cache = new Map();
    this.maxCacheSize = options.maxCacheSize || 1000;

    // Configurable issue patterns
    this.patterns = options.patterns || this.getDefaultPatterns();
  }

  /**
   * Default regex patterns for common feedback issues
   */
  getDefaultPatterns() {
    return {
      broken_link: /broken|dead|404|not work|doesn't work|link.*wrong/i,
      wrong_info: /wrong|incorrect|not right|mistake|error in/i,
      outdated: /outdated|old|deprecated|no longer|changed/i,
      partial: /but|however|although|except|missing|incomplete/i,
      positive: /thanks|perfect|great|excellent|exactly|helpful|awesome/i,
      negative: /useless|terrible|awful|completely wrong|garbage/i,
      technical_error: /crash|bug|glitch|freeze|timeout|fail/i
    };
  }

  /**
   * Full LLM-based analysis for ambiguous feedback
   * Uses structured JSON output for reliable parsing
   */
  async scoreFeedback(feedback) {
    // Skip LLM if no analysis needed
    if (feedback.rating !== 'helpful' || !feedback.comments) {
      return {
        adjustedRating: feedback.rating,
        weight: feedback.rating === 'helpful' ? 1.0 :
                feedback.rating === 'not-helpful' ? -2.0 : 0,
        issues: [],
        needsLLM: false
      };
    }

    // Check cache first
    const cacheKey = this.getCacheKey(feedback);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const prompt = `Analyze this user feedback where they marked the response as "helpful" but left a comment.

Comment: "${feedback.comments}"
Question: "${feedback.question}"

Determine if the comment indicates any issues that should reduce the helpfulness score.

Return a JSON object with:
{
  "hasIssues": boolean,
  "severity": "none" | "minor" | "major",
  "issueTypes": [], // Array of: "broken_link", "wrong_info", "outdated", "partial_answer", "technical_error", "other"
  "adjustedWeight": number // 1.0 for no issues, 0.7 for minor, 0.3 for major
}

Examples:
- "thanks!" → no issues, weight 1.0
- "helpful but the link is broken" → minor issue, weight 0.7
- "this was wrong, but I found the answer elsewhere" → major issue, weight 0.3
- "the info seems outdated" → minor issue, weight 0.7`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You analyze feedback comments to detect issues. Be conservative - only flag clear problems.'
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 200
      });

      const analysis = JSON.parse(response.choices[0].message.content);

      const result = {
        adjustedRating: analysis.hasIssues ? 'helpful_with_issues' : 'helpful',
        weight: analysis.adjustedWeight || 1.0,
        issues: analysis.issueTypes || [],
        severity: analysis.severity || 'none',
        needsLLM: true
      };

      // Cache with size management
      this.addToCache(cacheKey, result);

      return result;
    } catch (error) {
      // On error, default to normal helpful weight
      console.error('Error analyzing comment:', error.message);
      return {
        adjustedRating: 'helpful',
        weight: 1.0,
        issues: [],
        needsLLM: false,
        error: error.message
      };
    }
  }

  /**
   * Fast regex-based scoring without API calls
   * Handles ~70% of feedback accurately
   */
  quickScore(feedback) {
    if (feedback.rating !== 'helpful' || !feedback.comments) {
      return {
        adjustedRating: feedback.rating,
        weight: feedback.rating === 'helpful' ? 1.0 : -2.0,
        issues: [],
        needsLLM: false
      };
    }

    const comment = feedback.comments.toLowerCase();

    // Clear positive with no hedging - confident no issues
    if (this.patterns.positive.test(comment) && !this.patterns.partial.test(comment)) {
      return {
        adjustedRating: 'helpful',
        weight: 1.0,
        issues: [],
        needsLLM: false,
        confidence: 'high'
      };
    }

    // Clear issues detected
    const detectedIssues = [];
    let severity = 'none';
    let weight = 1.0;

    if (this.patterns.broken_link.test(comment)) {
      detectedIssues.push('broken_link');
      severity = 'minor';
      weight = 0.7;
    }

    if (this.patterns.wrong_info.test(comment) || this.patterns.negative.test(comment)) {
      detectedIssues.push('wrong_info');
      severity = 'major';
      weight = 0.3;
    }

    if (this.patterns.outdated.test(comment)) {
      detectedIssues.push('outdated');
      if (severity === 'none') severity = 'minor';
      weight = Math.min(weight, 0.7);
    }

    if (this.patterns.technical_error.test(comment)) {
      detectedIssues.push('technical_error');
      if (severity === 'none') severity = 'minor';
      weight = Math.min(weight, 0.7);
    }

    // If we found clear issues, return them
    if (detectedIssues.length > 0) {
      return {
        adjustedRating: 'helpful_with_issues',
        weight,
        issues: detectedIssues,
        severity,
        needsLLM: false,
        confidence: 'high'
      };
    }

    // Ambiguous: hedging words present but no clear issue
    if (this.patterns.partial.test(comment)) {
      return {
        adjustedRating: 'helpful',
        weight: 1.0,
        issues: [],
        needsLLM: true,
        confidence: 'low'
      };
    }

    // Medium-length comments might contain nuanced feedback
    if (comment.length > 10 && comment.length < 100) {
      return {
        adjustedRating: 'helpful',
        weight: 1.0,
        issues: [],
        needsLLM: true,
        confidence: 'medium'
      };
    }

    // Very short or very long - assume fine
    return {
      adjustedRating: 'helpful',
      weight: 1.0,
      issues: [],
      needsLLM: false,
      confidence: 'medium'
    };
  }

  /**
   * Smart scoring: Regex first, LLM only when ambiguous
   * This hybrid approach reduces API costs significantly
   */
  async smartScore(feedback) {
    // First try quick regex scoring
    const quickResult = this.quickScore(feedback);

    // If regex is confident, skip LLM
    if (!quickResult.needsLLM) {
      return quickResult;
    }

    // For ambiguous cases, use LLM
    try {
      const llmResult = await this.scoreFeedback(feedback);
      return llmResult;
    } catch (error) {
      // If LLM fails, fall back to quick score
      console.error('LLM scoring failed, using quick score:', error.message);
      quickResult.needsLLM = false;
      quickResult.llmError = error.message;
      return quickResult;
    }
  }

  /**
   * Batch analyze multiple feedback entries with rate limiting
   */
  async scoreBatch(feedbackEntries, options = {}) {
    const batchSize = options.batchSize || 5;
    const delayMs = options.delayMs || 100;
    const results = [];

    for (let i = 0; i < feedbackEntries.length; i += batchSize) {
      const batch = feedbackEntries.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(f => this.smartScore(f))
      );
      results.push(...batchResults);

      // Rate limiting delay between batches
      if (i + batchSize < feedbackEntries.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Get statistics on scoring performance
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      patterns: Object.keys(this.patterns)
    };
  }

  /**
   * Cache management utilities
   */
  getCacheKey(feedback) {
    return `${feedback.messageId || 'no-id'}_${feedback.comments}`;
  }

  addToCache(key, value) {
    // Simple LRU-like behavior: clear oldest if full
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clearCache() {
    this.cache.clear();
  }
}

export default CommentScorer;
