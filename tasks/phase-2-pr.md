# PR draft

**Title:** docs: align RAG showcase claims with implementation

**Base:** `main`

**Head:** `swa34/portfolio-showcase`

## Description

The documentation described a complete production-grade RAG platform and reported performance figures without a runnable application or benchmark evidence. This update presents the repository as an independent collection of component examples, with a clear account of what exists and what still needs implementation.

Custom follow-up chat is a central part of the design discussion. Original fictional conversations explain reference resolution, topic changes, fresh retrieval, citations, and why identical follow-up wording cannot safely share a question-only cache. The documentation distinguishes that proposed behavior from the client-side history and session handling present today.

### Changes

- Rewrite the README and replace architecture drawings with Mermaid diagrams that distinguish existing examples from proposed integration.
- Add a feature-verification matrix, design case study, limitations, and evaluation methodology; remove unsupported performance and savings claims and broken setup commands.
- Add a disclaimer, security reporting policy, security notes, a placeholder environment reference, and ignore rules for local secrets and artifacts.
- Track all eight project phases, completed checks, deferred decisions, and approval boundaries in `tasks/todo.md`; record the owner's branch-prefix preference in project memory.

### Validation

- Checked local Markdown links, balanced fences, and whitespace in changed and new files.
- Verified all 19 original source and requirements files under `src/` and `python/` match the base revision byte for byte.
- Checked new material for credential patterns and local paths or addresses; verified secret fields in `.env.example` are empty.
- Verified ignore rules protect local environment files, dependencies, and private local documents while allowing the environment example and fictional sample-data paths.
- Completed an independent documentation review for scope, evidence, and consistency.

Application behavior is unchanged. No connected-service tests or benchmarks were run for this documentation update. Mermaid source was reviewed structurally but not rendered with a Mermaid runtime. The content checks do not certify provenance or constitute an exhaustive secret scan.

### Remaining work

Phase 2 documentation is complete. Phases 3–8 remain unstarted and require separate approval. A runnable demo, synthetic corpus, evaluation harness, and verified security controls are still future work. A license file is deferred pending confirmation of provenance and the intended license.
