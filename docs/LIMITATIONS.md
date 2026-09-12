# What works here, and what still needs work

This checkout contains component examples and design material. It is not yet a reproducible end-to-end RAG application. The initial review checked the tracked files and local commit history; syntax checks passed, but no connected-service demonstration was run.

The [README](../README.md) is the starting point for the showcase. This page records the practical limits behind its claims.

## Setup and integration

- JavaScript components import external packages, but there is no dependency manifest or lockfile.
- Python requirements specify minimum versions; a reproducible resolved environment has not been established.
- An ingestion command exists, but a complete answer-generation server and chat endpoint are absent.
- Cache storage expects database tables without accompanying setup migrations.
- Python import paths are inconsistent across package and direct-script execution.
- There is no automated test suite, CI workflow, synthetic corpus, or evaluation result set.

The examples reference hosted model and vector services as well as Redis, PostgreSQL, and cloud storage. Listing those dependencies does not establish compatibility, availability, or a working local setup. A future demonstration needs one documented path from a fresh checkout to a verifiable result.

## Known correctness gaps

| Area | Limitation found during review |
|---|---|
| Document ingestion | Files with the same basename can produce colliding chunk identifiers. Replacing a document with a shorter version can leave older chunks behind. |
| Retrieval filters | Default categories used by ingestion and retrieval do not agree. |
| Extraction | Some failures become document text and are counted as successful processing. Older Office formats are routed to readers for newer formats. |
| Document mapping | Relative-link resolution needs correction. |
| Streaming | Isolated checks reproduced dropped content with CRLF-delimited events, incomplete cancellation state, and overlapping-request handling failures. |
| Feedback | Fractional scoring reaches an integer count field; initial and subsequent updates behave differently. |
| Citations | Source metadata and client events exist, but there is no verified flow from retrieval to a grounded, cited answer. |

The [security notes](SECURITY.md) cover additional concerns around dry runs, public sharing, cache context, transport, and logs. Documentation changes do not fix these behaviors.

## Custom follow-up chat

The client keeps message history locally and sends the current message with a session identifier. That does not establish reliable server-side follow-up reasoning.

A short question such as “Does that apply to weekends?” depends on the preceding exchange. The system must resolve what “that” means, retrieve evidence for the new question, and avoid reusing an answer from a different conversation. Topic changes, ambiguous references, and interrupted responses add further cases to handle.

Context resolution, clarification, topic switching, and conversation-aware cache reuse remain unverified in this checkout. Descriptions of professional work should be limited to responsibilities the author confirms; this repository alone cannot establish those details.

## Evidence still missing

There are no reproducible measurements supporting latency, cost savings, retrieval quality, or improvement from feedback. No rendered chat interface is available for keyboard, focus, screen-reader, or cancellation accessibility checks. Dependency vulnerabilities and supported runtime versions have not been verified against a resolved installation.

The [evaluation plan](EVALUATION.md) defines how to gather that evidence. Future features and measurements should stay labeled as planned until their checks have run.
