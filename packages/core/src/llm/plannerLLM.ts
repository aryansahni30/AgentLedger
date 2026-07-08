import { getAnthropicClient } from "./client.js";
import { retryWithSchema } from "./retryWithSchema.js";
import {
  buildPlannerSystemPrompt,
  buildPlannerUserMessage,
  buildPlannerRetryMessage,
} from "./prompts/planner.js";
import { TaskGraphSchema, type IntentContract, type TaskGraph } from "../schemas/index.js";

export const DEFAULT_PLANNER_MODEL = "claude-haiku-4-5-20251001";

/**
 * Calls the LLM to convert an IntentContract into a TaskGraph.
 * Retries up to 3 times on schema validation failure.
 */
export async function planWithLLM(
  intent: IntentContract,
  repoContext: string,
  model = DEFAULT_PLANNER_MODEL,
): Promise<TaskGraph> {
  const client = getAnthropicClient();
  const systemPrompt = buildPlannerSystemPrompt();

  return retryWithSchema(
    async (attempt, lastError) => {
      const userContent =
        attempt === 1
          ? buildPlannerUserMessage(intent, repoContext)
          : buildPlannerRetryMessage(intent, repoContext, lastError ?? "unknown");

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      });

      const block = response.content[0];
      if (!block || block.type !== "text") {
        throw new Error("Planner returned non-text response");
      }

      return block.text;
    },
    TaskGraphSchema,
    3,
  );
}
