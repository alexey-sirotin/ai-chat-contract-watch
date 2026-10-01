import { describe, expect, it } from "vitest";
import {
  extractConversationId,
  validateChatGptConversation,
  validateClaudeConversation,
} from "../contract.js";

const CLAUDE_ROOT_PARENT = "00000000-0000-4000-8000-000000000000";

describe("extractConversationId", () => {
  it("extracts a conversation UUID from a ChatGPT URL", () => {
    expect(
      extractConversationId("https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000")
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("extracts a conversation UUID from a Claude URL", () => {
    expect(
      extractConversationId("https://claude.ai/chat/123e4567-e89b-12d3-a456-426614174000")
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

describe("validateClaudeConversation", () => {
  it("accepts the minimal tree shape consumed by the Claude normalizer", () => {
    const data = {
      uuid: "conversation-1",
      current_leaf_message_uuid: "assistant-1",
      chat_messages: [
        {
          uuid: "user-1",
          parent_message_uuid: CLAUDE_ROOT_PARENT,
          sender: "human",
          content: [{ type: "text", text: "ping" }],
        },
        {
          uuid: "assistant-1",
          parent_message_uuid: "user-1",
          sender: "assistant",
          content: [{ type: "text", text: "pong" }],
        },
      ],
    };

    const result = validateClaudeConversation(data);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.stats.messages).toBe(2);
    expect(result.stats.humanMessages).toBe(1);
    expect(result.stats.assistantMessages).toBe(1);
    expect(result.stats.activeBranchMessages).toBe(2);
  });

  it("rejects a response without chat_messages", () => {
    const result = validateClaudeConversation({
      current_leaf_message_uuid: "assistant-1",
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("chat_messages is missing or is not an array");
  });

  it("rejects a response whose leaf is not present", () => {
    const result = validateClaudeConversation({
      current_leaf_message_uuid: "missing",
      chat_messages: [
        {
          uuid: "user-1",
          parent_message_uuid: CLAUDE_ROOT_PARENT,
          sender: "human",
          content: [],
        },
        {
          uuid: "assistant-1",
          parent_message_uuid: "user-1",
          sender: "assistant",
          content: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("chat_messages does not contain current_leaf_message_uuid");
  });

  it("rejects non-array message content because the normalizer iterates it", () => {
    const result = validateClaudeConversation({
      current_leaf_message_uuid: "assistant-1",
      chat_messages: [
        {
          uuid: "user-1",
          parent_message_uuid: CLAUDE_ROOT_PARENT,
          sender: "human",
          content: [],
        },
        {
          uuid: "assistant-1",
          parent_message_uuid: "user-1",
          sender: "assistant",
          content: { type: "text", text: "pong" },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("at least one Claude message has non-array content");
  });

  it("rejects a cycle in the active parent chain", () => {
    const result = validateClaudeConversation({
      current_leaf_message_uuid: "assistant-1",
      chat_messages: [
        {
          uuid: "user-1",
          parent_message_uuid: "assistant-1",
          sender: "human",
          content: [],
        },
        {
          uuid: "assistant-1",
          parent_message_uuid: "user-1",
          sender: "assistant",
          content: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("active Claude message branch contains a cycle");
  });
});
