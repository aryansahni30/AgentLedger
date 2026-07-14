#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runTasksView } from "./commands/tasks.js";
import { runVerify } from "./commands/verify.js";
import { runReplay } from "./commands/replay.js";
import { runRun } from "./commands/run.js";
import { runResume } from "./commands/resume.js";
import { listApprovals, approveRun, rejectRun } from "./commands/approvals.js";
import { runHandoff } from "./commands/handoff.js";
import { runAssign } from "./commands/assign.js";
import { runAudit, runLeaderboard } from "./commands/audit.js";
import { runServe } from "./commands/serve.js";

const program = new Command();

program
  .name("agentledger")
  .description("Coordinate AI coding agents with an immutable task ledger and verification gate")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize AgentLedger in the current repository")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .action(async (options: { dir: string }) => {
    await runInit(options.dir);
  });

const tasks = program
  .command("tasks")
  .description("Manage task graph");

tasks
  .command("view")
  .description("Display the current task graph")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .action(async (options: { dir: string }) => {
    await runTasksView(options.dir);
  });

program
  .command("verify")
  .description("Verify a task's worktree — boundary check + run test commands")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .option("-t, --task <taskId>", "task ID to verify (default: first awaiting_verification task)")
  .action(async (options: { dir: string; task?: string }) => {
    const opts = options.task !== undefined ? { taskId: options.task } : {};
    await runVerify(options.dir, opts);
  });

program
  .command("replay")
  .description("Reconstruct and display run state from the ledger event log")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .option("-r, --run <runId>", "replay a specific run ID (default: all runs)")
  .option("--no-verify-chain", "skip hash chain integrity check")
  .action(async (options: { dir: string; run?: string; verifyChain: boolean }) => {
    const opts: { runId?: string; verifyChain?: boolean } = { verifyChain: options.verifyChain };
    if (options.run !== undefined) opts.runId = options.run;
    await runReplay(options.dir, opts);
  });

program
  .command("run")
  .description("Run a goal end-to-end: plan → execute → verify")
  .argument("<request>", "natural language goal (e.g. \"add caching to user service\")")
  .option("-d, --dir <path>", "target repo directory", process.cwd())
  .option("--mock-planner", "use rule-based mock planner instead of LLM", false)
  .option("--task-file <path>", "path to a tasks.json file — bypasses planner entirely")
  .option("--provider <provider>", "LLM provider: anthropic | together", "anthropic")
  .option("--model <model>", "planner model override")
  .option("--worker-model <model>", "worker model override (only applies to llm/together workers)")
  .option(
    "--worker <type>",
    "worker backend: claude-code (default, uses your Claude Code install), llm (direct Anthropic API), together, mock",
    "claude-code",
  )
  .option("--concurrency <n>", "max tasks to execute in parallel (default: 1)", "1")
  .action(async (request: string, options: {
    dir: string;
    mockPlanner: boolean;
    taskFile?: string;
    provider: string;
    model?: string;
    workerModel?: string;
    worker: string;
    concurrency: string;
  }) => {
    const provider = options.provider === "together" ? "together" : "anthropic";
    const runOpts: {
      useMockPlanner?: boolean;
      taskFile?: string;
      model?: string;
      workerModel?: string;
      provider?: "anthropic" | "together";
      worker?: string;
      concurrency?: number;
    } = {
      useMockPlanner: options.mockPlanner,
      provider,
      worker: options.worker,
      concurrency: parseInt(options.concurrency, 10),
    };
    if (options.taskFile !== undefined) runOpts.taskFile = options.taskFile;
    if (options.model !== undefined) runOpts.model = options.model;
    if (options.workerModel !== undefined) runOpts.workerModel = options.workerModel;
    await runRun(request, options.dir, runOpts);
  });

program
  .command("resume")
  .description("Resume a paused run after human approval")
  .argument("<runId>", "run ID to resume (shown when run paused for approval)")
  .option("-d, --dir <path>", "target repo directory", process.cwd())
  .option("--provider <provider>", "LLM provider: anthropic | together", "anthropic")
  .option("--worker-model <model>", "worker model override")
  .action(async (runId: string, options: { dir: string; provider: string; workerModel?: string }) => {
    const provider = options.provider === "together" ? "together" : "anthropic";
    const resumeOpts: { provider?: "anthropic" | "together"; workerModel?: string } = { provider };
    if (options.workerModel !== undefined) resumeOpts.workerModel = options.workerModel;
    await runResume(runId, options.dir, resumeOpts);
  });

const approvals = program
  .command("approvals")
  .description("Manage human approval gates for paused runs");

approvals
  .command("list")
  .description("List all runs currently awaiting human approval")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .action(async (options: { dir: string }) => {
    await listApprovals(options.dir);
  });

approvals
  .command("approve <runId>")
  .description("Grant approval for a paused run, then run `agentledger resume <runId>`")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .action(async (runId: string, options: { dir: string }) => {
    await approveRun(runId, options.dir);
  });

approvals
  .command("reject <runId>")
  .description("Reject a paused run (marks task as failed)")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .option("-m, --message <reason>", "rejection reason")
  .action(async (runId: string, options: { dir: string; message?: string }) => {
    await rejectRun(runId, options.dir, options.message);
  });

program
  .command("handoff")
  .description("Generate a handoff document for a run — shows completed, pending, and failed tasks with suggested next steps")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .option("-r, --run <runId>", "run ID (default: most recent run)")
  .option("--json", "output as JSON")
  .option("--brief", "richer HandoffBrief with typed failure reasons, file inventory, and unresolved risks")
  .option("--agent-prompt", "output a ready-to-paste LLM context prompt for agent resumption")
  .action(async (options: { dir: string; run?: string; json?: boolean; brief?: boolean; agentPrompt?: boolean }) => {
    const handoffOpts: { runId?: string; json?: boolean; brief?: boolean; agentPrompt?: boolean } = {
      json: options.json ?? false,
      brief: options.brief ?? false,
      agentPrompt: options.agentPrompt ?? false,
    };
    if (options.run !== undefined) handoffOpts.runId = options.run;
    await runHandoff(options.dir, handoffOpts);
  });

program
  .command("assign <runId> <taskId> <newOwner>")
  .description("Reassign a pending task to a new owner (records in ledger for full replay audit)")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .action(async (runId: string, taskId: string, newOwner: string, options: { dir: string }) => {
    await runAssign(runId, taskId, newOwner, options.dir);
  });

program
  .command("audit")
  .description("Generate a compliance audit report for a run — risk score, patch risks, approval summary")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .option("-r, --run <runId>", "run ID (default: most recent run)")
  .option("--json", "output as JSON")
  .action(async (options: { dir: string; run?: string; json?: boolean }) => {
    const auditOpts: { runId?: string; json?: boolean } = { json: options.json ?? false };
    if (options.run !== undefined) auditOpts.runId = options.run;
    await runAudit(options.dir, auditOpts);
  });

program
  .command("leaderboard")
  .description("Cross-run policy violation leaderboard — ranks all tasks by risk score descending")
  .option("-d, --dir <path>", "target directory", process.cwd())
  .option("--json", "output as JSON")
  .action(async (options: { dir: string; json?: boolean }) => {
    await runLeaderboard(options.dir, { json: options.json ?? false });
  });

program
  .command("serve")
  .description("Start the AgentLedger API server with SSE event stream")
  .option("-d, --dir <path>", "target repo directory", process.cwd())
  .option("-p, --port <number>", "port to listen on", "3000")
  .action(async (options: { dir: string; port: string }) => {
    await runServe(options.dir, { port: parseInt(options.port, 10) });
  });

program.parse();
