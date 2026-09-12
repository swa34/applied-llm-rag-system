# What works here, and what still needs work

This checkout now contains an independent Phase 3 terminal RAG demonstration alongside the original component examples and design material. The initial Phase 1 review checked the original tracked files and local commit history; syntax checks passed, but that audit did not run a connected-service demonstration. Ten focused live checks for the new demo passed on 2026-09-12; see [LOCAL_DEMO.md](LOCAL_DEMO.md#verification-record) for the verification record and earlier failures.

The [README](../README.md) is the starting point for the showcase. This page records the practical limits behind its claims.

## Independent demo limits

The [local demo guide](LOCAL_DEMO.md) documents Node.js 22.9 or newer, an existing OpenAI credential, and commands for interactive chat, live scenarios, and offline tests. Its root package manifest has no external dependencies. The four synthetic documents and focused tests establish a small implementation scope, not a representative dataset or formal evaluation.

The demo rebuilds an in-memory index on every start, calls hosted inference, and retains at most six completed exchanges per conversation. It has no answer cache, streaming interface, or legacy service integration. Citation checks establish retrieved source membership and exact quotation text; they do not prove that a quote supports its attached claim. Model decisions and retrieval coverage remain fallible.

The index caches normalized vectors and keyword sets, but lexical ranking remains a count of distinct shared terms. It has no inverse document frequency or length normalization and favors passages that cover more query terms. It is not BM25. Long source lines are split into passages of at most 1,800 characters with exact text and source-line references preserved; that size bound alone does not establish ideal semantic boundaries.

Grouping citations by source preserves each claim's quote and reference, but does not validate its reasoning. The scenario checks require source-specific fixture facts and reject known contradictions or negations; unfamiliar wording and unsupported claims can still evade pattern checks. The historical ten-check result predates these review changes; see the separate [review verification record](LOCAL_DEMO.md#pr-review-verification).

Only the default model configuration has been live-tested. Other models must support the demo's structured Responses request and output limits. Temperature is omitted outside the recognized standard GPT-4.1/GPT-4o aliases and dated snapshots, but this does not ensure compatibility. Resolver and answer output limits are 512 and 4,096 tokens respectively; either can be exhausted. Incomplete responses fail with sanitized explanations. HTTP 429 guidance distinguishes possible rate and quota issues without inspecting the error body, so it cannot diagnose which occurred. There are no automatic retries.

## Original component setup and integration

- Original JavaScript components import external packages without a resolved dependency setup or lockfile; the root demo manifest does not install those dependencies.
- Python requirements specify minimum versions; a reproducible resolved environment has not been established.
- An ingestion command exists, but a complete answer-generation server and chat endpoint are absent.
- Cache storage expects database tables without accompanying setup migrations.
- Python import paths are inconsistent across package and direct-script execution.
- The demo tests and tiny fictional corpus do not cover these original components. There is no CI workflow or formal evaluation result set.

The examples reference hosted model and vector services as well as Redis, PostgreSQL, and cloud storage. Listing those dependencies does not establish compatibility, availability, or a working local setup. The independent demo supplies its own documented execution path without connecting those services.

## Original component correctness gaps

| Area | Limitation found during review |
|---|---|
| Document ingestion | Files with the same basename can produce colliding chunk identifiers. Replacing a document with a shorter version can leave older chunks behind. |
| Retrieval filters | Default categories used by ingestion and retrieval do not agree. |
| Extraction | Some failures become document text and are counted as successful processing. Older Office formats are routed to readers for newer formats. |
| Document mapping | Relative-link resolution needs correction. |
| Streaming | Isolated checks reproduced dropped content with CRLF-delimited events, incomplete cancellation state, and overlapping-request handling failures. |
| Feedback | Fractional scoring reaches an integer count field; initial and subsequent updates behave differently. |
| Citations | Source metadata and client events exist, but there is no verified flow from retrieval to a grounded, cited answer. |

The [security notes](SECURITY.md) cover additional concerns around dry runs, public sharing, cache context, transport, and logs. The independent demo does not fix these original component behaviors.

## Custom follow-up chat

The client keeps message history locally and sends the current message with a session identifier. That does not establish reliable server-side follow-up reasoning.

A short question such as “Does that apply to weekends?” depends on the preceding exchange. The system must resolve what “that” means, retrieve evidence for the new question, and avoid reusing an answer from a different conversation. Topic changes, ambiguous references, and interrupted responses add further cases to handle.

The independent terminal demo implements context resolution, clarification, and topic switching. Ten focused live checks passed on 2026-09-12; see [LOCAL_DEMO.md](LOCAL_DEMO.md#verification-record). It does not supply a browser chat server or verify conversation-aware cache reuse. Descriptions of professional work should be limited to responsibilities the author confirms; this repository alone cannot establish those details.

## Evidence still missing

The demo records per-turn timing and API usage, but there is no formal measurement of latency distributions, cost savings, retrieval quality, or improvement from feedback. No rendered chat interface is available for keyboard, focus, screen-reader, or cancellation accessibility checks. The demo declares Node.js 22.9 or newer; a broader runtime compatibility matrix has not been verified. Dependency vulnerabilities in the original components have not been checked against a resolved installation.

The [evaluation plan](EVALUATION.md) defines how to gather that evidence. Future features and measurements should stay labeled as planned until their checks have run.
