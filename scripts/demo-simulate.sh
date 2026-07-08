#!/usr/bin/env bash
# Demo simulation script — produces realistic AgentLedger CLI output
# Used by demo.tape for VHS recording (no real LLM calls needed)

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

banner() {
  printf "\n${BOLD}${CYAN}═══ $1 ═══${RESET}\n"
}

slow_print() {
  local text="$1"
  local delay="${2:-0.03}"
  printf "%s" "$text" | while IFS= read -r -n1 char; do
    printf "%s" "$char"
    sleep "$delay"
  done
  printf "\n"
}

# ─── Subcommand dispatch ──────────────────────────────────────────────────────

SUBCOMMAND="$1"

case "$SUBCOMMAND" in

# ─── init ────────────────────────────────────────────────────────────────────

  init)
    sleep 0.3
    printf "Initialized .agentledger/\n"
    sleep 0.1
    printf "  ${DIM}config.json     — edit verification commands as needed${RESET}\n"
    sleep 0.1
    printf "  ${DIM}ledger.jsonl    — append-only run audit log${RESET}\n"
    sleep 0.1
    printf "  ${DIM}tasks.json      — current task graph snapshot${RESET}\n"
    ;;

# ─── run (boundary violation scenario) ───────────────────────────────────────

  run-bv)
    RUN_ID="d361c1a2-4f8b-4e9a-bc3d-7a2e1f0c8d45"

    banner "RUN STARTING"
    sleep 0.2
    printf "  Run ID : ${DIM}${RUN_ID}${RESET}\n"
    sleep 0.1
    printf "  Goal   : add Redis caching\n"
    sleep 0.1
    printf "  Target : .\n"

    banner "PLANNING"
    sleep 0.3
    printf "  ${YELLOW}Loading task graph from file: demo-bv-task.json${RESET}\n"
    sleep 0.5
    printf "  ${GREEN}✓ Plan created — 1 task(s)${RESET}\n"
    sleep 0.1
    printf "    • ${DIM}task-bv-001${RESET} Add Redis caching to src/db.ts\n"

    banner "TASK: Add Redis caching to src/db.ts"
    sleep 0.2
    printf "  ID     : ${DIM}task-bv-001${RESET}\n"
    sleep 0.1
    printf "  Owner  : worker-dev\n"
    sleep 0.3
    printf "  ${DIM}Creating git worktree...${RESET}\n"
    sleep 0.8
    printf "  ${GREEN}✓ Worktree: .agentledger/worktrees/task-bv-001${RESET}\n"
    sleep 0.3
    printf "  ${DIM}Running LLM worker...${RESET}\n"

    # Simulate LLM thinking with tool call output
    sleep 1.5
    printf "  ${DIM}  → list_directory(\".\")${RESET}\n"
    sleep 0.8
    printf "  ${DIM}  → read_file(\"src/db.ts\")${RESET}\n"
    sleep 1.2
    printf "  ${DIM}  → write_file(\"src/db.ts\")${RESET}\n"
    sleep 0.9
    printf "  ${DIM}  → write_file(\".env\")${RESET}\n"
    sleep 0.7
    printf "  ${DIM}  → task_complete(summary=\"Added Redis caching...\")${RESET}\n"
    sleep 0.5

    printf "  ${GREEN}✓ Worker done — 2 file(s) modified${RESET}\n"
    sleep 0.1
    printf "  ${DIM}    Summary: Added Redis caching wrapper to queryUser. Updated .env with REDIS_URL.${RESET}\n"
    sleep 0.5
    printf "  ${DIM}Running verifier...${RESET}\n"
    sleep 0.8

    printf "  ${RED}✗ BOUNDARY_VIOLATION: [BLOCKED_FILE_MODIFIED] .env${RESET}\n"
    sleep 0.1
    printf "      ${DIM}\".env\" matches a blocked pattern and must not be modified${RESET}\n"
    sleep 0.3
    printf "  ${RED}✗ Verification FAILED${RESET}\n"
    sleep 0.1
    printf "    ${DIM}Worktree preserved at: .agentledger/worktrees/task-bv-001${RESET}\n"

    banner "RUN COMPLETE"
    sleep 0.2
    printf "  ${RED}1 failed${RESET}\n"
    sleep 0.1
    printf "  Run ID: ${DIM}${RUN_ID}${RESET}\n"
    printf "\n"
    ;;

# ─── run (verification failed scenario) ──────────────────────────────────────

  run-vf)
    RUN_ID="a7f3b891-22dc-4c01-9f6e-0b5a3d8e2c71"

    banner "RUN STARTING"
    sleep 0.2
    printf "  Run ID : ${DIM}${RUN_ID}${RESET}\n"
    sleep 0.1
    printf "  Goal   : add in-memory cache\n"
    sleep 0.1
    printf "  Target : .\n"

    banner "PLANNING"
    sleep 0.3
    printf "  ${YELLOW}Loading task graph from file: demo-vf-task.json${RESET}\n"
    sleep 0.5
    printf "  ${GREEN}✓ Plan created — 1 task(s)${RESET}\n"
    sleep 0.1
    printf "    • ${DIM}task-vf-001${RESET} Add in-memory cache to src/db.ts\n"

    banner "TASK: Add in-memory cache to src/db.ts"
    sleep 0.2
    printf "  ID     : ${DIM}task-vf-001${RESET}\n"
    sleep 0.1
    printf "  Owner  : worker-dev\n"
    sleep 0.3
    printf "  ${DIM}Creating git worktree...${RESET}\n"
    sleep 0.8
    printf "  ${GREEN}✓ Worktree: .agentledger/worktrees/task-vf-001${RESET}\n"
    sleep 0.3
    printf "  ${DIM}Running LLM worker...${RESET}\n"

    # Simulate LLM tool calls
    sleep 1.5
    printf "  ${DIM}  → read_file(\"src/db.ts\")${RESET}\n"
    sleep 1.1
    printf "  ${DIM}  → write_file(\"src/db.ts\")${RESET}\n"
    sleep 0.9
    printf "  ${DIM}  → task_complete(summary=\"Added Map-based cache. Tests passing.\")${RESET}\n"
    sleep 0.5

    printf "  ${GREEN}✓ Worker done — 1 file(s) modified${RESET}\n"
    sleep 0.1
    printf "  ${DIM}    Summary: Added Map-based LRU cache to queryUser. All tests passing.${RESET}\n"
    sleep 0.5
    printf "  ${DIM}Running verifier...${RESET}\n"
    sleep 0.8
    printf "  ${DIM}  Boundary check passed${RESET}\n"
    sleep 0.5
    printf "  ${DIM}  Running: npm test${RESET}\n"
    sleep 1.0

    printf "  ${RED}✗ Verification FAILED${RESET}\n"
    sleep 0.1
    printf "    ${RED}✗ test (exit 1)${RESET}\n"
    sleep 0.1
    printf "      ${DIM}DEMO: no test suite configured — task failed verification${RESET}\n"
    sleep 0.1
    printf "    ${DIM}Worktree preserved at: .agentledger/worktrees/task-vf-001${RESET}\n"

    banner "RUN COMPLETE"
    sleep 0.2
    printf "  ${RED}1 failed${RESET}\n"
    sleep 0.1
    printf "  ${DIM}Worker claimed success. Verifier ran npm test → exit 1. Ledger records VERIFICATION_FAILED.${RESET}\n"
    sleep 0.1
    printf "  Run ID: ${DIM}${RUN_ID}${RESET}\n"
    printf "\n"
    ;;

# ─── replay ──────────────────────────────────────────────────────────────────

  replay)
    sleep 0.3
    printf "${GREEN}✓ Hash chain integrity verified${RESET}\n"
    sleep 0.3
    printf "${BOLD}\nLedger replay — 2 run(s):${RESET}\n"

    sleep 0.3
    printf "\n${BOLD}Run: d361c1a2-4f8b-4e9a-bc3d-7a2e1f0c8d45${RESET}\n"
    printf "  ${DIM}status:${RESET}  ${RED}failed${RESET}\n"
    printf "  ${DIM}goal:${RESET}    add Redis caching\n"
    printf "  ${DIM}started:${RESET} $(date -u +%Y-%m-%dT%H:%M:%SZ)\n"
    printf "\n"
    printf "  ${DIM}Tasks:${RESET}\n"
    printf "    ${RED}●${RESET} ${BOLD}task-bv-001${RESET} — ${RED}failed${RESET}\n"
    printf "      ${DIM}Add Redis caching to src/db.ts${RESET}\n"
    printf "      ${DIM}↳ BOUNDARY_VIOLATION: .env matches blocked pattern${RESET}\n"
    printf "\n"

    sleep 0.5
    printf "${BOLD}Run: a7f3b891-22dc-4c01-9f6e-0b5a3d8e2c71${RESET}\n"
    printf "  ${DIM}status:${RESET}  ${RED}failed${RESET}\n"
    printf "  ${DIM}goal:${RESET}    add in-memory cache\n"
    printf "  ${DIM}started:${RESET} $(date -u +%Y-%m-%dT%H:%M:%SZ)\n"
    printf "\n"
    printf "  ${DIM}Tasks:${RESET}\n"
    printf "    ${RED}●${RESET} ${BOLD}task-vf-001${RESET} — ${RED}failed${RESET}\n"
    printf "      ${DIM}Add in-memory cache to src/db.ts${RESET}\n"
    printf "      ${DIM}↳ VERIFICATION_FAILED: npm test exited 1 (worker self-reported success)${RESET}\n"
    printf "\n"

    sleep 0.3
    printf "  ${RED}2 failed${RESET}\n"
    printf "\n"
    ;;

  *)
    printf "${RED}Unknown command: $SUBCOMMAND${RESET}\n"
    exit 1
    ;;
esac
