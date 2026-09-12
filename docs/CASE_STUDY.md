# Design case study: the next question

**Status:** an engineering design discussion grounded in the component audit. This is not a report of a deployed system, a reconstruction of employer work, or a claim of measured outcomes.

## The problem

People rarely repeat all the details when they ask a follow-up. After asking about travel approval, they might say, “Does that apply to part-time staff?” A search for that sentence alone has very little to work with. Reusing the previous answer may be just as wrong: eligibility could be covered by a different document.

A useful assistant has to carry forward the right meaning without carrying forward an unsupported assumption. That is the difficult part of custom follow-up chat.

## Where the engineering work sits

| Decision | Why it matters | Evidence in this checkout |
|---|---|---|
| Preserve enough context to interpret a follow-up | Pronouns and omitted subjects need an antecedent | Client message list and session ID; server resolution absent |
| Detect a subject change | Previous context can distort a new question | No implemented topic-switching behavior |
| Retrieve again when the question changes | The previous sources may not cover the new condition | Retrieval component exists; conversational integration absent |
| Ask when a reference is ambiguous | Guessing can produce a confident answer about the wrong policy | No implemented clarification path |
| Keep citations attached to evidence | An earlier assistant answer is not a source document | Source metadata exists; citation validation absent |
| Decide whether a cached answer is reusable | Identical wording can have different meanings across conversations | Persistent cache matches question text; contextual eligibility absent |
| Handle cancellation and replacement turns | Interrupted answers should not corrupt the next turn | Client cancellation exists; isolated checks found state defects |

## A fictional example

The following conversations are invented design fixtures. They do not state any real organization's policy, and no result is claimed.

| Earlier question | Follow-up | Behavior a future demo should establish |
|---|---|---|
| Who approves an overnight trip? | Does that change for part-time staff? | Resolve the travel context and retrieve evidence about eligibility |
| Who can receive tuition assistance? | Does that change for part-time staff? | Resolve the tuition context; do not reuse a travel answer |
| Compare travel and purchasing approvals. | Who signs off on that? | Ask which approval the user means |
| Who approves an overnight trip? | How do I reset my password? | Recognize the topic change and retrieve IT instructions |
| What does the travel policy cover? | Does it cover a category the corpus never mentions? | Explain the evidence gap without inventing a rule |

The paired follow-up wording in the first two rows is particularly useful. A system can sound fluent on both turns and still fail if its cache ignores the conversation.

## What can be said today

The repository shows separate document-processing, retrieval, cache, feedback, and streaming examples. The review also identifies concrete integration problems. Together, they provide material for explaining tradeoffs and how to verify them.

They do not establish a working conversational assistant. The available local commit history does not provide a separate implementation of server-side follow-up handling. Specific professional responsibilities and outcomes should be added only from an owner-approved, non-confidential description; they should not be inferred from filenames or commit messages.

## What would make the story convincing

An independently written demonstration should show the paired conversations above against clearly fictional documents, record the sources selected for each turn, and explain failures as well as successes. It should distinguish a contextual retrieval decision from a cached answer and from a request for clarification.

The [evaluation plan](EVALUATION.md) defines what to record. A screenshot and measured results belong to later phases, once that behavior has actually been implemented and tested.
