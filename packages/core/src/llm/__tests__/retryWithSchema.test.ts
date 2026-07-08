import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  extractJSON,
  validateWithSchema,
  retryWithSchema,
  SchemaValidationError,
} from "../retryWithSchema.js";

// ─── extractJSON ──────────────────────────────────────────────────────────────

describe("extractJSON", () => {
  it("extracts from labelled ```json fence", () => {
    const input = '```json\n{"foo": 1}\n```';
    expect(extractJSON(input)).toBe('{"foo": 1}');
  });

  it("extracts from unlabelled ``` fence", () => {
    const input = '```\n{"bar": 2}\n```';
    expect(extractJSON(input)).toBe('{"bar": 2}');
  });

  it("extracts bare JSON object from surrounding text", () => {
    const input = 'Here is the result:\n{"baz": 3}\nDone.';
    expect(extractJSON(input)).toBe('{"baz": 3}');
  });

  it("extracts JSON array from surrounding text", () => {
    const input = "Result: [1,2,3]";
    expect(extractJSON(input)).toBe("[1,2,3]");
  });

  it("returns trimmed input when no JSON block found", () => {
    expect(extractJSON("  hello world  ")).toBe("hello world");
  });

  it("prefers labelled fence over unlabelled fence", () => {
    const input = "```json\n{\"a\":1}\n```\n```\n{\"b\":2}\n```";
    expect(extractJSON(input)).toBe('{"a":1}');
  });
});

// ─── validateWithSchema ───────────────────────────────────────────────────────

describe("validateWithSchema", () => {
  const schema = z.object({ name: z.string(), count: z.number() });

  it("parses valid JSON string", () => {
    const result = validateWithSchema('{"name":"alice","count":5}', schema);
    expect(result).toEqual({ name: "alice", count: 5 });
  });

  it("extracts JSON from markdown then validates", () => {
    const raw = '```json\n{"name":"bob","count":3}\n```';
    expect(validateWithSchema(raw, schema)).toEqual({ name: "bob", count: 3 });
  });

  it("throws SyntaxError for invalid JSON", () => {
    expect(() => validateWithSchema("not json", schema)).toThrow(SyntaxError);
  });

  it("throws ZodError for schema mismatch", () => {
    expect(() => validateWithSchema('{"name":123}', schema)).toThrow();
  });
});

// ─── retryWithSchema ─────────────────────────────────────────────────────────

describe("retryWithSchema", () => {
  const schema = z.object({ value: z.number() });

  it("returns on first successful attempt", async () => {
    const generate = vi.fn().mockResolvedValueOnce('{"value":42}');
    const result = await retryWithSchema(generate, schema);
    expect(result).toEqual({ value: 42 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(1, undefined);
  });

  it("retries after validation failure and succeeds on second attempt", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"value":7}');

    const result = await retryWithSchema(generate, schema, 3);
    expect(result).toEqual({ value: 7 });
    expect(generate).toHaveBeenCalledTimes(2);
    // Second call receives lastError from first failure
    expect(generate.mock.calls[1]![0]).toBe(2);
    expect(typeof generate.mock.calls[1]![1]).toBe("string");
  });

  it("throws SchemaValidationError after exhausting all attempts", async () => {
    const generate = vi.fn().mockResolvedValue("invalid");

    await expect(retryWithSchema(generate, schema, 3)).rejects.toThrow(SchemaValidationError);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("SchemaValidationError exposes attempts and lastRaw", async () => {
    const generate = vi.fn().mockResolvedValue("bad");

    try {
      await retryWithSchema(generate, schema, 2);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const e = err as SchemaValidationError;
      expect(e.attempts).toBe(2);
      expect(e.lastRaw).toBe("bad");
    }
  });

  it("passes error string from previous attempt to next generate call", async () => {
    const errors: Array<string | undefined> = [];
    const generate = vi.fn().mockImplementation(async (_attempt: number, lastError?: string) => {
      errors.push(lastError);
      return "invalid";
    });

    await expect(retryWithSchema(generate, schema, 3)).rejects.toThrow(SchemaValidationError);
    expect(errors[0]).toBeUndefined();
    expect(typeof errors[1]).toBe("string");
    expect(typeof errors[2]).toBe("string");
  });

  it("respects maxAttempts of 1", async () => {
    const generate = vi.fn().mockResolvedValue('{"value":99}');
    const result = await retryWithSchema(generate, schema, 1);
    expect(result).toEqual({ value: 99 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("handles Zod schema with coercion", async () => {
    const coercedSchema = z.object({ id: z.coerce.number() });
    const generate = vi.fn().mockResolvedValue('{"id":"5"}');
    const result = await retryWithSchema(generate, coercedSchema);
    expect(result).toEqual({ id: 5 });
  });
});
