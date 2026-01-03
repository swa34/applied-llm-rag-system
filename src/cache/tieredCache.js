/**
 * Two-Tier Response Cache (Redis + PostgreSQL)
 *
 * This module implements a sophisticated caching layer for RAG responses:
 * - Redis for ultra-fast L1 cache (sub-millisecond)
 * - PostgreSQL for persistent L2 cache with analytics
 * - Multiple match strategies: exact, variation, semantic
 * - Automatic failover between tiers
 * - Feedback integration for cache quality
 *
 * Architecture:
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 * │   Request   │────>│    Redis    │────>│  PostgreSQL │
 * │             │     │   (L1 TTL)  │     │  (L2 persist)│
 * └─────────────┘     └─────────────┘     └─────────────┘
 *        │                  │                    │
 *        │    Cache HIT ◄───┘                    │
 *        │    Cache HIT ◄────────────────────────┘
 *        └─────> Cache MISS ─────> RAG Pipeline
 *
 * @author Scott Anderson
 */

import 'dotenv/config';
import pg from 'pg';
import Redis from 'ioredis';
import crypto from 'crypto';

const { Pool } = pg;

class TieredCache {
  constructor() {
    // PostgreSQL for persistence
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_DATABASE,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });

    // Redis for fast cache
    this.redis = null;
    this.redisEnabled = false;
    this._initializeRedis();

    // Configuration
    this.minConfidence = parseFloat(process.env.CACHE_MIN_CONFIDENCE || '0.75');
    this.defaultTTLDays = parseInt(process.env.CACHE_TTL_DAYS || '30');
    this.redisTTL = 3600; // 1 hour (shorter for memory efficiency)

    this.initialized = false;
  }

  /**
   * Initialize Redis connection with retry logic.
   */
  _initializeRedis() {
    const REDIS_URL = process.env.REDIS_URL;

    if (!REDIS_URL) {
      console.log('Redis URL not configured, using PostgreSQL-only caching');
      return;
    }

    try {
      this.redis = new Redis(REDIS_URL, {
        retryStrategy: (times) => {
          if (times > 3) {
            console.log('Redis connection failed, falling back to PostgreSQL');
            this.redisEnabled = false;
            return null;
          }
          return Math.min(times * 100, 2000);
        },
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: false
      });

      this.redis.on('error', (err) => {
        console.error('Redis error:', err.message);
        this.redisEnabled = false;
      });

      this.redis.on('connect', () => {
        console.log('Redis connected for caching');
        this.redisEnabled = true;
      });

      this.redis.on('ready', () => {
        this.redisEnabled = true;
      });

    } catch (error) {
      console.log('Redis initialization failed:', error.message);
      this.redisEnabled = false;
    }
  }

  /**
   * Initialize cache system.
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await this.pool.query('SELECT 1');
      console.log('PostgreSQL cache initialized');

      if (this.redis && this.redisEnabled) {
        await this.redis.ping();
        console.log('Redis cache initialized');
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize cache:', error.message);
      throw error;
    }
  }

  /**
   * Generate cache key for Redis.
   */
  generateCacheKey(question, sessionId = null) {
    const normalized = this._normalizeQuestion(question);
    const hash = crypto.createHash('md5').update(normalized).digest('hex');
    return sessionId ? `cache:${hash}:${sessionId}` : `cache:${hash}`;
  }

  /**
   * Normalize question for consistent matching.
   */
  _normalizeQuestion(question) {
    return question
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Check cache for a response.
   *
   * Search order:
   * 1. Redis (L1) - exact key match
   * 2. PostgreSQL (L2) - exact normalized match
   * 3. PostgreSQL (L2) - variation match
   * 4. PostgreSQL (L2) - semantic similarity (if enabled)
   *
   * @param {string} question - User's question
   * @param {string} sessionId - Optional session ID
   * @returns {Object|null} Cached response or null
   */
  async get(question, sessionId = null) {
    await this.initialize();

    const startTime = Date.now();
    const normalized = this._normalizeQuestion(question);
    const cacheKey = this.generateCacheKey(question, sessionId);

    try {
      // ========== TIER 1: Redis ==========
      if (this.redisEnabled && this.redis) {
        try {
          const redisData = await this.redis.get(cacheKey);
          if (redisData) {
            const cached = JSON.parse(redisData);

            // Refresh TTL on hit
            await this.redis.expire(cacheKey, this.redisTTL);

            // Record hit for analytics
            await this._recordHit(cached.cacheId, sessionId, 'redis_' + cached.hitType, 1.0, startTime);

            console.log(`[CACHE HIT] Redis: "${question.substring(0, 40)}..." (${Date.now() - startTime}ms)`);

            return {
              ...cached,
              responseTime: Date.now() - startTime,
              cacheSource: 'redis'
            };
          }
        } catch (redisError) {
          console.error('Redis lookup error:', redisError.message);
          // Continue to PostgreSQL fallback
        }
      }

      // ========== TIER 2a: PostgreSQL Exact Match ==========
      let result = await this.pool.query(`
        SELECT
          id,
          question_normalized,
          response_text,
          sources_used,
          cache_confidence,
          times_served
        FROM cached_responses
        WHERE question_normalized = $1
          AND is_active = TRUE
          AND expires_at > NOW()
          AND cache_confidence >= $2
        LIMIT 1
      `, [normalized, this.minConfidence]);

      if (result.rows.length > 0) {
        const hit = result.rows[0];
        const cacheData = this._buildCacheResponse(hit, 'exact');

        // Promote to Redis for faster future access
        await this._promoteToRedis(cacheKey, cacheData);

        await this._recordHit(hit.id, sessionId, 'exact', 1.0, startTime);
        console.log(`[CACHE HIT] PostgreSQL (exact): "${question.substring(0, 40)}..." (${Date.now() - startTime}ms)`);

        return {
          ...cacheData,
          responseTime: Date.now() - startTime
        };
      }

      // ========== TIER 2b: PostgreSQL Variation Match ==========
      result = await this.pool.query(`
        SELECT
          id,
          question_normalized,
          response_text,
          sources_used,
          cache_confidence,
          question_variations
        FROM cached_responses
        WHERE $1 = ANY(question_variations)
          AND is_active = TRUE
          AND expires_at > NOW()
          AND cache_confidence >= $2
        LIMIT 1
      `, [normalized, this.minConfidence]);

      if (result.rows.length > 0) {
        const hit = result.rows[0];
        const cacheData = this._buildCacheResponse(hit, 'variation');

        await this._promoteToRedis(cacheKey, cacheData);
        await this._recordHit(hit.id, sessionId, 'variation', 0.95, startTime);

        console.log(`[CACHE HIT] PostgreSQL (variation): "${question.substring(0, 40)}..." (${Date.now() - startTime}ms)`);

        return {
          ...cacheData,
          responseTime: Date.now() - startTime
        };
      }

      // ========== Cache Miss ==========
      await this._recordMiss();
      console.log(`[CACHE MISS] "${question.substring(0, 40)}..." (${Date.now() - startTime}ms)`);
      return null;

    } catch (error) {
      console.error('Cache lookup error:', error.message);
      return null;
    }
  }

  /**
   * Build standardized cache response object.
   */
  _buildCacheResponse(row, hitType) {
    return {
      cached: true,
      hitType,
      response: row.response_text,
      sources: this._parseSources(row.sources_used),
      confidence: parseFloat(row.cache_confidence),
      cacheId: row.id,
      cacheSource: 'postgresql'
    };
  }

  /**
   * Parse sources JSON with link formatting.
   */
  _parseSources(sourcesJson) {
    try {
      const sources = typeof sourcesJson === 'string' ? JSON.parse(sourcesJson) : sourcesJson;

      return sources.map(source => {
        if (typeof source === 'string') {
          return { text: source };
        }

        // Ensure URLs are properly formatted
        if (source.url && !source.url.startsWith('http')) {
          source.url = `https://${source.url}`;
        }

        return source;
      });
    } catch (error) {
      console.error('Error parsing sources:', error.message);
      return [];
    }
  }

  /**
   * Promote a PostgreSQL hit to Redis for faster access.
   */
  async _promoteToRedis(cacheKey, cacheData) {
    if (this.redisEnabled && this.redis) {
      try {
        await this.redis.setex(cacheKey, this.redisTTL, JSON.stringify(cacheData));
        console.log('Promoted to Redis cache');
      } catch (err) {
        console.error('Failed to promote to Redis:', err.message);
      }
    }
  }

  /**
   * Add a new response to cache.
   *
   * Features:
   * - Stores in both Redis and PostgreSQL
   * - Protects manually-created entries from auto-overwrite
   * - Protects entries with positive feedback
   *
   * @param {string} question - Original question
   * @param {string} response - Response text
   * @param {Array} sources - Source documents used
   * @param {Object} options - Configuration options
   */
  async set(question, response, sources = [], options = {}) {
    await this.initialize();

    const normalized = this._normalizeQuestion(question);
    const {
      confidence = 0.8,
      ttlDays = this.defaultTTLDays,
      variations = [],
      createdBy = 'auto'
    } = options;

    try {
      // Check if entry should be protected
      const existingCheck = await this.pool.query(`
        SELECT
          id,
          created_by,
          positive_feedback,
          negative_feedback,
          cache_confidence
        FROM cached_responses
        WHERE question_normalized = $1
      `, [normalized]);

      const existing = existingCheck.rows[0];

      // Protect entries from auto-overwrite
      if (existing) {
        const isManual = existing.created_by !== 'auto';
        const hasPositiveFeedback = (existing.positive_feedback || 0) > (existing.negative_feedback || 0);
        const hasBetterConfidence = parseFloat(existing.cache_confidence) >= confidence;

        if (isManual || (hasPositiveFeedback && hasBetterConfidence)) {
          console.log(`[CACHE PROTECTED] Not overwriting: "${question.substring(0, 40)}..."`);
          return {
            cacheId: existing.id,
            success: false,
            reason: 'protected'
          };
        }
      }

      // Enrich sources with proper formatting
      const enrichedSources = sources.map(source => {
        if (typeof source === 'string') return { text: source };
        return {
          text: source.text || source.metadata?.text || '',
          title: source.title || source.metadata?.title || '',
          url: source.url || source.metadata?.url || '',
          score: source.score || 0
        };
      });

      // Store in PostgreSQL
      const result = await this.pool.query(`
        INSERT INTO cached_responses (
          question_normalized,
          question_variations,
          response_text,
          sources_used,
          cache_confidence,
          ttl_days,
          expires_at,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 day' * $7, $8)
        ON CONFLICT (question_normalized) DO UPDATE SET
          response_text = EXCLUDED.response_text,
          sources_used = EXCLUDED.sources_used,
          cache_confidence = EXCLUDED.cache_confidence,
          question_variations = EXCLUDED.question_variations,
          expires_at = NOW() + INTERVAL '1 day' * EXCLUDED.ttl_days,
          last_updated = NOW(),
          is_active = TRUE
        RETURNING id, expires_at
      `, [
        normalized,
        variations,
        response,
        JSON.stringify(enrichedSources),
        confidence,
        ttlDays,
        ttlDays,
        createdBy
      ]);

      const cacheId = result.rows[0].id;
      const expiresAt = result.rows[0].expires_at;

      // Also store in Redis
      if (this.redisEnabled && this.redis) {
        const cacheData = {
          cached: true,
          hitType: 'exact',
          response,
          sources: enrichedSources,
          confidence,
          cacheId,
          cacheSource: 'redis'
        };

        const cacheKey = this.generateCacheKey(question);
        await this.redis.setex(cacheKey, this.redisTTL, JSON.stringify(cacheData));

        // Also cache variations
        for (const variation of variations) {
          const varKey = this.generateCacheKey(variation);
          await this.redis.setex(varKey, this.redisTTL, JSON.stringify({
            ...cacheData,
            hitType: 'variation'
          }));
        }

        console.log('Cached to both Redis and PostgreSQL');
      }

      console.log(`[CACHE SET] "${question.substring(0, 40)}..." (ID: ${cacheId})`);

      return { cacheId, expiresAt, success: true };

    } catch (error) {
      console.error('Failed to cache response:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update feedback for cached response.
   */
  async updateFeedback(cacheId, rating) {
    await this.initialize();

    try {
      let field;
      if (rating === 1) field = 'positive_feedback';
      else if (rating === -1) field = 'negative_feedback';
      else field = 'neutral_feedback';

      await this.pool.query(`
        UPDATE cached_responses
        SET ${field} = ${field} + 1
        WHERE id = $1
      `, [cacheId]);

      console.log(`[CACHE FEEDBACK] ID ${cacheId}: rating ${rating}`);
    } catch (error) {
      console.error('Failed to update cache feedback:', error.message);
    }
  }

  /**
   * Invalidate a cached response.
   */
  async invalidate(cacheId) {
    await this.initialize();

    try {
      await this.pool.query(`
        UPDATE cached_responses
        SET is_active = FALSE
        WHERE id = $1
      `, [cacheId]);

      // Clear Redis cache (we don't have reverse lookup)
      if (this.redisEnabled && this.redis) {
        await this.clearRedisCache();
      }

      console.log(`[CACHE INVALIDATED] ID: ${cacheId}`);
      return true;
    } catch (error) {
      console.error('Failed to invalidate cache:', error.message);
      return false;
    }
  }

  /**
   * Clear all Redis cache entries.
   */
  async clearRedisCache() {
    if (this.redisEnabled && this.redis) {
      try {
        const keys = await this.redis.keys('cache:*');
        if (keys.length > 0) {
          await this.redis.del(...keys);
          console.log(`Cleared ${keys.length} Redis cache entries`);
        }
        return keys.length;
      } catch (error) {
        console.error('Failed to clear Redis cache:', error.message);
        return 0;
      }
    }
    return 0;
  }

  /**
   * Get cache statistics.
   */
  async getStats() {
    await this.initialize();

    try {
      const result = await this.pool.query(`
        SELECT
          COUNT(*) as total_entries,
          COUNT(*) FILTER (WHERE is_active = TRUE) as active_entries,
          SUM(times_served) as total_hits,
          SUM(positive_feedback) as total_positive,
          SUM(negative_feedback) as total_negative,
          AVG(cache_confidence) as avg_confidence
        FROM cached_responses
      `);

      let redisStats = null;
      if (this.redisEnabled && this.redis) {
        try {
          const keys = await this.redis.keys('cache:*');
          redisStats = {
            connected: true,
            keysCount: keys.length
          };
        } catch (err) {
          redisStats = { connected: false, error: err.message };
        }
      }

      return {
        postgresql: result.rows[0],
        redis: redisStats
      };
    } catch (error) {
      console.error('Failed to get cache stats:', error.message);
      return null;
    }
  }

  /**
   * Record a cache hit for analytics.
   */
  async _recordHit(cacheId, sessionId, hitType, similarity, startTime) {
    const responseTime = Date.now() - startTime;
    const avgRagTime = 16500; // Average RAG pipeline time
    const timeSaved = Math.max(0, avgRagTime - responseTime);

    try {
      await this.pool.query(`
        UPDATE cached_responses
        SET times_served = times_served + 1,
            last_served = NOW()
        WHERE id = $1
      `, [cacheId]);

      // Log for analytics (optional table)
      try {
        await this.pool.query(`
          INSERT INTO cache_hit_log (
            cached_response_id,
            session_id,
            hit_type,
            similarity_score,
            response_time_ms,
            time_saved_ms
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [cacheId, sessionId, hitType, similarity, responseTime, timeSaved]);
      } catch {
        // Table may not exist - that's OK
      }
    } catch (error) {
      console.error('Failed to record cache hit:', error.message);
    }
  }

  /**
   * Record a cache miss for analytics.
   */
  async _recordMiss() {
    // Optional: implement miss tracking
  }

  /**
   * Clean shutdown.
   */
  async destroy() {
    if (this.redis) {
      this.redis.disconnect();
    }
    await this.pool.end();
  }
}

// Singleton instance
let cacheInstance = null;

export function getTieredCache() {
  if (!cacheInstance) {
    cacheInstance = new TieredCache();
  }
  return cacheInstance;
}

export default TieredCache;
