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

The model variables are optional and default to the values shown. A generation-model override must support the structured Responses API request used by the demo, including its JSON schema and output limits. Only the default model configuration has been live-tested. Requests set `temperature: 0` for the standard GPT-4.1, GPT-4.1-mini, GPT-4.1-nano, GPT-4o, and GPT-4o-mini aliases and their dated snapshots; other model names omit temperature. That omission does not establish compatibility with another model.

```sh
# Start an interactive conversation.
npm run demo

# Ask one question in a fresh conversation.
npm run demo -- "Who approves an overnight trip?"

# Save the answer and citations without npm's command header.
npm run --silent demo -- "Who approves an overnight trip?" > answer.txt

# Replay focused scenarios using live, billed OpenAI calls.
npm run demo:cases

# Write the scenario JSON report to a local file instead of stdout.
npm run demo:cases -- --output local-exports/phase-3-results.json

# Run deterministic offline tests without API calls or credentials.
npm test
```

In interactive mode, `/new` starts a fresh conversation and `/exit` quits. A successful interactive turn clears the failure exit status from an earlier turn. With piped input, any failed turn makes the process exit nonzero even if later turns succeed. Each application start loads and embeds the fictional corpus again.

Answers and citations go to stdout. The banner, prompts, diagnostics, and errors go to stderr, so redirecting stdout saves the answer text without those details. The scenario command writes its JSON result to stdout by default; `--output` writes the report to the chosen local file instead. Use `npm run --silent demo:cases` when redirecting that JSON to avoid npm's command header.

Try these separate conversations, using `/new` between them:

| First question | Next question | Behavior to inspect |
|---|---|---|
| Who approves an overnight trip? | Does that change for part-time staff? | Resolve the travel context and retrieve the part-time travel section. |
| Who can receive tuition assistance? | Does that change for part-time staff? | Resolve the tuition context and retrieve the part-time tuition section. |
| Compare travel and purchasing approvals. | Who signs off on that? | Ask which approval the user means. |
| Who approves an overnight trip? | How do I reset my password? | Retrieve password reset instructions after the topic change. |
| What does the travel policy cover? | Does it reimburse pet-sitting? | Report insufficient evidence; the policy deliberately omits this category. |

## How it works

The loader reads Markdown from [the fictional corpus](../sample-data/fictional/README.md), excluding its README. Headings define passages, with a maximum passage length of 1,800 characters. Long lines split at whitespace when possible, or at the size limit when necessary. The splits preserve exact source text and the original line references, including when several passages begin on the same line. Each passage carries its file, section, source line, and a content-derived identifier. Identifiers are repeatable for unchanged source content and position; edits can change them.

OpenAI embeds each passage at startup. The in-memory index caches normalized passage vectors and keyword sets. For each resolved question, retrieval embeds and normalizes the query, ranks passages by cosine similarity and by distinct keyword overlap, then combines those rankings with reciprocal rank fusion. The keyword score counts distinct shared terms without inverse document frequency or passage-length normalization. It favors passages covering more query terms; it is not BM25. Retrieval returns the top six passages. This local ranking choice makes both semantic matches and explicit policy terms available for inspection; six returned passages do not guarantee sufficient evidence.

The conversation sends the latest question and up to six completed exchanges to OpenAI for structured context resolution. The resolver either produces a standalone search query or requests clarification. Each retrieval turn searches again and asks OpenAI for a structured answer containing supported claims or an insufficient-evidence status. Earlier assistant answers provide conversational context, not source evidence. Failed turns do not enter history.

Before displaying an answer, the application checks that each claim names a retrieved source and includes a nonempty exact quote present in that source. This validates source membership and quotation text. It does not prove that the quote logically supports the claim; inspect answers against their cited passages. Citations are grouped by source: each entry has a `quotes` array preserving the evidence used from that source. Returned `claims` retain each claim's `text`, `sourceId`, `quote`, and citation number, so multiple claims can share a reference without losing their evidence links. Insufficient-evidence responses contain no factual claims or citations.

The terminal displays answer citations with source paths, sections, and quotes on stdout. Diagnostics on stderr include the resolved query, retrieved identifiers, timing measurements, and API usage metadata. Scenario output supports reviewing those details across the focused conversations. Its checks require fixture facts in claims tied to the expected source and reject known contradictions and negations. These targeted patterns still do not prove that every claim follows from its evidence. Offline tests exercise deterministic implementation behavior and do not establish live model quality.

## Verification record

On 2026-09-12, the original Phase 3 implementation's final live scenario run passed ten focused checks against fourteen passages from the four fictional documents. The run timestamp was `2026-09-12T10:56:09.527Z`, using Node.js `25.8.1`, `gpt-4.1-mini` resolving to `gpt-4.1-mini-2025-04-14`, and `text-embedding-3-small`. Inspection of all returned answer claims against their exact evidence quotes found no unsupported claims in that run.

The live run used `npm run demo:cases -- --output local-exports/phase-3-results.json`. Twenty-one offline tests passed using `node --test --test-isolation=none demo/*.test.mjs`. The normal documented test command remains `npm test`; the recorded offline run disabled test isolation. Raw reports stay in the ignored local export directory and are not published as repository artifacts.

Two earlier prompt revisions failed checks: the first expanded an ambiguous singular reference to both approval topics; the second asked for clarification when the user explicitly requested a comparison. The final resolver distinguishes those cases. This is tuning and verification on known development cases, with no held-out evaluation. The counts describe these runs only and do not establish general reliability or future model behavior.

### PR review verification

The review update passed 43 offline tests using `node --test --test-isolation=none demo/*.test.mjs`. Regressions cover size boundaries, long paragraphs and source locations, cached vector calculations, grouped evidence, interactive and batch exit behavior, provider errors and parameters, and known factual contradictions.

Ten live scenarios passed at `2026-09-12T13:40:49.488Z` with the same runtime, models, and fourteen corpus passages recorded above. All ten saved answers also passed the final strengthened scenario checks after independent review added negation cases. Every returned claim was inspected against its evidence, and source numbers and grouped quotations were checked. The live report is saved locally as `local-exports/phase-3-review-results.json`; these remain known development cases, not a held-out benchmark.

## Provider choice and limits

The approved implementation uses OpenAI with a local in-memory index. OpenAI's [embeddings documentation](https://developers.openai.com/api/docs/guides/embeddings) describes the vector representations used for similarity search. For this small corpus, local storage keeps retrieval inspectable without another running service; that is an engineering choice for this scope.

[Ollama](https://docs.ollama.com/api/introduction) is an alternative for local inference, requiring model installation and hardware checks. [Pinecone](https://docs.pinecone.io/guides/get-started/overview) is an alternative for managed vector storage, adding another service and configuration. Neither alternative is integrated into this demo, and local hardware suitability has not been established.

The local process sends fictional passages, questions, and recent conversational context to OpenAI. Responses requests set `store: false`; this is not a promise of zero provider retention. Use the synthetic documents supplied here when exercising this public demonstration.

Context resolution has a 512-token output limit; grounded answers have a 4,096-token output limit. An incomplete response reports whether it reached the output limit or stopped because of a content filter, when the provider identifies that cause. Other incomplete responses use a generic error. Partial structured answers are rejected, and error messages do not include raw provider details.

HTTP 429 can indicate a rate limit or a quota issue. The demo suggests retrying later for rate limits and checking API credits and spending limits for quota issues; waiting does not resolve depleted credits. It does not read HTTP error bodies or retry automatically. Failed turns leave the previous completed conversation history intact.

The demo has no persistent index, answer cache, streaming UI, or integration with the legacy application examples. Conversation isolation therefore does not validate contextual cache reuse. Retrieval coverage, model context resolution, and claim support can still fail even when the JSON schema and citation checks succeed. Formal evaluation, broader reliability infrastructure, security review, and portfolio presentation remain later phases in the [roadmap](../ROADMAP.md).
