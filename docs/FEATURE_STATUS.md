# Feature verification

This matrix records the Phase 1 audit of the original 21 tracked files and nine locally available commits. Phase 2 changes documentation and supporting references only; application behavior is unchanged.

“README claim” summarizes the earlier wording, not a renewed claim. “Runnable” means reproducible using instructions supplied with this checkout. A component may contain substantial logic while still lacking working setup or integration. No complete application test suite exists.

## Evidence matrix

| Feature | README claim | Code evidence | Runnable | Tested | Status | Recommended action |
|---|---|---|---|---|---|---|
| Web crawling | Three specialized crawlers | [Crawler modules](../python/crawlers/) contain request, queue, sitemap, and authentication logic | Not verified | Static review only | Partially implemented | Repair imports, validate destinations, add bounded synthetic fixtures |
| Document extraction | PDF, DOCX, PPTX, XLSX handling | [Processor](../python/processors/document_processor.py) contains format-specific extraction | Not verified | Static review only | Partially implemented | Distinguish failed extraction from document content and reject unsupported formats |
| Cloud storage | Pagination, batches, shared links | [Cloud processor](../python/processors/cloud_storage_processor.py) calls storage APIs | Requires account; not verified | Static review only | Example only | Exclude real account access from the demo; correct public-sharing defaults |
| Document mapping | Fuzzy cross-references | [Mapper](../python/mapping/document_mapper.py) indexes names and compares similarity | Not verified | Static review only | Partially implemented | Resolve relative links and verify crawler integration |
| Chunking and ingestion | Document-to-index pipeline | [Ingestion](../src/ingestion/documentIngestion.js) chunks text and prepares upserts | Setup blocked | Static review only | Partially implemented | Repair dry run, document identity, and replacement handling |
| Duplicate detection | Claimed in architecture | Ingestion records hashes without checking duplicates | No verified behavior | No | Documentation only | Implement separately or keep the claim removed |
| Embeddings | Hosted dense embeddings | Ingestion and [retrieval](../src/retrieval/hybridSearch.js) call an embedding API | Provider setup absent | No API checks | Partially implemented | Validate provider configuration and use test doubles |
| Hybrid retrieval | Configurable dense/sparse blending | Retrieval builds dense and hashed term vectors and passes query options | Provider setup absent | Static review only | Partially implemented | Verify weighting, index compatibility, SDK calls, and metadata filters |
| Reranking | Conditional model reranking | Retrieval contains model-based reordering and a fallback | Provider setup absent | Static review only | Partially implemented | Validate ranking output and measure benefit against added cost |
| Grounded generation | Complete RAG pipeline | No answer-generation server or chat route | No | No | Documentation only | Build an independent approved slice with evidence-based answers |
| Citations | Source attribution | Source metadata and [client source events](../src/streaming/chatStreamClient.js) | No complete flow | No citation checks | Partially implemented | Check source membership and support for each cited claim |
| Two-tier cache | Redis/PostgreSQL with protected entries | [Cache](../src/cache/tieredCache.js) implements lookups and writes; schema setup absent | Setup blocked | Static review only | Partially implemented | Add schema, contextual eligibility, freshness checks, and isolation tests |
| Semantic cache matching | Described in cache comments | Cache execution has no semantic lookup stage | No | No | Documentation only | Avoid presenting this as an implemented cache tier |
| Feedback | Continuous improvement | [Feedback modules](../src/feedback/) score comments and adjust source scores | No complete flow | Static review only | Partially implemented | Fix storage and classification errors; evaluate impact |
| Streaming | Cached JSON or progressive SSE | Browser client and callbacks; no paired server or interface | Isolated checks only | Three defects reproduced | Partially implemented | Fix event framing, cancellation, and overlapping requests |
| Custom follow-up chat | Not explicitly claimed | Client transcript and session ID; no server-side context resolution | No | No conversational tests | Unverified | Define owner-confirmed scope and independently demonstrate contextual turns |
| Evaluation | No framework supplied | No corpus, fixtures, harness, or result artifacts | No | No | Planned | Implement the documented methodology in a later approved phase |
| Injection defenses | No demonstrated controls | No dedicated controls or adversarial suite | No | No | Planned | Test user/document instructions, poisoning, and citation spoofing |
| Observability and failure handling | Graceful fallback throughout | Component catches, timing fields, and console logs | Partial components only | No integrated checks | Partially implemented | Add bounded requests, redaction, health behavior, and meaningful diagnostics |

## Verification performed

- All nine JavaScript files passed syntax parsing in module mode under the audit environment's Node.js v25.8.1.
- All nine Python files passed AST parsing under Python 3.12.3. Modules were not imported or run against services.
- In-memory streaming checks reproduced CRLF content loss, cancellation leaving a message marked as streaming, and overlapping sends before the request guard activates.
- Source inspection established the other recorded gaps. These observations are not connected-service test results.
- A limited credential-pattern review of local history found no matching embedded credential literals. This is not a provenance certification or an exhaustive secret scan.

The audit runtimes are recorded for context, not declared supported versions. No benchmark, paid API call, cloud-account operation, or production deployment was used to establish these findings.

## How status changes

Use these labels: **Implemented**, **Partially implemented**, **Example only**, **Documentation only**, **Planned**, **Unverified**, or **Broken**. A feature should move to Implemented only when its declared scope works and the repository supplies evidence for that scope. Correcting prose does not advance implementation status.

Track project milestones in [ROADMAP.md](../ROADMAP.md), known gaps in [LIMITATIONS.md](LIMITATIONS.md), and future measurement requirements in [EVALUATION.md](EVALUATION.md).
