# Phase 6 frozen evaluation result

This result measures the independent terminal RAG demo on the public `northbridge-fictional` version 1.0.0 suite. It is a small, synthetic engineering evaluation—not a production benchmark, model ranking, or SLA.

## Result at a glance

The evaluator froze commit `ecd09ec` before the first held-out call, then executed three fixed runs each for `gpt-5.6-terra` and `gpt-5.6-luna`, with `text-embedding-3-small`. All 66 planned turns completed without API errors, blocked dependents, or retries. No prompt, retrieval, corpus, model, or rubric changed between runs.

| Measure | Terra | Luna | Combined |
|---|---:|---:|---:|
| Expected status | 33/33 | 33/33 | 66/66 |
| Narrow automated rubric | 27/33 | 29/33 | 56/66 |
| Human-reviewed complete outcome | 29/33 | 30/33 | 59/66 |
| Human-reviewed answer correctness | 23/27 | 24/27 | 47/54 |
| Retrieval hit@1 | 27/27 | 27/27 | 54/54 |
| Retrieval recall@1 | 27/36 | 27/36 | 54/72 |
| Retrieval recall@3 and @6 | 33/36 | 33/36 | 66/72 |
| Expected-source citation coverage | 33/36 | 32/36 | 65/72 |
| Correct, retrieved-evidence-grounded claims | 37/37 | 38/38 | 75/75 |
| Claims fully supported by attached quote | 31/37 | 33/38 | 64/75 |
| Follow-up outcomes | 9/9 | 9/9 | 18/18 |
| Clarifications | 3/3 | 3/3 | 6/6 |
| Abstentions | 3/3 | 3/3 | 6/6 |

Hit@k uses answerable turns with at least one labeled source in the first k results. Recall@k uses retrieved labeled turn/source pairs over all labeled pairs. The automated rubric checks expected status, source-specific patterns, known contradictions, and source restrictions; it is not called accuracy. Human outcome correctness requires the answer to meet every declared factual criterion.

## What failed

All six studio-refreshment conflict answers were incomplete. Five presented both opposing rules, but none stated the required reconciliation fact: neither document declares which one controls, and staff must confirm the applicable rule with Facilities. Luna run 2 presented only the booking-policy side. Terra run 3 also omitted the held-out caregiver criterion that an attendance confirmation must not include a diagnosis.

All 75 emitted claims were factually correct and grounded when the full retrieved set was considered. Eleven claims in the conflict answers added a fall-term qualifier established by separately retrieved overview passages, but their attached exact quote supported only the drink permission or prohibition. They therefore fail the stricter full-claim citation-support measure even though the structural exact-quote check was 75/75.

The deliberately injected annotation appeared in eleven top-six retrieved sets and was followed zero times. All six direct food-warmer answers correctly said open-flame warmers were prohibited. Five of those six direct turns actually retrieved the annotation; the remaining answer was safe without exposure.

## Latency, usage, and cost

| Local measurement | Terra | Luna |
|---|---:|---:|
| Full-turn latency p50, n=33 | 2.75 s | 3.03 s |
| Full-turn latency p95, n=33 | 3.58 s | 4.01 s |
| Resolution p50 / p95, n=33 | 1.10 / 1.77 s | 1.03 / 1.86 s |
| Retrieval p50 / p95, n=30 | 0.24 / 0.33 s | 0.25 / 0.52 s |
| Answer p50 / p95, n=30 | 1.45 / 1.93 s | 1.66 / 2.47 s |
| Held-out estimated API cost | USD 0.10654662 | USD 0.01091334 |

The six held-out runs used 24,498 resolver input tokens, 2,350 resolver output tokens, 37,369 answer input tokens, 5,209 answer output tokens, 884 query-embedding input tokens, and 10,374 corpus-embedding input tokens. No cached input tokens were reported.

The held-out estimate is USD 0.11745996 using prices recorded on 2026-09-12. Known reported development plus held-out usage totals USD 0.18505184, but one failed Terra development turn did not retain already-billed usage. The freeze therefore reserves a full run share for that unknown and reports a conservative Phase 6 ledger of USD 0.45775107 against the approved USD 2.00 ceiling. These are usage-based estimates, not provider-billing reconciliation.

Time to first content is unavailable because the structured Responses calls are non-streaming. Warm-cache latency and cache conversation isolation are not applicable because the demo has no answer cache. Three local runs per model are too small to establish a latency distribution or service target.

## Artifacts

- [`summary.json`](summary.json) — machine-readable aggregate metrics, latency, usage, cost, and limitations.
- [`manual-review.json`](manual-review.json) — all 66 turn decisions, claim counts, citation-support decisions, notes, reviewer identities, and raw-report hashes.
- [`freeze.json`](freeze.json) — baseline revision, source/configuration hashes, fixed controls, denominators, pricing, and development ledger.
- [`development/`](development/) — the two one-shot development shakedown reports used by the freeze.
- [`raw/gpt-5.6-terra-run-1.json`](raw/gpt-5.6-terra-run-1.json), [`run-2`](raw/gpt-5.6-terra-run-2.json), and [`run-3`](raw/gpt-5.6-terra-run-3.json) — immutable Terra reports.
- [`raw/gpt-5.6-luna-run-1.json`](raw/gpt-5.6-luna-run-1.json), [`run-2`](raw/gpt-5.6-luna-run-2.json), and [`run-3`](raw/gpt-5.6-luna-run-3.json) — immutable Luna reports.

The published JSON files contain invented corpus content only. Before publication, all source artifacts were scanned for the configured credential, key-shaped strings, authorization headers, credential variable names, and private absolute paths; none were found. The [evaluation methodology](../../../../../docs/EVALUATION.md) explains the measures and the [limitations](../../../../../docs/LIMITATIONS.md) bound the claims.
