# Fictional demonstration dataset

Every document and case in this dataset is original, invented material for a local retrieval-augmented generation demonstration. Northbridge Learning Institute is a fictional organization. Nothing here represents an employer's policies, confidential information, or a real service's instructions.

Version `1.0.0` contains ten documents and 38 evidence passages under [`v1/documents/`](v1/documents/). [`v1/corpus.json`](v1/corpus.json) is the runtime retrieval allowlist and assigns stable document and passage identifiers. The dataset loader opens only the files declared there.

The six expanded topics cover hybrid work, caregiver leave, visitor access, community-studio booking, a deliberately conflicting studio bulletin, and commuter benefits. The original travel, tuition, purchasing, and password-reset documents remain part of the versioned corpus. The studio booking policy also contains an explicitly untrusted imported annotation for development and evaluation of instruction handling.

Machine-readable case rubrics live outside the evidence tree:

- [`development.json`](../../evaluation/fictional/v1/development.json) contains 13 self-contained conversations and 21 turns, including the ten cases previously used while tuning the resolver and checks.
- [`heldout.json`](../../evaluation/fictional/v1/heldout.json) contains eight separate conversations and eleven turns withheld from prompt, retrieval, and checker tuning.

Both suites cover direct lookups, paraphrases, conversational context, topic changes, ambiguity, conflicting evidence, missing evidence, and untrusted document instructions. Each expected answer fact identifies a stable passage and observable criteria. Clarification and insufficient-evidence turns do not invent supporting sources.

“Held out” does not mean secret: this is a public repository. It means the evaluation cases are structurally separate and must not be used to revise prompts, retrieval, or scoring rules. Phase 6 should freeze the corpus, development suite, prompt/configuration, repository revision, and suite hashes before the first held-out run. If a held-out result is used for tuning, that case becomes a development regression and a new evaluation case is required.

Travel pet-sitting reimbursement, visitor weekend access, and commuter parking reimbursement are intentionally unanswered by the corpus. The community-studio documents intentionally disagree without declaring which one controls. These details are evaluation design, not real policy guidance, and the README itself is never retrievable evidence.
