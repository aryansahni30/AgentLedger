#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runTasksView } from "./commands/tasks.js";
import { runVerify } from "./commands/verify.js";
import { runReplay } from "./commands/replay.js";
import { runRun } from "./commands/run.js";

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
  .option("--worker-model <model>", "worker model override")
  .action(async (request: string, options: { dir: string; mockPlanner: boolean; taskFile?: string; provider: string; model?: string; workerModel?: string }) => {
    const provider = options.provider === "together" ? "together" : "anthropic";
    const runOpts: {
      useMockPlanner?: boolean;
      taskFile?: string;
      model?: string;
      workerModel?: string;
      provider?: "anthropic" | "together";
    } = { useMockPlanner: options.mockPlanner, provider };
    if (options.taskFile !== undefined) runOpts.taskFile = options.taskFile;
    if (options.model !== undefined) runOpts.model = options.model;
    if (options.workerModel !== undefined) runOpts.workerModel = options.workerModel;
    await runRun(request, options.dir, runOpts);
  });

program.parse();
