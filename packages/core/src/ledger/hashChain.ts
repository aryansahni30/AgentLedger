import { createHash } from "crypto";

export function computeHash(
  previousHash: string,
  payload: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(previousHash + JSON.stringify(payload))
    .digest("hex");
}

export function isValidHash(
  previousHash: string,
  payload: Record<string, unknown>,
  hash: string,
): boolean {
  return computeHash(previousHash, payload) === hash;
}
