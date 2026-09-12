# Security notes

These notes describe gaps found in the initial read-only review of this checkout. They are not a security assessment of a deployed service, and they do not establish that anyone's data has been exposed. A comprehensive security review has not been completed.

For disclosure guidance, see the [repository security policy](../SECURITY.md). For the public showcase's current scope, start with the [README](../README.md).

## What is present

The examples include authentication handling for crawling, request delays, some error handling, and optional cache scoping. Those mechanisms address individual concerns. They have not been verified as a complete access-control or data-protection boundary.

There is no complete chat server in the checkout against which to verify authentication, authorization, request isolation, or server-side secret handling.

The independent [terminal demo](LOCAL_DEMO.md) uses fictional Markdown, keeps the API key in the local Node process, bounds provider requests, and checks cited source membership and exact quotation text. Offline checks cover failed-turn rollback and separate conversation histories. These scoped checks do not establish prompt-injection resistance, semantic support for arbitrary claims, or a multi-user access boundary. The original examples below remain unchanged.

## Findings from the initial review

| Area | Observed behavior | Why it matters for a future demo |
|---|---|---|
| Ingestion preview | The dry-run check does not cover embedding requests or all remote index operations. | A preview must not incur provider costs or change remote data. |
| Cloud document processing | Ordinary processing can request publicly visible shared links. | Reading documents should not silently change who can access them. |
| Answer caching | The database lookup uses question text without the preceding conversation. | Identical follow-ups can refer to different subjects and receive an unrelated cached answer. |
| Logging | Some paths log token prefixes, questions, or account information. | Logs need deliberate redaction and a defined retention policy. |
| Database transport | The TLS configuration disables certificate verification when enabled. | A future connection setup must verify the server's identity. |
| Crawling | Redirect and sitemap scope checks are incomplete. | Every destination needs to stay within the approved crawl boundary. |
| Network requests | Cloud requests lack timeouts. | Slow dependencies can hold work open indefinitely. |

These are observations about the checked-in examples. Exploitability, deployment exposure, and remediation have not been tested here.

## Controls still to build and verify

A runnable demonstration should use fictional documents and separate demo credentials. Its acceptance checks should cover:

- Access checks before retrieval and before returning cached content.
- Cache reuse that respects conversation meaning, corpus version, and access scope.
- Retrieved text treated as evidence, with instructions inside documents unable to override application behavior.
- Citations checked against the sources actually retrieved for the current turn.
- Provider secrets held on the server and omitted from browser responses and logs.
- Explicit limits for uploads, extraction, retries, request duration, and response size.
- Isolation for untrusted file parsing, checks for poisoned corpus content, and versioned source provenance.
- Safe rendered text and source links, including rejection of unsafe URL schemes and fabricated citations.
- Dependency vulnerability review against a locked installation and deliberate log retention and redaction.
- Safe defaults for ingestion previews and document sharing.

None of those checks should be described as passing until an implementation and test evidence exist. The [evaluation plan](EVALUATION.md) includes fictional adversarial and conversation-isolation cases; it is not a substitute for the later security review.

## Public material

New showcase prose should explain engineering decisions without reproducing private source code, internal prompts, schemas, customer documents, or operational details. Conversational examples must be invented for this repository; sample documents may be clearly fictional or explicitly public and attributed. A limited credential-pattern review is useful evidence, but it cannot prove ownership or that every historical artifact is suitable for publication.
