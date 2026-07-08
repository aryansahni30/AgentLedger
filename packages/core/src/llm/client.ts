import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/**
 * Returns a singleton Anthropic client.
 * Reads ANTHROPIC_API_KEY from the environment — throws if missing.
 */
export function getAnthropicClient(): Anthropic {
  if (_client !== null) {
    return _client;
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set.\n" +
        "Export it before running: export ANTHROPIC_API_KEY=sk-ant-...",
    );
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

/** Reset the singleton (for testing). */
export function _resetClient(): void {
  _client = null;
}
