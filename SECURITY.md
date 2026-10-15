# Security policy

OWL runs locally and spawns CLI subprocesses, so security matters.

## Reporting
Please report vulnerabilities privately via GitHub **Security Advisories** ("Report a vulnerability" on the
repository's Security tab). Do not open public issues for security problems.

## Design guarantees (see `CLAUDE.md`)
- Never reads, stores or forwards provider credentials.
- Server binds to `127.0.0.1` by default; remote access only through a private VPN.
- Subprocesses are spawned with argument arrays, never through a shell.
- Destructive actions require explicit human approval.

## For contributors
Never commit secrets, tokens, `.env` files, database files, backups or personal data. Secret scanning and push
protection are enabled on the repository.
