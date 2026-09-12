# Fictional evaluation cases

These case manifests evaluate the invented Northbridge Learning Institute corpus. They contain no real institutional data or policy claims.

Version `v1` has two explicit splits:

- [`development.json`](v1/development.json) contains cases available for prompt, retrieval, and checker development. The live `demo:cases` command reads this file only.
- [`heldout.json`](v1/heldout.json) contains separate cases reserved for a later evaluation run. Offline preflight reads it only to validate structure, source labels, coverage, and split isolation.

Each case is a complete conversation. Its turns run in order within a fresh conversation, so outcomes do not depend on the order of other cases. Each turn declares one of three expected statuses: `answered`, `clarify`, or `insufficient_evidence`. Answered turns label stable source passages and observable fact patterns; optional fields constrain resolved queries, allowed sources, forbidden output, or required human review. Non-answer turns cannot declare supporting facts.

The manifests cover exact lookup, paraphrase, multi-turn context, topic switching, ambiguity, conflicting sources, missing evidence, and untrusted instructions embedded in a document. Pattern checks are narrow fixture criteria, not semantic entailment grading. Conflict and instruction-handling cases need manual claim-by-claim review when eventually run.

This public held-out split is not secret. Its evaluation value depends on excluding it from tuning and freezing the corpus, prompts, retrieval settings, models, repository revision, and suite hash before the first run. Once a result influences implementation, the affected case is development evidence rather than unseen evaluation data.
