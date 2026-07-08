import { getTogetherClient } from "./togetherClient.js";
import { retryWithSchema } from "./retryWithSchema.js";
import {
  buildPlannerSystemPrompt,
  buildPlannerUserMessage,
  buildPlannerRetryMessage,
} from "./prompts/planner.js";
import { TaskGraphSchema, type IntentContract, type TaskGraph } from "../schemas/index.js";

// Cheap models on Together AI that follow instructions well
export const DEFAULT_TOGETHER_PLANNER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";

/**
 * Calls Together AI (OpenAI-compatible) to convert an IntentContract into a TaskGraph.
 * Retries up to 3 times on schema validation failure.
 */
export async function planWithTogether(
  intent: IntentContract,
  repoContext: string,
  model = DEFAULT_TOGETHER_PLANNER_MODEL,
): Promise<TaskGraph> {
  const client = getTogetherClient();
  const systemPrompt = buildPlannerSystemPrompt();

  return retryWithSchema(
    async (attempt, lastError) => {
      const userContent =
        attempt === 1
          ? buildPlannerUserMessage(intent, repoContext)
          : buildPlannerRetryMessage(intent, repoContext, lastError ?? "unknown");

      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Planner returned empty response");
      }

      return content;
    },
    TaskGraphSchema,
    3,
  );
}
