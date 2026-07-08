import { type ZodSchema, ZodError } from "zod";

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastRaw: string,
    public readonly lastError: string,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/**
 * Extracts JSON from a string that may contain markdown code fences.
 *
 * Priority:
 *   1. ```json ... ``` block
 *   2. ``` ... ``` block (unlabelled)
 *   3. First {...} or [...] found in the string
 *   4. The string itself (trimmed)
 */
export function extractJSON(text: string): string {
  // Try labelled json fence
  const labelledFence = /```json\s*([\s\S]*?)```/i.exec(text);
  if (labelledFence?.[1]) {
    return labelledFence[1].trim();
  }

  // Try unlabelled fence
  const unlabelledFence = /```\s*([\s\S]*?)```/.exec(text);
  if (unlabelledFence?.[1]) {
    return unlabelledFence[1].trim();
  }

  // Try to find a JSON object or array
  const jsonBlock = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(text);
  if (jsonBlock?.[1]) {
    return jsonBlock[1].trim();
  }

  return text.trim();
}

/**
 * Parses extracted JSON and validates against a Zod schema.
 * Throws ZodError or SyntaxError on failure.
 */
export function validateWithSchema<T>(raw: string, schema: ZodSchema<T>): T {
  const extracted = extractJSON(raw);
  const parsed: unknown = JSON.parse(extracted);
  return schema.parse(parsed);
}

/**
 * Calls `generate` up to `maxAttempts` times until the output passes
 * Zod schema validation. On failure, passes the previous error message
 * back to `generate` so the caller can include it in a follow-up prompt.
 *
 * Throws SchemaValidationError if all attempts fail.
 */
export async function retryWithSchema<T>(
  generate: (attempt: number, lastError?: string) => Promise<string>,
  schema: ZodSchema<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastRaw = "";
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastRaw = await generate(attempt, lastError);

    try {
      return validateWithSchema(lastRaw, schema);
    } catch (err) {
      if (err instanceof ZodError) {
        lastError = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } else if (err instanceof SyntaxError) {
        lastError = `JSON parse error: ${err.message}`;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  throw new SchemaValidationError(
    `Schema validation failed after ${maxAttempts} attempts. Last error: ${lastError ?? "unknown"}`,
    maxAttempts,
    lastRaw,
    lastError ?? "unknown",
  );
}
