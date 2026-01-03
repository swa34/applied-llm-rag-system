/**
 * Document Ingestion Pipeline
 *
 * Comprehensive pipeline for ingesting documents into a vector database.
 * Features:
 * - Multi-format support (PDF, Markdown, TXT)
 * - Hybrid vectors (dense + sparse) for semantic + keyword search
 * - Enhanced metadata with source categorization
 * - Duplicate detection via content hashing
 * - CLI interface with dry-run, purge, and recreate options
 *
 * @author Scott Anderson
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

dotenv.config();

// ---------- CONFIGURATION ----------
const CONFIG = {
  BATCH_SIZE: 10,           // Chunks per embedding request
  MAX_CHARS: 1200,          // Target chunk size
  OVERLAP: 200,             // Overlap between chunks
  INDEX_DIM: 3072,          // text-embedding-3-large dimension
  INDEX_METRIC: 'cosine',
  INDEX_CLOUD: 'aws',
  INDEX_REGION: 'us-east-1',
  EMBED_MODEL: process.env.EMBED_MODEL || 'text-embedding-3-large'
};

// ---------- CLI FLAGS ----------
const flags = new Set(process.argv.slice(2));
const DRY_RUN = flags.has('--dry');
const RECREATE_INDEX = flags.has('--recreate-index');
const SKIP_PDF = flags.has('--skip-pdf');
const PURGE = flags.has('--purge');

// ---------- CLIENTS ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

/**
 * Document Ingestion Pipeline
 */
class DocumentIngestion {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.namespace = options.namespace || process.env.PINECONE_NAMESPACE || '__default__';
    this.indexName = options.indexName || process.env.PINECONE_INDEX_NAME;
    this.index = null;

    // Source type mapping for metadata enhancement
    this.sourceTypeMap = options.sourceTypeMap || this.getDefaultSourceMap();
  }

  /**
   * Default source type mapping
   * Customize this for your document sources
   */
  getDefaultSourceMap() {
    return {
      'docs/api': { sourceType: 'api_documentation', category: 'technical', priority: 10 },
      'docs/guides': { sourceType: 'user_guide', category: 'documentation', priority: 9 },
      'docs/policies': { sourceType: 'policy_document', category: 'compliance', priority: 8 },
      'docs/training': { sourceType: 'training_material', category: 'education', priority: 7 },
      'docs/web': { sourceType: 'web_content', category: 'general', priority: 5 }
    };
  }

  /**
   * Initialize or get Pinecone index
   */
  async getOrCreateIndex() {
    if (this.index) return this.index;

    const list = await pinecone.listIndexes();
    const names = list.indexes?.map(i => i.name) || [];

    if (names.includes(this.indexName)) {
      if (RECREATE_INDEX) {
        console.log(`Index "${this.indexName}" exists, deleting (RECREATE_INDEX on).`);
        await pinecone.deleteIndex(this.indexName);
        console.log('Deleted. Recreating...');
      } else {
        console.log(`Index "${this.indexName}" found.`);
        this.index = pinecone.index(this.indexName);
        return this.index;
      }
    }

    console.log(`Creating index "${this.indexName}" (dim=${this.config.INDEX_DIM}).`);
    await pinecone.createIndex({
      name: this.indexName,
      dimension: this.config.INDEX_DIM,
      metric: this.config.INDEX_METRIC,
      spec: {
        serverless: {
          cloud: this.config.INDEX_CLOUD,
          region: this.config.INDEX_REGION
        }
      }
    });

    // Wait for index to be ready
    console.log('Waiting for index to be ready...');
    let ready = false;
    while (!ready) {
      await new Promise(r => setTimeout(r, 4000));
      const desc = await pinecone.describeIndex(this.indexName);
      ready = desc.status?.ready;
    }

    console.log(`Index "${this.indexName}" is ready.`);
    this.index = pinecone.index(this.indexName);
    return this.index;
  }

  /**
   * Generate stable chunk ID from filename and index
   */
  makeChunkId(fileName, chunkIndex) {
    return crypto
      .createHash('sha1')
      .update(`${fileName}|${chunkIndex}`)
      .digest('hex')
      .slice(0, 20);
  }

  /**
   * Create sparse vector for keyword matching
   * Uses term frequency with hash-based indices
   */
  createSparseVector(text) {
    if (!text) return { indices: [], values: [] };

    const termFrequencies = new Map();
    const tokens = text.toLowerCase().match(/\b\w{3,}\b/g) || [];

    tokens.forEach(token => {
      termFrequencies.set(token, (termFrequencies.get(token) || 0) + 1);
    });

    const pairs = [];
    for (const [term, freq] of termFrequencies.entries()) {
      let hash = 0;
      for (let i = 0; i < term.length; i++) {
        hash = (hash << 5) - hash + term.charCodeAt(i);
        hash |= 0;
      }
      pairs.push({ index: Math.abs(hash), value: freq });
    }

    // Sort and deduplicate
    pairs.sort((a, b) => a.index - b.index);
    const unique = [];
    const seen = new Set();
    for (const pair of pairs) {
      if (!seen.has(pair.index)) {
        unique.push(pair);
        seen.add(pair.index);
      }
    }

    return {
      indices: unique.map(p => p.index),
      values: unique.map(p => p.value)
    };
  }

  /**
   * Get enhanced metadata based on file path
   */
  getSourceMetadata(filePath) {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    let metadata = {
      sourceType: 'unknown',
      category: 'general',
      ingestionMethod: 'file',
      priority: 1
    };

    // Match against source type map
    for (const [pathPattern, typeInfo] of Object.entries(this.sourceTypeMap)) {
      if (normalized.includes(pathPattern)) {
        metadata = { ...metadata, ...typeInfo };
        break;
      }
    }

    // Add file format
    metadata.fileFormat = path.extname(filePath).toLowerCase().slice(1) || 'unknown';

    return metadata;
  }

  /**
   * Generate content hash for duplicate detection
   */
  getContentHash(text) {
    const normalized = text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  /**
   * Extract source URL from document content
   */
  extractSourceUrl(text) {
    // Try common patterns
    const patterns = [
      /\*?\*?Source:\*?\*?\s*(https?:\/\/[^\s\n]+)/mi,
      /^url:\s*(https?:\/\/[^\s\n]+)/mi,
      /^source_url:\s*(https?:\/\/[^\s\n]+)/mi
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }

    return null;
  }

  /**
   * Check if content should be skipped
   */
  shouldSkipContent(content) {
    const skipPatterns = [
      /^\s*\[pdf-embedder[^\]]*\]\s*$/i,
      /^\s*Loading\.\.\.\s*$/i,
      /^\s*\[embed\][^\[]*\[\/embed\]\s*$/i
    ];

    const trimmed = content.trim();
    if (trimmed.length < 50) {
      return skipPatterns.some(p => p.test(trimmed));
    }

    // Skip if mostly navigation elements
    const navWords = (content.match(/\bmenu\b|\bnav\b|\bsidebar\b|\bfooter\b|\bheader\b/gi) || []).length;
    const totalWords = content.split(/\s+/).length;
    if (navWords / totalWords > 0.3) return true;

    return false;
  }

  /**
   * Chunk text with overlap
   */
  chunkText(text, maxChars, overlap) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxChars;

      // Try to break at sentence boundary
      if (end < text.length) {
        const slice = text.slice(start, end + 100);
        const sentenceEnd = slice.search(/[.!?]\s/);
        if (sentenceEnd > maxChars * 0.7) {
          end = start + sentenceEnd + 1;
        }
      }

      chunks.push(text.slice(start, Math.min(end, text.length)).trim());
      start = end - overlap;
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * Embed texts using OpenAI
   */
  async embedTexts(texts) {
    const response = await openai.embeddings.create({
      model: this.config.EMBED_MODEL,
      input: texts
    });
    return response.data.map(d => d.embedding);
  }

  /**
   * Process a single file
   */
  async processFile(fullPath, index) {
    const fileName = path.basename(fullPath);
    let rawText = '';

    try {
      const isPdf = fileName.toLowerCase().endsWith('.pdf');
      const isTxtOrMd = /\.(txt|md)$/i.test(fileName);

      if (isPdf && SKIP_PDF) {
        console.log(`Skipping PDF (--skip-pdf): ${fileName}`);
        return;
      }

      if (isPdf) {
        const buf = fs.readFileSync(fullPath);
        const { text } = await pdfParse(buf);
        rawText = text;
      } else if (isTxtOrMd) {
        rawText = fs.readFileSync(fullPath, 'utf-8');
      } else {
        console.log(`Skipping unsupported: ${fileName}`);
        return;
      }
    } catch (err) {
      console.error(`Failed to read ${fileName}:`, err.message);
      return;
    }

    // Check for skip conditions
    if (this.shouldSkipContent(rawText)) {
      console.log(`Skipping low-content file: ${fileName}`);
      return;
    }

    const pageUrl = this.extractSourceUrl(rawText);
    const chunks = this.chunkText(rawText, this.config.MAX_CHARS, this.config.OVERLAP);
    console.log(`File: ${fileName} -> ${chunks.length} chunks`);

    // Process in batches
    for (let i = 0; i < chunks.length; i += this.config.BATCH_SIZE) {
      const slice = chunks.slice(i, i + this.config.BATCH_SIZE);
      const embeddings = await this.embedTexts(slice);

      const vectors = embeddings.map((emb, idx) => {
        const textChunk = slice[idx];
        const sourceMetadata = this.getSourceMetadata(fullPath);

        const metadata = {
          source: fileName,
          sourceFile: fileName,
          url: pageUrl || '',
          text: textChunk,
          chunkIndex: i + idx,
          totalChunks: chunks.length,
          contentHash: this.getContentHash(textChunk).slice(0, 16),
          ingestionDate: new Date().toISOString(),
          ...sourceMetadata
        };

        return {
          id: this.makeChunkId(fileName, i + idx),
          values: emb,
          sparseValues: this.createSparseVector(textChunk),
          metadata
        };
      });

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would upsert ${vectors.length} vectors (batch ${Math.ceil((i + 1) / this.config.BATCH_SIZE)})`);
      } else {
        await index.upsert(vectors, this.namespace);
        console.log(`  Upserted batch ${Math.ceil((i + 1) / this.config.BATCH_SIZE)}/${Math.ceil(chunks.length / this.config.BATCH_SIZE)}`);
      }
    }

    // Help garbage collection
    rawText = null;
    if (global.gc) global.gc();
  }

  /**
   * Recursively get all processable files
   */
  getAllFiles(dirPath, files = []) {
    const entries = fs.readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        this.getAllFiles(fullPath, files);
      } else if (/\.(md|txt|pdf)$/i.test(entry)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Main ingestion entry point
   */
  async ingest(sourceDir) {
    // Validate environment
    if (!process.env.PINECONE_API_KEY) {
      throw new Error('Missing PINECONE_API_KEY');
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Missing OPENAI_API_KEY');
    }

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source directory not found: ${sourceDir}`);
    }

    console.log(`\n📁 Ingesting from: ${sourceDir}`);
    console.log(`📊 Config: chunks=${this.config.MAX_CHARS}, overlap=${this.config.OVERLAP}, batch=${this.config.BATCH_SIZE}`);

    const files = this.getAllFiles(sourceDir);
    if (!files.length) {
      console.warn('No files found. Nothing to ingest.');
      return { filesProcessed: 0 };
    }

    console.log(`📄 Found ${files.length} files to ingest\n`);

    const index = await this.getOrCreateIndex();

    // Optional: purge namespace
    if (PURGE) {
      console.log(`🗑️  Purging namespace "${this.namespace}"...`);
      await index.namespace(this.namespace).deleteAll();
      console.log('Namespace cleared.\n');
    }

    // Process each file
    let processed = 0;
    for (const fullPath of files) {
      await this.processFile(fullPath, index);
      processed++;
    }

    console.log(`\n✅ Ingestion complete. ${processed} files processed.`);
    return { filesProcessed: processed };
  }
}

// ---------- CLI INTERFACE ----------
async function main() {
  const sourceDir = process.argv.find(arg => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1])
    || path.resolve('docs');

  console.log('\n🚀 Document Ingestion Pipeline');
  console.log('=' .repeat(50));

  if (DRY_RUN) console.log('⚠️  DRY RUN mode - no changes will be made');
  if (SKIP_PDF) console.log('⚠️  Skipping PDF files');
  if (PURGE) console.log('⚠️  Will purge namespace before ingesting');
  if (RECREATE_INDEX) console.log('⚠️  Will recreate index');

  const pipeline = new DocumentIngestion();

  try {
    await pipeline.ingest(sourceDir);
  } catch (error) {
    console.error('\n❌ Ingestion failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}

export default DocumentIngestion;
