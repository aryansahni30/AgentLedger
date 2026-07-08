import OpenAI from "openai";

const TOGETHER_BASE_URL = "https://api.together.xyz/v1";

let _client: OpenAI | null = null;

/**
 * Returns a singleton OpenAI-compatible client pointed at Together AI.
 * Reads TOGETHER_API_KEY from the environment — throws if missing.
 */
export function getTogetherClient(): OpenAI {
  if (_client !== null) {
    return _client;
  }

  const apiKey = process.env["TOGETHER_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "TOGETHER_API_KEY environment variable is not set.\n" +
        "Export it before running: export TOGETHER_API_KEY=<your-key>",
    );
  }

  _client = new OpenAI({ apiKey, baseURL: TOGETHER_BASE_URL });
  return _client;
}

/** Reset the singleton (for testing). */
export function _resetTogetherClient(): void {
  _client = null;
}
