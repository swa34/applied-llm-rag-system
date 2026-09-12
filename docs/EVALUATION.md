# Evaluation methodology

The demo now has a versioned fictional corpus and separate development and held-out case manifests, but no held-out run or formal benchmark result has been produced. The independent demo includes ten fictional documents, 38 passages, offline integrity tests, and a development scenario runner.

Evaluation should measure both answers from fictional documents and follow-up handling, with results that show where the system succeeds and where it fails.

## Current focused checks

The [local demo guide](LOCAL_DEMO.md) documents `npm test` for deterministic offline checks and `npm run demo:cases` for live development scenarios. Ten earlier focused checks passed on 2026-09-12; the [verification record](LOCAL_DEMO.md#verification-record) documents the smaller pre-versioned corpus, prompt failures, and known-case tuning. The development runner now reads only the development manifest and records the dataset identity, suite identity and hash, resolved queries, retrieved passages, citations, outcomes, timing, and usage.

The versioned [dataset overview](../sample-data/fictional/README.md) links the two machine-readable suites. The development split has 13 self-contained conversations and 21 turns; it retains the ten tuned cases and adds coverage for the expanded documents. The held-out split has eight conversations and eleven turns with disjoint identifiers and normalized conversation seeds. It is validated for structure and source references but is not imported by the development runner.

These remain compact fixtures, not a representative benchmark. Exact quote and source-membership checks do not score semantic entailment, conflict and adversarial cases require human review, and a scenario pass is not a general groundedness or reliability result. The demo has no answer cache, so these checks cannot establish behavior with warm caches.

The methodology below describes the broader evidence still needed.

## Build a useful test set

The `northbridge-fictional` corpus is versioned at `1.0.0`. Its explicit manifest allowlists every evidence document and maps each heading to a stable passage identifier. Case rubrics are stored outside the retrievable document tree. Every case is a self-contained ordered conversation whose turns specify a status, supporting passages and factual patterns when answerable, or an explicit clarification or insufficient-evidence outcome.

Offline validation rejects malformed or duplicate identifiers, unsafe or unlisted document paths, missing or oversized passages, unresolved source labels, invalid rubric patterns, incomplete conversations, missing category coverage, and exact normalized split overlap. It proves structural separation and source referential integrity; it cannot prove that no person saw a public file or detect every semantic paraphrase.

Include direct lookups, paraphrases, exact terms, conflicting documents, missing facts, topic changes, and ambiguous references. Conversation cases must include the preceding turns: scoring only the final question would remove the very context being tested.

Future versions can add new conversations without reusing exposed questions. For example, an invented equipment-lending guide could support this sequence:

1. “How long can a visitor borrow a camera?”
2. “Can they renew it?”
3. “What about a tripod?”

That published example is illustrative and must not be treated as an unseen case. Expected behavior should specify when the subject carries forward and when fresh retrieval is required. An ambiguous question should allow a clarification instead of rewarding a plausible guess.

## Measures to report

| Measure | What to record |
|---|---|
| Retrieval hit rate at k | Fraction of answerable questions with at least one labeled supporting passage in the first k results; exclude no-answer cases and report their outcomes separately. |
| Retrieval recall at k | Fraction of labeled supporting passages appearing in the first k results; publish k and how passages were labeled. |
| Answer correctness | Whether the answer meets the case's factual criteria, assessed separately from fluent writing. |
| Grounding | Fraction of checkable answer claims supported by the supplied evidence, with unsupported claims listed. |
| Citation validity | Whether each citation identifies a retrieved source and supports the attached claim; also report uncited factual claims. |
| Follow-up resolution | Whether the system carries forward the right subject, handles topic changes, and asks for clarification when needed. |
| Abstention and refusal | Missing-evidence cases where the system declines to invent an answer, plus answerable cases it unnecessarily declines. |
| Conversation isolation | Whether identical follow-up wording in different conversations remains distinct, including when caches are warm. |
| Failure recovery | Outcomes for cancellation, timeouts, malformed stream events, and unavailable dependencies. |
| Latency | Time to first answer content and full completion, reported separately for cold requests and each cache path. |
| Cost | Observed token usage and estimated API cost per run, including embeddings, reranking, retries, and other billed calls; distinguish estimates from confirmed provider billing. |

Report counts and denominators alongside rates. Keep retrieval, grounding, and correctness separate: finding the right passage does not guarantee a correct answer.

## Compare one change at a time

Start with a fixed retrieval-and-answer baseline. Use the same corpus and cases when comparing hybrid retrieval, reranking, contextual query resolution, caching, or feedback adjustments. Record configuration changes so an apparent gain cannot be attributed to an unnoticed model or dataset change.

For feedback, keep tuning interactions separate from held-out questions. Evaluate whether changes help some cases while harming others; a higher source score is not itself evidence of a better answer.

## Adversarial and failure cases

Place fictional instructions inside retrieved documents that ask the system to ignore the user or reveal a made-up secret. Check that document content is treated as evidence rather than authority. Include fabricated citation requests, unavailable facts, conflicting sources, and two conversations with identical final questions but different subjects.

Exercise interrupted and concurrent requests with deterministic fixtures before adding network variability. The [security notes](SECURITY.md) identify broader controls that require their own implementation and review.

## Publish enough to reproduce the result

Each result set should identify the repository revision, dataset version, runtime and dependency versions, model/provider identifiers, retrieval settings, cache state, number of runs, and scoring rubric. Save per-case outcomes, source identifiers, timings, token counts, and failures using synthetic content only.

Each case should retain the question and prior turns, expected sources, required facts, disallowed claims, expected refusal or clarification, retrieved identifiers, retrieval success, citation correctness, groundedness, latency, estimated cost, pass/fail outcome, and a failure explanation. Treat no-answer cases separately when a retrieval metric has no relevant-source denominator.

Repeat latency runs and report median and tail measurements with sample counts. Date any pricing assumptions. Include total evaluation cost and per-request cost rather than claiming savings from cache-hit timing alone.

Review ambiguous scores by hand. If a model assists grading, record its version and rubric and compare a sample against human judgments. Publish failures with successful cases. Only then add measured results to the [README](../README.md).
