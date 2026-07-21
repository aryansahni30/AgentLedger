# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report privately through GitHub Security Advisories:

1. Go to the [Security tab](https://github.com/aryansahni30/AgentLedger/security/advisories) of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue, affected versions, and steps to reproduce.

You'll get an acknowledgement within a few days. Once the issue is confirmed
and a fix is available, the advisory will be published and credit given unless
you prefer to remain anonymous.

## Scope

AgentLedger runs locally — no hosted service, no telemetry. Reports of the
highest interest include:

- Bypasses of the protected-file write block (PreToolUse).
- Ways to tamper with the ledger without breaking the hash chain.
- Ways to make a false completion claim pass verification.
