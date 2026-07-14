import { z } from "zod";
import { replayLedger } from "@agentledger/core";
import { getReader } from "../ledger.js";

export const GetRunSummaryInputSchema = z.object({
  run_id: z.string().describe("Run ID to summarize"),
});

export type GetRunSummaryInput = z.infer<typeof GetRunSummaryInputSchema>;

export async function getRunSummary(input: GetRunSummaryInput) {
  const reader = getReader();
  const allEvents = await reader.readAll();
  return replayLedger(allEvents, input.run_id);
}
