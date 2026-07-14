import { join } from "path";
import { LedgerReader, LedgerWriter } from "@agentledger/core";

const AGENTLEDGER_DIR = ".agentledger";

export function getProjectRoot(): string {
  const root = process.env["AGENTLEDGER_PROJECT_ROOT"];
  if (!root) {
    throw new Error(
      "AGENTLEDGER_PROJECT_ROOT is not set. " +
        "Set it to the absolute path of the repo containing .agentledger/",
    );
  }
  return root;
}

export function getLedgerPath(): string {
  return join(getProjectRoot(), AGENTLEDGER_DIR, "ledger.jsonl");
}

export function getReader(): LedgerReader {
  return new LedgerReader(getLedgerPath());
}

export function getWriter(): LedgerWriter {
  return new LedgerWriter(getLedgerPath());
}
