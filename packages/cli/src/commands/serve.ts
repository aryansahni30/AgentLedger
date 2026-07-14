import { join } from "node:path";
import { createServer } from "@agentledger/server";

export async function runServe(
  targetDir: string,
  opts: { port: number },
): Promise<void> {
  const ledgerDir = join(targetDir, ".agentledger");
  const { port, close } = await createServer({ ledgerDir, port: opts.port });

  console.log(`AgentLedger server running on http://localhost:${port}`);
  console.log("SSE stream:  http://localhost:" + String(port) + "/api/events");
  console.log("Press Ctrl+C to stop.\n");

  const shutdown = async (): Promise<void> => {
    console.log("Shutting down server...");
    await close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
