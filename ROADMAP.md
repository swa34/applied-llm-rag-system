# Roadmap

The first two phases establish what the repository contains and how to describe it accurately. Phase 3 adds a local terminal demonstration checked against fictional documents. The next phase strengthens its runtime and reliability support.

| Phase | Scope | Status | Completion criteria |
|---|---|---|---|
| 1. Repository audit | Review component behavior, setup, claims, and known gaps | Complete | Evidence recorded in the feature matrix and limitations |
| 2. Documentation | Explain the architecture and custom follow-up challenge in an independent showcase | Complete | Clear feature status, design discussion, security notes, and evaluation methodology |
| 3. Local demonstration | Connect document loading, retrieval, grounded answers, and citations | Complete | Local terminal run, diagnostic timing, citation checks, and ten focused live cases; see the [demo guide](docs/LOCAL_DEMO.md) for evidence and limits |
| 4. Infrastructure | Add the runtime, dependency, and reliability support the demo needs | Planned | Locked dependencies, configuration checks, automated tests, and CI |
| 5. Synthetic dataset | Create fictional institutional documents and conversation cases | Planned | Versioned sources and expected outcomes covering exact terms, paraphrases, ambiguity, conflicting evidence, and malicious instructions |
| 6. Evaluation | Measure retrieval and answer behavior, including follow-ups | Planned | Reproducible per-case results, failure explanations, and quality, latency, and cost measurements |
| 7. Security review | Assess the implemented demonstration and its trust boundaries | Planned | Evidence for tested controls and a clear account of residual risks |
| 8. Portfolio presentation | Show the working demonstration and its engineering decisions | Planned | A verified screenshot or recording and concise results linked to their methodology |

The phases describe the intended sequence. A small demonstration will need a few fictional fixtures and focused checks before the broader dataset and evaluation work is complete.

## Next: reproducible infrastructure

The demonstration uses OpenAI with an in-memory index after comparing hosted and local inference and local and managed storage. Four fictional Markdown documents exercise distinct follow-up contexts, ambiguous references, topic changes, and missing evidence. Model and retrieval boundaries remain replaceable; only the approved provider is integrated.

Phase 4 should establish and verify the supported runtime, configuration checks, automated CI, and appropriate reliability behavior. The demo has no third-party npm dependencies; locking and vulnerability checks should follow the actual dependency footprint. The broader dataset, held-out evaluation, security review, and presentation remain later work.

The [design case study](docs/CASE_STUDY.md) describes those conversations. The [feature matrix](docs/FEATURE_STATUS.md), [limitations](docs/LIMITATIONS.md), and [evaluation plan](docs/EVALUATION.md) provide the baseline and acceptance criteria.
