# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, exposed credential,
privacy leak, unsafe update path, or bypass of a user-consent boundary.

Use one of these private routes:

1. [GitHub private vulnerability reporting](https://github.com/KimaniDJ11/Vox-Jot/security/advisories/new)
2. Email `kimani@iriedinamik.org` with the subject `Vox Jot security report`

Include the affected version or commit, platform, reproduction steps, expected
impact, and any safe proof of concept. Do not send real recordings, transcripts,
credentials, license keys, or unrelated personal data.

## Response expectations

This project is maintained by a small team. Irie Dinamik will acknowledge a
credible report as soon as practical, investigate it privately, and coordinate
disclosure after a fix or mitigation is available. Please allow reasonable time
before public disclosure.

## Supported versions

Security fixes target the current official Mac release and the current `main`
branch. Older builds may be asked to update before additional investigation.

## Scope priorities

High-priority reports include:

- Arbitrary code execution or unsafe update/install behavior
- Exposure of recordings, transcripts, credentials, or local documents
- Model/runtime download integrity failures
- Permission, consent, or voice-cloning safety bypasses
- Unintended cloud transmission from a local-first workflow
- Secret material committed to the public repository or release artifacts

Questions and normal bug reports belong in [SUPPORT.md](SUPPORT.md).
