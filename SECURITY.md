# Security policy

This is a reference project under development. No release is designated production-ready or security-supported. The current component examples should not be connected to production services or confidential documents.

## Reporting a concern

If the repository's Security tab offers private vulnerability reporting, use that channel. Otherwise, request a private contact from the maintainer without posting the vulnerability details publicly. Do not include credentials, private documents, account information, or production logs in an issue.

A useful private report identifies the affected file or revision, the behavior observed, the expected boundary, and a reproduction using synthetic data. Do not test against services or accounts you do not own or have permission to assess.

## Current scope

The [security notes](docs/SECURITY.md) distinguish observed component behavior from proposed controls. The [limitations](docs/LIMITATIONS.md) and [disclaimer](DISCLAIMER.md) explain the operational and provenance boundaries.

The documentation audit is not a completed security assessment of a running application. Prompt-injection resistance, authorization-aware retrieval, safe rendered output, and dependency vulnerability status have not been established. Later security work must assess the actual approved demonstration and report its residual risks.
