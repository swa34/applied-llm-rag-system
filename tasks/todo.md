# Showcase work tracker

## Scope and approval

- Repository: this checkout only. Treat every tracked artifact as public.
- Current branch: `swa34/portfolio-showcase` (renamed at the owner's request).
- Approved: Phase 2, credibility and documentation (2026-09-12).
- Write original showcase prose; do not reproduce application code, prompts, schemas, or private material.
- Keep the custom follow-up chat challenge prominent. Server-side follow-up behavior remains unverified here.
- Do not change application code, install dependencies, connect application services, merge, or deploy during this phase.
- Following completion of Phase 2, the owner explicitly approved committing the changes, pushing `swa34/portfolio-showcase`, and opening a PR against `main`.
- Later phases require their own approval. A checklist item is not authorization.

## Phase ledger

| Phase | Scope | Status | Exit evidence / gate |
|---|---|---|---|
| 1 | Read-only audit | Complete | All 21 original tracked files reviewed; nine local commits examined; findings delivered in conversation |
| 2 | Credibility and documentation | Complete | Accurate claims, clear status, original prose, validated links, unchanged application files; review below |
| 3 | Runnable local demonstration | Not started; approval required | First propose provider tradeoffs and the smallest independent synthetic-data slice |
| 4 | Project infrastructure | Not started; approval required | Reproducible dependencies, configuration, tests, and CI appropriate to the approved demo |
| 5 | Synthetic dataset | Not started; approval required | Fictional corpus and questions, including contextual follow-ups and adversarial cases |
| 6 | Evaluation | Not started; approval required | Run fixtures; save reproducible results and failures before reporting measurements |
| 7 | Security review | Not started; approval required | Assess implemented controls and residual risks against the actual demo |
| 8 | Portfolio presentation | Not started; approval required | Verified demo screenshot, concise case study, and measured results where available |

Phase 2 may explain later-phase requirements; it does not implement or complete them.

## Phase 2 checklist

- [x] Confirm clean checkout and create feature branch.
- [x] Record approval, boundaries, and all eight phases.
- [x] Rewrite README with an honest introduction, capabilities, current setup status, and roadmap.
- [x] Replace architecture drawings with Mermaid and distinguish examples from missing integration.
- [x] Add feature verification, limitations, and evaluation methodology.
- [x] Explain custom follow-up chat with original fictional examples and explicit evidence limits.
- [x] Add disclaimer, security guidance, placeholder environment reference, and root ignore rules.
- [x] Document licensing uncertainty; do not invent a rights grant.
- [x] Review prose, relative links, claims, and new files for confidential information.
- [x] Verify application files are unchanged and report the Phase 2 diff.

## Deferred decisions

- A standalone license needs owner confirmation of the existing material's provenance and intended grant. The previous README's MIT label is not a license file.
- Specific professional follow-up chat responsibilities have not been described by the owner. Do not invent a production implementation or results.
- Provider selection, supported runtimes, dependency versions, and demonstration commands belong to subsequent approved work.

## Phase 2 review

Completed 2026-09-12; branch subsequently renamed to `swa34/portfolio-showcase` at the owner's request.

### Result

The README now identifies the repository as independent component examples with missing integration. Unsupported performance and savings figures, copied application snippets, production-readiness claims, and broken setup commands were removed. Mermaid diagrams separate existing examples from proposed server behavior. Original fictional conversations explain the custom follow-up challenge without claiming unverified professional responsibilities or results.

Supporting documents record feature evidence, known limitations, security boundaries, and future evaluation methodology. The environment reference contains empty secret values and fictional placeholders. The license decision remains deferred; no rights grant or provenance certification was invented. No provider was selected, no dataset or harness was created, and Phases 3–8 remain open.

### Validation

- Local Markdown links resolve within the repository; no application code, prompt, or schema excerpts were added to the showcase documents.
- `git diff --check` passes after correcting a Markdown hard-break whitespace warning. New files were also checked for trailing whitespace and balanced fences.
- Every original file under `src/` and `python/` matches HEAD byte for byte (19 files including requirements and module initializers).
- Credential-pattern and local-address/path checks found no matches in changed/new files. Empty secret values in `.env.example` were checked separately. These limited checks do not certify provenance or exhaustively detect secrets.
- Ignore-rule checks cover local environment files, dependencies, Python environments, and private local documents; `.env.example` and the future fictional sample-data path remain includable.
- An independent documentation review checked scope, claims, and consistency; its public-versus-fictional sample-material wording issue was corrected.
- Mermaid source was reviewed structurally; diagrams were not rendered with a Mermaid runtime. No new runtime test suite or service integration was run because application behavior did not change.

### Changed files

Modified: `README.md`, `docs/ARCHITECTURE.md`.

Added: `.gitignore`, `.env.example`, `DISCLAIMER.md`, `SECURITY.md`, `docs/FEATURE_STATUS.md`, `docs/CASE_STUDY.md`, `docs/EVALUATION.md`, `docs/LIMITATIONS.md`, `docs/SECURITY.md`, `tasks/todo.md`, `.Codex/memory/memory.md`, `.Codex/memory/domain/showcase.md`.

The Phase 2 documentation review was completed before any commit or push. Publication was subsequently authorized as recorded below. Next implementation approval gate: Phase 3, beginning with provider tradeoffs and a concrete proposal for a small independent synthetic-data demonstration. This review does not authorize its implementation, merging, or deployment.

### PR preparation

- Requested: write a PR for the completed Phase 2 work.
- Prepared: [PR title and description](phase-2-pr.md), targeting `main` from `swa34/portfolio-showcase`.
- Branch-preference follow-up also added `.Codex/memory/lessons.md` and appended its memory index entry.
- Publication authorized: the owner explicitly approved committing these changes, pushing the named feature branch, and opening the PR against `main`.
- PR status is maintained on GitHub; approval to open it does not authorize merging or starting Phase 3.
