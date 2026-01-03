# System Architecture

This document provides a comprehensive overview of the Applied LLM RAG System architecture.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DOCUMENT SOURCES                                   │
├───────────────┬───────────────┬───────────────┬───────────────────────────────┤
│   Websites    │   Dropbox     │   Local Files │   Other APIs                  │
│   (crawled)   │   (API)       │   (PDF/DOCX)  │   (extensible)                │
└───────┬───────┴───────┬───────┴───────┬───────┴───────────────┬───────────────┘
        │               │               │                       │
        ▼               ▼               ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PYTHON PROCESSING LAYER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Crawlers  │  │  Document   │  │   Cloud     │  │    Document         │  │
│  │   (3 types) │  │  Processor  │  │   Storage   │  │    Mapper           │  │
│  │             │  │  (4 formats)│  │  Processor  │  │  (fuzzy matching)   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ Markdown files
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NODE.JS INGESTION LAYER                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    Document Ingestion Pipeline                           │ │
│  │  • Chunking with overlap                                                 │ │
│  │  • Dense embeddings (OpenAI text-embedding-3-large)                     │ │
│  │  • Sparse vectors (term frequency hashing)                              │ │
│  │  • Metadata enhancement                                                  │ │
│  │  • Duplicate detection                                                   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VECTOR DATABASE                                    │
│                           (Pinecone)                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  • Dense vectors (3072 dimensions)                                       │ │
│  │  • Sparse vectors (keyword indices)                                      │ │
│  │  • Rich metadata (source, category, priority, dates)                    │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NODE.JS RAG LAYER                                     │
│                                                                              │
│  ┌────────────────────┐     ┌────────────────────┐     ┌──────────────────┐ │
│  │   Hybrid Search    │     │   2-Tier Cache     │     │    Feedback      │ │
│  │   + Re-ranking     │     │   (Redis + PG)     │     │    Learning      │ │
│  │                    │     │                    │     │                  │ │
│  │  • Dense + Sparse  │     │  • L1: Redis       │     │  • Score adjust  │ │
│  │  • Alpha blending  │     │  • L2: PostgreSQL  │     │  • Pattern learn │ │
│  │  • LLM re-rank     │     │  • TTL + protect   │     │  • Comment score │ │
│  └────────────────────┘     └────────────────────┘     └──────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    Streaming Response Handler                            │ │
│  │  • Cache hit → instant JSON response                                    │ │
│  │  • Cache miss → SSE streaming                                           │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    Streaming Chat Client                                 │ │
│  │  • Automatic cache/stream detection                                     │ │
│  │  • Progressive UI updates                                               │ │
│  │  • Session persistence                                                  │ │
│  │  • Source attribution                                                   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Python Processing Layer

#### Web Crawlers (`python/crawlers/`)

Three specialized crawler types handle different source patterns:

| Crawler | Use Case | Key Features |
|---------|----------|--------------|
| `BaseCrawler` | Foundation class | Session pooling, rate limiting, URL filtering |
| `DeepCrawler` | Sitemap-based | Sitemap index support, priority queuing, PDF extraction |
| `AuthenticatedCrawler` | Login-protected | Token management, redirect blocking, lockout prevention |

#### Document Processor (`python/processors/`)

Multi-format extraction with table preservation:

- **PDF**: PyPDF2 with page-by-page extraction
- **DOCX**: python-docx with paragraph and table handling
- **PPTX**: Slide-by-slide with notes extraction
- **XLSX**: Sheet-by-sheet with markdown table conversion

#### Cloud Storage (`python/processors/cloud_storage_processor.py`)

Dropbox API integration with:
- Paginated folder listing
- Recursive directory traversal
- Shared link creation for URLs
- Batch processing support

#### Document Mapper (`python/mapping/`)

Cross-referencing system using fuzzy matching:
- Multi-index lookups (filename, title, URL)
- SequenceMatcher for similarity scoring
- Configurable confidence thresholds

### Node.js RAG Layer

#### Hybrid Search (`src/retrieval/`)

Combines semantic and keyword matching:

```javascript
// Alpha controls dense vs sparse balance
// 0.0 = pure sparse (keyword)
// 1.0 = pure dense (semantic)
const alpha = 0.7; // Default: favor semantic

const score = alpha * denseScore + (1 - alpha) * sparseScore;
```

**LLM Re-ranking**: When top results have similar scores (within threshold), uses GPT-4 to re-order based on actual relevance to the query.

#### Two-Tier Cache (`src/cache/`)

Response caching for sub-100ms repeated queries:

```
┌─────────────────────────────────────────┐
│              Cache Flow                  │
│                                         │
│   Query → [L1 Redis] ──hit──→ Response  │
│              │                          │
│             miss                        │
│              ▼                          │
│         [L2 PostgreSQL] ─hit─→ Response │
│              │                          │
│             miss                        │
│              ▼                          │
│         [LLM Generation]                │
│              │                          │
│              ▼                          │
│     Store in L1 + L2 → Response        │
└─────────────────────────────────────────┘
```

**Protection Features**:
- Positive feedback entries protected from eviction
- Manually curated responses preserved
- TTL-based expiration for standard entries

#### Feedback Learning (`src/feedback/`)

Continuous improvement through user feedback:

1. **Comment Scoring**: Hybrid regex + LLM analysis
   - Quick patterns catch 70% of cases
   - LLM handles ambiguous comments
   - Reduces API costs by 60-80%

2. **Source Quality Tracking**:
   - Helpful/not-helpful ratios per source
   - Issue type categorization
   - Automatic score adjustment

3. **Query Pattern Learning**:
   - Successful query → source mappings
   - Pattern matching boosts for known queries

### Ingestion Pipeline

#### Document Flow

```
Document → Chunk → Embed → Enrich → Upsert
    │         │       │       │        │
    │         │       │       │        └─ Pinecone with namespace
    │         │       │       └─ Source type, priority, hash
    │         │       └─ Dense (3072d) + Sparse vectors
    │         └─ 1200 chars with 200 overlap
    └─ PDF/MD/TXT parsing
```

#### CLI Options

```bash
npm run ingest -- --dry              # Preview without changes
npm run ingest -- --purge            # Clear namespace first
npm run ingest -- --recreate-index   # Delete and recreate index
npm run ingest -- --skip-pdf         # Process only text files
```

### Streaming Architecture

#### Response Flow

```
Client Request
      │
      ▼
  [Cache Check]
      │
   ┌──┴──┐
   │     │
  HIT   MISS
   │     │
   ▼     ▼
 JSON   SSE Stream
 (instant) │
   │     ├─ response.start
   │     ├─ message.delta (repeated)
   │     ├─ sources
   │     └─ response.end
   │     │
   └──┬──┘
      │
      ▼
 Client Display
```

## Data Models

### Vector Record

```javascript
{
  id: "sha1_hash_20chars",
  values: [/* 3072 dense dimensions */],
  sparseValues: {
    indices: [/* term hashes */],
    values: [/* frequencies */]
  },
  metadata: {
    source: "document.pdf",
    sourceFile: "document.pdf",
    url: "https://...",
    text: "chunk content...",
    chunkIndex: 0,
    totalChunks: 15,
    sourceType: "policy_document",
    category: "compliance",
    priority: 8,
    contentHash: "md5_16chars",
    ingestionDate: "2024-01-15T..."
  }
}
```

### Feedback Record

```javascript
{
  sourceKey: "document.pdf",
  helpful: 45,
  notHelpful: 3,
  helpfulWithIssues: 5,
  total: 53,
  score: 0.73,  // (helpful - notHelpful*2) / total
  issueTypes: {
    "broken_link": 2,
    "outdated": 3
  }
}
```

## Performance Characteristics

| Operation | Target Latency | Achieved |
|-----------|---------------|----------|
| Cache hit (L1 Redis) | <50ms | ~15ms |
| Cache hit (L2 PostgreSQL) | <100ms | ~45ms |
| Hybrid search | <500ms | ~300ms |
| Full generation (cache miss) | <3s | ~2s |
| Streaming first token | <500ms | ~400ms |

## Deployment Considerations

### Environment Variables

```bash
# Vector Database
PINECONE_API_KEY=
PINECONE_INDEX_NAME=
PINECONE_NAMESPACE=

# Embeddings & LLM
OPENAI_API_KEY=
EMBED_MODEL=text-embedding-3-large

# Cache Layer
REDIS_URL=
DB_HOST=
DB_DATABASE=
DB_USERNAME=
DB_PASSWORD=

# Optional: Cloud Storage
DROPBOX_ACCESS_TOKEN=
```

### Scaling Notes

- **Horizontal**: Stateless Node.js allows multiple instances
- **Cache**: Redis cluster for high availability
- **Vector DB**: Pinecone serverless scales automatically
- **Ingestion**: Can parallelize across document batches
