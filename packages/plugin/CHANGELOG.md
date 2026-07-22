# Changelog

All notable changes to the AgentLedger Claude Code plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version below tracks the plugin (`agentledger`), matching
`.claude-plugin/plugin.json`.

## [0.3.1] — 2026-07-21

### Added
- Distributable via the Claude Code community marketplace as a `git-subdir`
  source: the self-contained hook bundles (`dist/*.cjs`) are now committed so a
  git checkout runs the plugin with no build step.
- CI drift-check: the build fails if the committed bundles differ from a fresh
  build, so stale bundles can never ship.
- Full README covering install, the five skills, the hash-chained ledger, the
  prevention-vs-detection enforcement model, and the `config.json` reference;
  added `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, and a CI workflow.
- Cross-project view in the local dashboard.

### Fixed
- Stop hook now reads the assistant turn from `last_assistant_message` and
  verifies completion claims whenever the session did any work (read/edit/write/
  bash). It previously skipped verification unless a file was edited, letting a
  "ran the tests, they pass" turn — which edits nothing — escape the check.
- Hooks read stdin from file descriptor 0 for reliable payload capture across
  environments.

### Changed
- Repository renamed to `AgentLedger`; all manifests synced to `0.3.1`.

## [0.3.0] — 2026-07-20

### Added
- Marketplace-native install: `.claude-plugin/plugin.json` and a root
  marketplace manifest; hooks reference `${CLAUDE_PLUGIN_ROOT}`; skills moved to
  `skills/<name>/SKILL.md` and namespace as `/agentledger:<name>`.

### Changed
- The legacy `install.js` is now a no-op notice — a manual `settings.json`
  install alongside a marketplace install would double-register every hook.

## [0.2.0] — 2026-07-16 — The Trust Layer

### Added
- Real-time completion-claim detection with instant verification against the
  configured test command's exit code (`CLAIM_VERIFIED` / `CLAIM_FALSIFIED`).
- Trust score tracked across sessions, a session-start trust banner, and a
  warning zone for low-trust sessions.
- Pre-disk blocking of protected-file `Edit`/`Write` (exit code 2) and a
  session-end `git diff` boundary check emitting `BOUNDARY_VIOLATION`.
- Standalone npm install path, a session-end summary, and a shared verifier
  module.

## [0.1.0] — 2026-07-14

### Added
- Initial Claude Code observer/enforcer plugin: an append-only, SHA-256
  hash-chained ledger of agent actions across five lifecycle hooks
  (SessionStart, PreToolUse, PostToolUse, Stop, SessionEnd).

[0.3.1]: https://github.com/aryansahni30/AgentLedger/releases/tag/agentledger-plugin%400.3.1
[0.3.0]: https://github.com/aryansahni30/AgentLedger/releases/tag/agentledger-plugin%400.3.0
[0.2.0]: https://github.com/aryansahni30/AgentLedger/releases/tag/agentledger-plugin%400.2.0
[0.1.0]: https://github.com/aryansahni30/AgentLedger/releases/tag/agentledger-plugin%400.1.0
