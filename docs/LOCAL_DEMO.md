# Local fictional-document demo

Phase 3 adds an independent terminal demonstration using four invented Northbridge Learning Institute documents. It runs locally and calls OpenAI for embeddings, context resolution, and answers. Hosted inference incurs API usage charges. These tiny fixtures and focused scenarios demonstrate behavior to inspect; they are not a formal evaluation or evidence of production reliability.

Ten focused live checks passed on 2026-09-12. The verification record below describes the tested configuration, earlier failures, and limits of these checks.

## Run it

Use Node.js **24.21.0**, pinned in [`.nvmrc`](../.nvmrc), and its bundled npm from the repository root. The supported range is Node 24.21.0 through later Node 24 releases; CI uses the exact pin. If you use nvm, run `nvm install` and `nvm use` in this directory. Other Node major versions are rejected at startup.

The demo uses only Node built-in features. There are no third-party npm packages to install or lock, so `npm install`, `npm ci`, and an npm lockfile are unnecessary. This does not resolve dependencies in the original JavaScript or Python examples. Update the runtime pin deliberately and rerun the offline checks when adopting a newer release.

Provide an existing `OPENAI_API_KEY` through the process environment, or keep it in a locally ignored root `.env` file. This repository does not track `.gitignore`. In a fresh Git checkout, add local exclusions before saving credentials or scenario reports:

```sh
printf '%s\n' '.env' '/local-exports/' >> .git/info/exclude
```

The key is used only by the local Node process to call OpenAI; it must not be put in browser code, source documents, or committed files. An environment example with an empty key is:

```dotenv
OPENAI_API_KEY=
DEMO_MODEL=gpt-5.6-terra
DEMO_EMBED_MODEL=text-embedding-3-small
```

The model variables are optional and default to the values shown when omitted. Empty values or values containing whitespace are rejected; remove an override to use its default. The API key must be nonempty and contain no whitespace. Validation errors name the setting without displaying its value. A generation-model override must support the structured Responses API request used by the demo, including its JSON schema and output limits. The default generation model is [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra); set `DEMO_MODEL=gpt-5.6-luna` to select [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) for both context resolution and answers. These models use `reasoning: { effort: "none" }` and omit `temperature`, preserving the demo's non-reasoning request behavior and its 512/4,096-token output limits. Embeddings still use `text-embedding-3-small`.

Both current models passed ten focused cases in the [Terra and Luna verification](#terra-and-luna-verification), with offline request-contract checks as well. Other model overrides require separate compatibility verification. The Phase 3 records below describe a previous configuration; they do not establish results for Terra or Luna.

```sh
# Check the runtime and fictional corpus without credentials or network calls.
npm run check

# Check local credential/model syntax too, without contacting OpenAI.
npm run demo:check

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

## Reproducibility and CI

`npm test` first runs the offline runtime/corpus check, then the test suite. It does not load `.env` or call hosted APIs. `npm run demo:check` loads the optional root `.env` using Node's environment-file support; existing process variables take precedence. It checks local setting syntax and the corpus, without printing setting values, embedding documents, authenticating the key, or checking model access. A successful configuration check does not establish provider availability or sufficient API quota.

[The GitHub Actions workflow](../.github/workflows/demo.yml) runs `npm test` and the CLI help command on pushes, pull requests, and manual dispatches. It uses Ubuntu 24.04 and the `.nvmrc` pin, pins action commits, grants read-only repository access, disables checkout credential persistence, and has a five-minute job limit. It needs no API secrets or package installation. Live scenarios remain an explicit local command.

### Phase 4 local verification

On 2026-09-12, `npm test` passed all 54 offline tests on Linux with Node.js 24.21.0 and bundled npm 11.19.0. A clean copy containing the public files and proposed changes, with no `.env` or installed packages, passed the same command and CLI help check. Configuration checks passed with a fake credential and rejected missing credentials and malformed model settings. The runtime download was checked against its official SHA-256 checksum.

New regressions exercise actual abort signals with shortened test deadlines during both fetch and response-body reads, then verify a successful request using the same provider. Failed resolution, retrieval, and answer stages preserve prior conversation history and release the busy guard for the next turn. The body-timeout test reproduced the previous incorrect “invalid JSON” message before the fix.

The workflow commands passed locally and in the first hosted [push run](https://github.com/swa34/applied-llm-rag-system/actions/runs/34699974219) and [pull-request run](https://github.com/swa34/applied-llm-rag-system/actions/runs/34699984732) on 2026-09-12 at commit `f572268`. Both hosted runs passed all 57 offline tests and the CLI help check. That initial infrastructure verification made no live API calls. The subsequent Terra/Luna migration and its live results are recorded below. The supported runtime policy is narrower than the original Phase 3 declaration; other operating systems and later Node 24 patches have not been locally tested.

### Terra and Luna verification

The generation default was subsequently updated to `gpt-5.6-terra`, with `gpt-5.6-luna` as the selectable alternative. Both models use reasoning effort `none`; prompts, output limits, and embedding settings were preserved for the first comparison. Those first live runs scored 7/10 for Terra and 9/10 for Luna. Inspection found that the checker rejected valid “can receive” and “signs off” paraphrases. Terra also unnecessarily requested clarification for a follow-up about an employee group within one policy.

The checker now accepts those paraphrases while retaining source, waiting-period, and contradiction checks, with positive and negative regression cases. A small resolver instruction distinguishes groups within one policy from genuinely distinct topics. Final live runs occurred at `2026-09-12T14:22:58.229Z` for Terra and `2026-09-12T14:23:09.592Z` for Luna, using Node 24.21.0, `text-embedding-3-small`, and fourteen fictional passages. Both final sets of saved answers passed **10/10** against the corrected checker. Every final claim was independently inspected against its evidence quote; no unsupported fixture claims were found.

The final runs loaded the earlier checker and retained raw counts of 8/10 and 9/10. Their reports remain unchanged in `local-exports/phase-4-terra-final-results.json` and `local-exports/phase-4-luna-final-results.json`. The separate `local-exports/phase-4-model-recheck.json` records the corrected scores and hashes of the source reports and checker. These are prompt-tuned development cases, not held-out evaluation or a guarantee of future behavior. The expanded offline suite passes **57 tests**, including a clean-copy run without credentials or installed packages.

## How it works

The loader reads Markdown from [the fictional corpus](../sample-data/fictional/README.md), excluding its README. Headings define passages, with a maximum passage length of 1,800 characters. Long lines split at whitespace when possible, or at the size limit when necessary. The splits preserve exact source text and the original line references, including when several passages begin on the same line. Each passage carries its file, section, source line, and a content-derived identifier. Identifiers are repeatable for unchanged source content and position; edits can change them.

OpenAI embeds each passage at startup. The in-memory index caches normalized passage vectors and keyword sets. For each resolved question, retrieval embeds and normalizes the query, ranks passages by cosine similarity and by distinct keyword overlap, then combines those rankings with reciprocal rank fusion. The keyword score counts distinct shared terms without inverse document frequency or passage-length normalization. It favors passages covering more query terms; it is not BM25. Retrieval returns the top six passages. This local ranking choice makes both semantic matches and explicit policy terms available for inspection; six returned passages do not guarantee sufficient evidence.

The conversation sends the latest question and up to six completed exchanges to OpenAI for structured context resolution. The resolver either produces a standalone search query or requests clarification. Each retrieval turn searches again and asks OpenAI for a structured answer containing supported claims or an insufficient-evidence status. Earlier assistant answers provide conversational context, not source evidence. Failed turns do not enter history.

Before displaying an answer, the application checks that each claim names a retrieved source and includes a nonempty exact quote present in that source. This validates source membership and quotation text. It does not prove that the quote logically supports the claim; inspect answers against their cited passages. Citations are grouped by source: each entry has a `quotes` array preserving the evidence used from that source. Returned `claims` retain each claim's `text`, `sourceId`, `quote`, and citation number, so multiple claims can share a reference without losing their evidence links. Insufficient-evidence responses contain no factual claims or citations.

The terminal displays answer citations with source paths, sections, and quotes on stdout. Diagnostics on stderr include the resolved query, retrieved identifiers, timing measurements, and API usage metadata. Scenario output supports reviewing those details across the focused conversations. Its checks require fixture facts in claims tied to the expected source and reject known contradictions and negations. These targeted patterns still do not prove that every claim follows from its evidence. Offline tests exercise deterministic implementation behavior and do not establish live model quality.

## Verification record

On 2026-09-12, the original Phase 3 implementation's final live scenario run passed ten focused checks against fourteen passages from the four fictional documents. The run timestamp was `2026-09-12T10:56:09.527Z`, using Node.js `25.8.1`, the previous generation-model configuration retained in the local report, and `text-embedding-3-small`. Inspection of all returned answer claims against their exact evidence quotes found no unsupported claims in that run. These results predate the Terra/Luna migration.

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

Each provider request has a 30-second deadline covering both connection/response arrival and response-body consumption. An aborted body read reports a request failure or timeout rather than invalid JSON. Startup embedding and each resolution, query embedding, and answer request have separate deadlines; there is no overall session deadline.

HTTP 429 can indicate a rate limit or a quota issue. The demo suggests retrying later for rate limits and checking API credits and spending limits for quota issues; waiting does not resolve depleted credits. It does not read HTTP error bodies or retry automatically. Failed turns leave the previous completed conversation history intact.

The demo has no persistent index, answer cache, streaming UI, or integration with the legacy application examples. Conversation isolation therefore does not validate contextual cache reuse. Retrieval coverage, model context resolution, and claim support can still fail even when the JSON schema and citation checks succeed. Formal evaluation, broader reliability work, security review, and portfolio presentation remain later phases in the [roadmap](../ROADMAP.md).
