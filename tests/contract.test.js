import { describe, expect, it } from "vitest";
import { extractConversationId, validateChatGptConversation } from "../contract.js";

describe("extractConversationId", () => {
  it("extracts a ChatGPT conversation UUID from a URL", () => {
    expect(
      extractConversationId("https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000")
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("returns null when no UUID is present", () => {
    expect(extractConversationId("https://chatgpt.com/")).toBeNull();
  });
});

describe("validateChatGptConversation", () => {
  it("accepts the minimal conversation shape used by the exporter", () => {
    const data = {
      current_node: "assistant-1",
      mapping: {
        root: { id: "root", message: null },
        "user-1": {
          id: "user-1",
          message: {
            author: { role: "user" },
            content: { content_type: "text", parts: ["ping"] },
          },
        },
        "assistant-1": {
          id: "assistant-1",
          message: {
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["pong"] },
          },
        },
      },
    };

    const result = validateChatGptConversation(data);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.stats.userMessages).toBe(1);
    expect(result.stats.assistantMessages).toBe(1);
  });

  it("rejects a response without mapping", () => {
    const result = validateChatGptConversation({ current_node: "x" });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("mapping is missing or is not an object");
  });

  it("rejects a response whose current node is absent from mapping", () => {
    const result = validateChatGptConversation({
      current_node: "missing",
      mapping: {
        user: {
          message: {
            author: { role: "user" },
            content: { content_type: "text", parts: ["ping"] },
          },
        },
        assistant: {
          message: {
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["pong"] },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("mapping does not contain current_node");
  });
});
