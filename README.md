# Applied LLM RAG System

A production-grade Retrieval-Augmented Generation (RAG) platform demonstrating enterprise document processing, hybrid vector search, intelligent caching, and continuous learning from user feedback.

**Author**: Scott Allen

## Overview

This repository showcases the architecture and implementation of a complete RAG pipeline, from document ingestion to real-time chat with streaming responses. Built for a production enterprise environment, it demonstrates practical solutions to real-world challenges in applied LLM engineering.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              DATA PIPELINE                                   │
│                                                                              │
│   Websites ──┬──► Python Crawlers ──┬──► Document Processor ──► Markdown     │ 
│   Dropbox ───┤   (3 specialized)    │   (PDF/DOCX/PPTX/XLSX)      │          │
│   Local ─────┘                      │                              │         │
│                                     └──► Document Mapper ──────────┤         │
│                                         (fuzzy matching)           │         │
└────────────────────────────────────────────────────────────────────┼─────────┘
                                                                     │
┌────────────────────────────────────────────────────────────────────┼─────────┐
│                              RAG ENGINE                            ▼         │
│                                                                              │
│   Ingestion ──► Vector DB ──► Hybrid Search ──► LLM Generation ──► Response  │
│   (dense +      (Pinecone)    (dense + sparse   (with re-ranking)            │
│    sparse)                     + metadata)                                   │
│                                     │                                        │
│                    ┌────────────────┴────────────────┐                       │
│                    ▼                                 ▼                       │
│              2-Tier Cache                    Feedback Learning               │
│           (Redis + PostgreSQL)            (source scoring + patterns)        │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Key Features

### Document Processing (Python)

| Component | Description |
|-----------|-------------|
| **Web Crawlers** | Three specialized crawlers: base (rate-limited), deep (sitemap-aware), authenticated (token-based with lockout prevention) |
| **Document Processor** | Multi-format extraction from PDF, DOCX, PPTX, XLSX with table-to-markdown conversion |
| **Cloud Storage** | Dropbox API integration with pagination, batch processing, and shared link generation |
| **Document Mapper** | Cross-referencing system using fuzzy matching for document relationship detection |

### RAG Intelligence (Node.js)

| Component | Description |
|-----------|-------------|
| **Hybrid Search** | Combines dense (semantic) and sparse (keyword) vectors with configurable alpha blending |
| **LLM Re-ranking** | GPT-5-mini powered re-ranking when top results have similar confidence scores |
| **Two-Tier Cache** | Redis L1 + PostgreSQL L2 caching with protection for positive-feedback entries |
| **Feedback Learning** | Continuous improvement through source scoring and query pattern learning |
| **Streaming Client** | Intelligent response handling with instant cache hits or progressive SSE streaming |

## Repository Structure

```
applied-llm-rag-system/
├── python/                      # Document processing layer
│   ├── crawlers/
│   │   ├── base_crawler.py      # Foundation with session pooling
│   │   ├── deep_crawler.py      # Sitemap parsing + priority queue
│   │   └── authenticated_crawler.py  # Token auth + lockout prevention
│   ├── processors/
│   │   ├── document_processor.py     # PDF/DOCX/PPTX/XLSX extraction
│   │   └── cloud_storage_processor.py # Dropbox API integration
│   ├── mapping/
│   │   └── document_mapper.py   # Fuzzy matching cross-references
│   └── requirements.txt
│
├── src/                         # Node.js RAG layer
│   ├── retrieval/
│   │   └── hybridSearch.js      # Dense + sparse + re-ranking
│   ├── cache/
│   │   └── tieredCache.js       # Redis L1 + PostgreSQL L2
│   ├── feedback/
│   │   ├── feedbackLearning.js  # Source scoring + patterns
│   │   └── commentScorer.js     # Hybrid regex + LLM analysis
│   ├── ingestion/
│   │   └── documentIngestion.js # Vector DB ingestion pipeline
│   └── streaming/
│       └── chatStreamClient.js  # Browser SSE client
│
└── docs/
    └── ARCHITECTURE.md          # Detailed system documentation
```

## Technical Highlights

### Hybrid Search with Re-ranking

```javascript
// Alpha controls semantic vs keyword balance
const alpha = 0.7;  // 0.0 = pure keyword, 1.0 = pure semantic

// LLM re-ranking kicks in when scores are too close
if (topScore - secondScore < RERANK_THRESHOLD) {
  results = await rerankWithLLM(results, query);
}
```

### Two-Tier Cache Architecture

- **L1 (Redis)**: Sub-50ms response for hot queries
- **L2 (PostgreSQL)**: Persistent storage for warm cache
- **Protection**: Positive feedback and manual entries immune to eviction

### Feedback Learning Loop

1. User rates response (helpful/not-helpful)
2. Comment analysis (regex patterns → LLM fallback for ambiguous cases)
3. Source scores updated based on feedback
4. Future retrievals adjusted by learned source quality

### Web Crawling Patterns

- **Sitemap Index Support**: Handles nested sitemap structures
- **Priority Queuing**: Higher priority URLs processed first
- **Rate Limiting**: Configurable delays to avoid IP blocks
- **Lockout Prevention**: Monitors for login redirects, backs off automatically

## Design Principles

1. **Retrieval Quality > Prompt Engineering**: Better retrieved context beats clever prompts
2. **Fail Gracefully**: Every component has fallback behavior
3. **Learn Continuously**: User feedback improves future responses
4. **Cache Aggressively**: Sub-100ms responses for common queries
5. **Hybrid Approaches**: Dense + sparse search, regex + LLM scoring

## Performance Characteristics

| Operation | Target | Notes |
|-----------|--------|-------|
| Cache hit (Redis) | <50ms | ~15ms achieved |
| Cache hit (PostgreSQL) | <100ms | ~45ms achieved |
| Vector search | <500ms | Includes alpha blending |
| Streaming first token | <500ms | SSE progressive display |

## Technology Stack

- **Python 3.9+**: Document processing, web crawling
- **Node.js 18+**: RAG orchestration, API layer
- **Pinecone**: Serverless vector database
- **Redis**: L1 cache layer
- **PostgreSQL**: L2 cache + feedback storage
- **OpenAI**: Embeddings (text-embedding-3-large) + LLM (GPT-4)

## What This Repository Demonstrates

- Production-grade RAG architecture patterns
- Multi-format document processing pipelines
- Hybrid search strategies beyond naive similarity
- Caching patterns for LLM applications
- Continuous learning from user feedback
- Enterprise crawling with authentication handling

## What This Repository Does Not Include

- Proprietary datasets or credentials
- Production infrastructure configuration
- Enterprise authentication systems
- Internal prompts or domain-specific policies

## Getting Started

### Prerequisites

```bash
# Python dependencies
pip install -r python/requirements.txt

# Node.js dependencies
npm install
```

### Environment Variables

```bash
# Vector Database
PINECONE_API_KEY=your_key
PINECONE_INDEX_NAME=your_index

# OpenAI
OPENAI_API_KEY=your_key
EMBED_MODEL=text-embedding-3-large

# Cache Layer
REDIS_URL=redis://localhost:6379
DB_HOST=localhost
DB_DATABASE=rag_cache
DB_USERNAME=user
DB_PASSWORD=password
```

### Running Ingestion

```bash
# Ingest documents from a directory
npm run ingest docs/

# Dry run (no changes)
npm run ingest -- --dry

# Purge and re-ingest
npm run ingest -- --purge
```

## Author

**Scott Anderson**

This project is based on real-world production experience building enterprise RAG systems. The code has been sanitized and generalized for public sharing while preserving the architectural patterns and technical approaches.

## License

MIT (reference implementation only)
