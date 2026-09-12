# Design case study: the next question

**Status:** an engineering design discussion grounded in the Phase 1 component audit, now accompanied by an independent Phase 3 terminal demonstration. Ten focused live checks passed on 2026-09-12; see [LOCAL_DEMO.md](LOCAL_DEMO.md#verification-record). This is not a report of a deployed system or a reconstruction of employer work.

## The problem

People rarely repeat all the details when they ask a follow-up. After asking about travel approval, they might say, “Does that apply to part-time staff?” A search for that sentence alone has very little to work with. Reusing the previous answer may be just as wrong: eligibility could be covered by a different document.

A useful assistant has to carry forward the right meaning without carrying forward an unsupported assumption. That is the difficult part of custom follow-up chat.

## Where the engineering work sits

| Decision | Why it matters | Evidence in this checkout |
|---|---|---|
| Preserve enough context to interpret a follow-up | Pronouns and omitted subjects need an antecedent | Demo resolves the question using up to six completed exchanges |
| Detect a subject change | Previous context can distort a new question | Demo resolver preserves explicit topic changes in the focused live checks |
| Retrieve again when the question changes | The previous sources may not cover the new condition | Demo retrieves fresh passages for every resolved question |
| Ask when a reference is ambiguous | Guessing can produce a confident answer about the wrong policy | Demo has a structured clarification path before retrieval |
| Keep citations attached to evidence | An earlier assistant answer is not a source document | Demo checks retrieved source membership and exact quotes, not semantic entailment |
| Decide whether a cached answer is reusable | Identical wording can have different meanings across conversations | Demo has no answer cache; the original persistent cache still matches question text |
| Handle cancellation and replacement turns | Interrupted answers should not corrupt the next turn | Client cancellation exists; isolated checks found state defects |

## A fictional example

The following conversations use the invented Northbridge Learning Institute [corpus](../sample-data/fictional/README.md). They do not state any real organization's policy. The focused scenario runner exercises these cases; ten live checks passed on 2026-09-12. The [verification record](LOCAL_DEMO.md#verification-record) describes earlier failures and known-case tuning.

| Earlier question | Follow-up | Behavior to verify in the demo |
|---|---|---|
| Who approves an overnight trip? | Does that change for part-time staff? | Resolve the travel context and retrieve evidence about eligibility |
| Who can receive tuition assistance? | Does that change for part-time staff? | Resolve the tuition context; do not reuse a travel answer |
| Compare travel and purchasing approvals. | Who signs off on that? | Ask which approval the user means |
| Who approves an overnight trip? | How do I reset my password? | Recognize the topic change and retrieve IT instructions |
| What does the travel policy cover? | Does it cover a category the corpus never mentions? | Explain the evidence gap without inventing a rule |

The paired follow-up wording in the first two rows is particularly useful. A system can sound fluent on both turns and still fail if its cache ignores the conversation.

## What can be said today

The repository retains the original document-processing, retrieval, cache, feedback, and streaming examples and their Phase 1 integration findings. The new `demo/` modules independently connect fictional documents, hosted inference, local retrieval, conversational context, and quoted answers in a terminal.

The original examples and their audited history do not establish a working conversational assistant or professional server-side follow-up implementation. The new terminal demo establishes a separate implementation to test, not evidence about employer systems. Specific professional responsibilities and outcomes should be added only from an owner-approved, non-confidential description; they should not be inferred from filenames or commit messages.

## What would make the story convincing

The [local demonstration](LOCAL_DEMO.md) supplies these fictional conversations and records resolved queries, sources, outcomes, timings, and usage. Inspect each answer against its quotes, including failures. Clarification is a separate outcome, and there are no cached answers in this slice; warm-cache behavior remains untested.

The [evaluation plan](EVALUATION.md) defines what to record. A screenshot, expanded dataset, and formal measured results belong to later phases. Focused implementation checks alone do not establish general conversational reliability.
