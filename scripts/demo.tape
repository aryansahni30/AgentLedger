# AgentLedger Demo — Simulation Script
# No real LLM calls. demo-simulate.sh drives all CLI output.
# Run: vhs demo.tape

Output demo.gif

Require echo

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 800
Set Theme "Dracula"
Set TypingSpeed 40ms
Set Padding 20

# ── Setup: prepend wrapper bin to PATH (avoids $ parsing issues in VHS) ───────

Hide
  Type "export PATH=/Users/aryansahni/AgentLeader/scripts/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  Enter
  Sleep 300ms
Show

# ── Header ────────────────────────────────────────────────────────────────────

Type "echo ''"
Enter
Type "echo '  AgentLedger — AI Agent Harness Demo'"
Enter
Type "echo '  github.com/aryansahni/AgentLeader'"
Enter
Type "echo ''"
Enter
Sleep 2s

# ── SCENARIO 1: BOUNDARY VIOLATION ───────────────────────────────────────────

Type "echo ''"
Enter
Type "echo '══════════════════════════════════════════════════'"
Enter
Type "echo '  SCENARIO 1: Boundary Violation'"
Enter
Type "echo '  Task instructs LLM to write .env (blocked file)'"
Enter
Type "echo '  Verifier catches it — even though worker self-reports success'"
Enter
Type "echo '══════════════════════════════════════════════════'"
Enter
Type "echo ''"
Enter
Sleep 1s

Type "agentledger init"
Enter
Sleep 2s

Type "agentledger run-bv"
Enter
Sleep 15s

# ── SCENARIO 2: VERIFICATION FAILED ──────────────────────────────────────────

Type "echo ''"
Enter
Type "echo '══════════════════════════════════════════════════'"
Enter
Type "echo '  SCENARIO 2: False Self-Report'"
Enter
Type "echo '  Worker claims tests pass — verifier runs npm test'"
Enter
Type "echo '  npm test exits 1 → VERIFICATION_FAILED'"
Enter
Type "echo '══════════════════════════════════════════════════'"
Enter
Type "echo ''"
Enter
Sleep 1s

Type "agentledger run-vf"
Enter
Sleep 16s

# ── REPLAY: Hash chain integrity ──────────────────────────────────────────────

Type "echo ''"
Enter
Type "echo '══════════════════════════════════════════════════'"
Enter
Type "echo '  REPLAY: Reconstruct run state + verify ledger'"
Enter
Type "echo '══════════════════════════════════════════════════'"
Enter
Type "echo ''"
Enter
Sleep 1s

Type "agentledger replay"
Enter
Sleep 5s

Type "echo ''"
Enter
Sleep 2s
