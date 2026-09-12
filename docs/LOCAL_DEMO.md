# Local fictional-document demo

Phase 3 adds an independent terminal demonstration using four invented Northbridge Learning Institute documents. It runs locally and calls OpenAI for embeddings, context resolution, and answers. Hosted inference incurs API usage charges. These tiny fixtures and focused scenarios demonstrate behavior to inspect; they are not a formal evaluation or evidence of production reliability.

Ten focused live checks passed on 2026-09-12. The verification record below describes the tested configuration, earlier failures, and limits of these checks.

## Run it

Use Node.js 22.9 or newer and npm from the repository root. The demo uses Node built-in features and has no npm dependencies; no dependency installation is required.

Keep an existing `OPENAI_API_KEY` in the ignored root `.env` file, or provide it through the process environment. The key is used only by the local Node process to call OpenAI; it must not be put in browser code, source documents, or committed files. An environment example with an empty key is:

```dotenv
OPENAI_API_KEY=
DEMO_MODEL=gpt-4.1-mini
DEMO_EMBED_MODEL=text-embedding-3-small
```

The model variables are optional and default to the values shown. A generation-model override must support the structured Responses API requests used by the demo; arbitrary model substitutions are not verified.

```sh
# Start an interactive conversation.
npm run demo

# Ask one question in a fresh conversation.
npm run demo -- "Who approves an overnight trip?"

# Replay focused scenarios using live, billed OpenAI calls.
npm run demo:cases

# Write the scenario JSON report to a local file instead of stdout.
npm run demo:cases -- --output local-exports/phase-3-results.json

# Run deterministic offline tests without API calls or credentials.
npm test
```

In interactive mode, `/new` starts a fresh conversation and `/exit` quits. Each application start loads and embeds the fictional corpus again. The scenario command writes its JSON result to stdout by default; `--output` writes the report to the chosen local file instead.

Try these separate conversations, using `/new` between them:

| First question | Next question | Behavior to inspect |
|---|---|---|
| Who approves an overnight trip? | Does that change for part-time staff? | Resolve the travel context and retrieve the part-time travel section. |
| Who can receive tuition assistance? | Does that change for part-time staff? | Resolve the tuition context and retrieve the part-time tuition section. |
| Compare travel and purchasing approvals. | Who signs off on that? | Ask which approval the user means. |
| Who approves an overnight trip? | How do I reset my password? | Retrieve password reset instructions after the topic change. |
| What does the travel policy cover? | Does it reimburse pet-sitting? | Report insufficient evidence; the policy deliberately omits this category. |

## How it works

The loader reads Markdown from [the fictional corpus](../sample-data/fictional/README.md), excluding its README. Headings define passages, with an additional size limit. Each passage carries its file, section, source line, and a content-derived identifier. Identifiers are repeatable for unchanged source content and position; edits can change them.

OpenAI embeds each passage at startup. The index stores the passages and vectors in memory. For each resolved question, retrieval embeds the query, ranks passages by cosine similarity and by keyword overlap, then combines those rankings with reciprocal rank fusion. It returns the top six passages. This local ranking choice makes both semantic matches and explicit policy terms available for inspection; six returned passages do not guarantee sufficient evidence.

The conversation sends the latest question and up to six completed exchanges to OpenAI for structured context resolution. The resolver either produces a standalone search query or requests clarification. Each retrieval turn searches again and asks OpenAI for a structured answer containing supported claims or an insufficient-evidence status. Earlier assistant answers provide conversational context, not source evidence. Failed turns do not enter history.

Before displaying an answer, the application checks that each claim names a retrieved source and includes a nonempty exact quote present in that source. This validates source membership and quotation text. It does not prove that the quote logically supports the claim; inspect answers against their cited passages. Insufficient-evidence responses contain no factual claims or citations.

The terminal displays answer citations with source paths, sections, and quotes, followed by the resolved query, retrieved identifiers, timing measurements, and API usage metadata. Scenario output supports reviewing those details across the focused conversations. Offline tests exercise deterministic implementation behavior and do not establish live model quality.

## Verification record

On 2026-09-12, the final live scenario run passed ten focused checks against fourteen passages from the four fictional documents. The run timestamp was `2026-09-12T10:56:09.527Z`, using Node.js `25.8.1`, `gpt-4.1-mini` resolving to `gpt-4.1-mini-2025-04-14`, and `text-embedding-3-small`. Inspection of all returned answer claims against their exact evidence quotes found no unsupported claims in that final run.

The live run used `npm run demo:cases -- --output local-exports/phase-3-results.json`. Twenty-one offline tests passed using `node --test --test-isolation=none demo/*.test.mjs`. The normal documented test command remains `npm test`; the recorded offline run disabled test isolation. Raw reports stay in the ignored local export directory and are not published as repository artifacts.

Two earlier prompt revisions failed checks: the first expanded an ambiguous singular reference to both approval topics; the second asked for clarification when the user explicitly requested a comparison. The final resolver distinguishes those cases. This is tuning and verification on known development cases, with no held-out evaluation. The counts describe these runs only and do not establish general reliability or future model behavior.

## Provider choice and limits

The approved implementation uses OpenAI with a local in-memory index. OpenAI's [embeddings documentation](https://developers.openai.com/api/docs/guides/embeddings) describes the vector representations used for similarity search. For this small corpus, local storage keeps retrieval inspectable without another running service; that is an engineering choice for this scope.

[Ollama](https://docs.ollama.com/api/introduction) is an alternative for local inference, requiring model installation and hardware checks. [Pinecone](https://docs.pinecone.io/guides/get-started/overview) is an alternative for managed vector storage, adding another service and configuration. Neither alternative is integrated into this demo, and local hardware suitability has not been established.

The local process sends fictional passages, questions, and recent conversational context to OpenAI. Responses requests set `store: false`; this is not a promise of zero provider retention. Use the synthetic documents supplied here when exercising this public demonstration.

The demo has no persistent index, answer cache, streaming UI, or integration with the legacy application examples. Conversation isolation therefore does not validate contextual cache reuse. Retrieval coverage, model context resolution, and claim support can still fail even when the JSON schema and citation checks succeed. Formal evaluation, broader reliability infrastructure, security review, and portfolio presentation remain later phases in the [roadmap](../ROADMAP.md).
