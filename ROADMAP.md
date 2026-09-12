# Roadmap

The first two phases establish what the repository contains and how to describe it accurately. Phase 3 adds a local terminal demonstration checked against fictional documents. Phase 4 adds pinned runtime support, configuration checks, and offline reliability verification; its first hosted CI run is pending publication.

| Phase | Scope | Status | Completion criteria |
|---|---|---|---|
| 1. Repository audit | Review component behavior, setup, claims, and known gaps | Complete | Evidence recorded in the feature matrix and limitations |
| 2. Documentation | Explain the architecture and custom follow-up challenge in an independent showcase | Complete | Clear feature status, design discussion, security notes, and evaluation methodology |
| 3. Local demonstration | Connect document loading, retrieval, grounded answers, and citations | Complete | Local terminal run, diagnostic timing, citation checks, and ten focused live cases; see the [demo guide](docs/LOCAL_DEMO.md) for evidence and limits |
| 4. Infrastructure | Add the runtime, dependency, and reliability support the demo needs | Implemented; hosted CI pending | Pinned Node runtime, no third-party npm dependencies, configuration checks, 57 passing offline tests, and CI workflow; first hosted run remains to be verified |
| 5. Synthetic dataset | Create fictional institutional documents and conversation cases | Planned | Versioned sources and expected outcomes covering exact terms, paraphrases, ambiguity, conflicting evidence, and malicious instructions |
| 6. Evaluation | Measure retrieval and answer behavior, including follow-ups | Planned | Reproducible per-case results, failure explanations, and quality, latency, and cost measurements |
| 7. Security review | Assess the implemented demonstration and its trust boundaries | Planned | Evidence for tested controls and a clear account of residual risks |
| 8. Portfolio presentation | Show the working demonstration and its engineering decisions | Planned | A verified screenshot or recording and concise results linked to their methodology |

The phases describe the intended sequence. A small demonstration will need a few fictional fixtures and focused checks before the broader dataset and evaluation work is complete.

## Next: hosted CI verification, then the synthetic dataset

Phase 4 pins Node.js 24.21.0, checks runtime and configuration before API work, and adds a credential-free CI workflow. All 57 offline tests passed locally, including a clean-copy run with no environment file or installed packages. Provider deadlines and failed-turn recovery have focused regression coverage. The model update defaults to GPT-5.6 Terra and supports Luna through the existing override; each passed ten focused live cases after the documented resolver and checker corrections. There are no third-party npm packages to lock or audit in this demo; legacy dependency resolution remains outside its scope. See the [local verification record](docs/LOCAL_DEMO.md#phase-4-local-verification).

Publish the Phase 4 branch and confirm its first GitHub Actions result to close the infrastructure milestone. Phase 5 then expands the existing four fictional documents into a versioned corpus and conversation cases covering exact terms, paraphrases, ambiguity, conflicting evidence, and malicious instructions. Keep held-out cases separate from prompt tuning for Phase 6 evaluation.

The [design case study](docs/CASE_STUDY.md), [feature matrix](docs/FEATURE_STATUS.md), [limitations](docs/LIMITATIONS.md), and [evaluation plan](docs/EVALUATION.md) provide the baseline and acceptance criteria.
