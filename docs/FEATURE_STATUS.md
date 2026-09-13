# Feature verification

The historical matrix below records the initial audit of the original 21 tracked files and nine locally available commits. The independent `demo/` modules provide the runnable application; the original `src/` and `python/` examples and their audit findings remain unchanged.

“README claim” summarizes the earlier wording, not a renewed claim. “Runnable” means reproducible using instructions supplied with this checkout. A component may contain substantial logic while still lacking working setup or integration. The independent demo now has focused offline tests; these do not cover the original application components or establish a complete application test suite.

## Independent demonstration

| Scope | Implementation evidence | Verification boundary |
|---|---|---|
| Local execution | Root `package.json`, `demo/cli.mjs`, and the [local demo guide](LOCAL_DEMO.md) | Node.js 24.21.0 pinned; no npm dependencies; hosted API credentials required for chat |
| Reproducible infrastructure | `.nvmrc`, runtime/configuration preflight, and credential-free GitHub Actions workflow | 84 offline tests pass locally on the pinned runtime; hosted runs and historical counts are recorded in the [verification record](LOCAL_DEMO.md#runtime-and-ci-verification) |
| Fictional ingestion and retrieval | Ten allowlisted Markdown documents, 38 stable-ID passages, in-memory vectors, cosine/keyword rank fusion | Versioned corpus is separate from legacy ingestion and managed-vector examples |
| Grounded direct answer | Structured claims with retrieved source IDs and exact evidence quotations | Live supervisor-approval lookup passed; quotation checks do not prove claim support |
| Follow-up context | Last six completed exchanges, standalone query resolution, fresh retrieval, clarification path | Implemented; ten focused live checks passed on 2026-09-12; see [verification record](LOCAL_DEMO.md#verification-record) |
| Inspection and evaluation | Offline tests, development runner, frozen held-out runner, raw per-call provenance, automatic metrics, and all-turn human review | Phase 6 ran 66 held-out turns with 59/66 strict human outcome correctness; see the [result](../evaluation/fictional/v1/results/phase-6/README.md). The small public fictional suite is not a production benchmark; no warm-cache test applies |

The demo does not implement caching, feedback, streaming, a browser interface, or legacy service integration. The Phase 6 evaluation is bounded to the frozen fictional suite and is not a comprehensive security review.

## Original component evidence matrix

| Feature | README claim | Code evidence | Runnable | Tested | Status |
|---|---|---|---|---|---|
| Web crawling | Three specialized crawlers | [Crawler modules](../python/crawlers/) contain request, queue, sitemap, and authentication logic | Not verified | Static review only | Partially implemented |
| Document extraction | PDF, DOCX, PPTX, XLSX handling | [Processor](../python/processors/document_processor.py) contains format-specific extraction | Not verified | Static review only | Partially implemented |
| Cloud storage | Pagination, batches, shared links | [Cloud processor](../python/processors/cloud_storage_processor.py) calls storage APIs | Requires account; not verified | Static review only | Example only |
| Document mapping | Fuzzy cross-references | [Mapper](../python/mapping/document_mapper.py) indexes names and compares similarity | Not verified | Static review only | Partially implemented |
| Chunking and ingestion | Document-to-index pipeline | [Ingestion](../src/ingestion/documentIngestion.js) chunks text and prepares upserts | Setup blocked | Static review only | Partially implemented |
| Duplicate detection | Claimed in architecture | Ingestion records hashes without checking duplicates | No verified behavior | No | Documentation only |
| Embeddings | Hosted dense embeddings | Ingestion and [retrieval](../src/retrieval/hybridSearch.js) call an embedding API | Provider setup absent | No API checks | Partially implemented |
| Hybrid retrieval | Configurable dense/sparse blending | Retrieval builds dense and hashed term vectors and passes query options | Provider setup absent | Static review only | Partially implemented |
| Reranking | Conditional model reranking | Retrieval contains model-based reordering and a fallback | Provider setup absent | Static review only | Partially implemented |
| Grounded generation | Complete RAG pipeline | No answer-generation server or chat route | No | No | Documentation only |
| Citations | Source attribution | Source metadata and [client source events](../src/streaming/chatStreamClient.js) | No complete flow | No citation checks | Partially implemented |
| Two-tier cache | Redis/PostgreSQL with protected entries | [Cache](../src/cache/tieredCache.js) implements lookups and writes; schema setup absent | Setup blocked | Static review only | Partially implemented |
| Semantic cache matching | Described in cache comments | Cache execution has no semantic lookup stage | No | No | Documentation only |
| Feedback | Continuous improvement | [Feedback modules](../src/feedback/) score comments and adjust source scores | No complete flow | Static review only | Partially implemented |
| Streaming | Cached JSON or progressive SSE | Browser client and callbacks; no paired server or interface | Isolated checks only | Three defects reproduced | Partially implemented |
| Custom follow-up chat | Not explicitly claimed | Client transcript and session ID; no server-side context resolution | No | No conversational tests | Unverified |
| Evaluation | No framework supplied | Original components have no evaluation integration; the independent demo owns separate versioned fixtures | No | No | Not implemented in original components |
| Injection defenses | No demonstrated controls | No dedicated controls or adversarial suite | No | No | Not implemented |
| Observability and failure handling | Graceful fallback throughout | Component catches, timing fields, and console logs | Partial components only | No integrated checks | Partially implemented |

## Original component verification

- All nine JavaScript files passed syntax parsing in module mode under the audit environment's Node.js v25.8.1.
- All nine Python files passed AST parsing under Python 3.12.3. Modules were not imported or run against services.
- In-memory streaming checks reproduced CRLF content loss, cancellation leaving a message marked as streaming, and overlapping sends before the request guard activates.
- Source inspection established the other recorded gaps. These observations are not connected-service test results.
- A limited credential-pattern review of local history found no matching embedded credential literals. This is not a provenance certification or an exhaustive secret scan.

The audit runtimes are recorded for context, not declared supported versions. No benchmark, paid API call, cloud-account operation, or production deployment was used to establish these findings.

[LIMITATIONS.md](LIMITATIONS.md) documents known gaps, and [EVALUATION.md](EVALUATION.md) defines the measurement methodology.
