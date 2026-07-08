import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { AgentLedgerConfig } from "@agentledger/core";

const DEFAULT_CONFIG: AgentLedgerConfig = {
  version: "0.1.0",
  verification: {
    commands: {
      test: "npm test",
      typecheck: "npm run typecheck",
      lint: "npm run lint",
    },
    required: ["test"],
  },
};

const AGENTLEDGER_DIR = ".agentledger";

const SUBDIRS = ["artifacts", "patches", "worktrees", "runs"] as const;

export async function runInit(targetDir: string = process.cwd()): Promise<void> {
  const rootDir = join(targetDir, AGENTLEDGER_DIR);

  const alreadyExists = await access(rootDir)
    .then(() => true)
    .catch(() => false);

  if (alreadyExists) {
    console.log(`${AGENTLEDGER_DIR}/ already exists — skipping init.`);
    return;
  }

  await mkdir(rootDir, { recursive: true });

  for (const subdir of SUBDIRS) {
    await mkdir(join(rootDir, subdir), { recursive: true });
  }

  await writeFile(
    join(rootDir, "config.json"),
    JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
    "utf8",
  );

  await writeFile(join(rootDir, "ledger.jsonl"), "", "utf8");
  await writeFile(join(rootDir, "tasks.json"), "[]\n", "utf8");

  console.log(`Initialized ${AGENTLEDGER_DIR}/`);
  console.log(`  config.json     — edit verification commands as needed`);
  console.log(`  ledger.jsonl    — append-only run audit log`);
  console.log(`  tasks.json      — current task graph snapshot`);
}
