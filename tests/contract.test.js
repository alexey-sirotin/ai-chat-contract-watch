import { describe, expect, it } from "vitest";
import {
  extractConversationId,
  extractDeepSeekConversationId,
  validateChatGptConversation,
  validateClaudeConversation,
  validateGrokConversation,
  validateDeepSeekConversation,
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

  it("extracts a conversation UUID from a Grok URL", () => {
    expect(
      extractConversationId("https://grok.com/c/123e4567-e89b-12d3-a456-426614174000")
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("returns null when no UUID is present", () => {
    expect(extractConversationId("https://chatgpt.com/")).toBeNull();
  });
});

describe("extractDeepSeekConversationId", () => {
  it("extracts a DeepSeek session id without assuming UUID format", () => {
    expect(
      extractDeepSeekConversationId("https://chat.deepseek.com/a/chat/s/session_abc-123")
    ).toBe("session_abc-123");
  });

  it("returns null for a non-conversation DeepSeek URL", () => {
    expect(extractDeepSeekConversationId("https://chat.deepseek.com/")).toBeNull();
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

describe("validateGrokConversation", () => {
  it("accepts the minimal active branch consumed by the Grok normalizer", () => {
    const data = {
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
      responses: [
        {
          responseId: "user-1",
          sender: "human",
          message: "ping",
          parentResponseId: null,
        },
        {
          responseId: "assistant-1",
          sender: "assistant",
          message: "pong",
          parentResponseId: "user-1",
        },
      ],
      turns: [
        {
          id: "user-1",
          role: "user",
          message: "ping",
          cardAttachmentsJson: [],
          fileAttachments: [],
          parentResponseId: null,
        },
        {
          id: "assistant-1",
          role: "assistant",
          message: "pong",
          cardAttachmentsJson: [],
          fileAttachments: [],
          parentResponseId: "user-1",
        },
      ],
    };

    const result = validateGrokConversation(data);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.stats.responses).toBe(2);
    expect(result.stats.turns).toBe(2);
    expect(result.stats.userTurns).toBe(1);
    expect(result.stats.assistantTurns).toBe(1);
  });

  it("rejects a response without the raw responses array", () => {
    const result = validateGrokConversation({
      conversationId: "conversation-1",
      turns: [],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("responses is missing or is not an array");
  });

  it("rejects a Grok active branch without an assistant turn", () => {
    const result = validateGrokConversation({
      conversationId: "conversation-1",
      responses: [
        { responseId: "user-1", sender: "human", message: "ping" },
      ],
      turns: [
        {
          id: "user-1",
          role: "user",
          message: "ping",
          cardAttachmentsJson: [],
          fileAttachments: [],
          parentResponseId: null,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("no assistant Grok turn was found");
  });

  it("rejects a turn that no longer maps back to a raw response id", () => {
    const result = validateGrokConversation({
      conversationId: "conversation-1",
      responses: [
        { responseId: "user-1", sender: "human", message: "ping" },
        { responseId: "assistant-1", sender: "assistant", message: "pong" },
      ],
      turns: [
        {
          id: "user-1",
          role: "user",
          message: "ping",
          cardAttachmentsJson: [],
          fileAttachments: [],
          parentResponseId: null,
        },
        {
          id: "assistant-new",
          role: "assistant",
          message: "pong",
          cardAttachmentsJson: [],
          fileAttachments: [],
          parentResponseId: "user-1",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "Grok turn assistant-new is absent from the raw responses array",
    );
  });
});

describe("validateDeepSeekConversation", () => {
  it("accepts the minimal active branch consumed by the DeepSeek normalizer", () => {
    const data = {
      conversationId: "session_abc-123",
      currentMessageId: "2",
      rawMessageCount: 2,
      turns: [
        {
          id: "1",
          parentId: null,
          role: "user",
          sourceFragmentsArray: true,
          fragments: [{ type: "REQUEST", content: "ping" }],
        },
        {
          id: "2",
          parentId: "1",
          role: "assistant",
          sourceFragmentsArray: true,
          fragments: [{ type: "RESPONSE", content: "pong" }],
        },
      ],
    };

    const result = validateDeepSeekConversation(data);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.stats.rawMessages).toBe(2);
    expect(result.stats.turns).toBe(2);
    expect(result.stats.requestFragments).toBe(1);
    expect(result.stats.responseFragments).toBe(1);
  });

  it("rejects a branch whose current message is not the final turn", () => {
    const result = validateDeepSeekConversation({
      conversationId: "session-1",
      currentMessageId: "3",
      rawMessageCount: 2,
      turns: [
        {
          id: "1",
          parentId: null,
          role: "user",
          sourceFragmentsArray: true,
          fragments: [{ type: "REQUEST", content: "ping" }],
        },
        {
          id: "2",
          parentId: "1",
          role: "assistant",
          sourceFragmentsArray: true,
          fragments: [{ type: "RESPONSE", content: "pong" }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "active DeepSeek branch does not end at currentMessageId",
    );
  });

  it("rejects a non-array source fragments field", () => {
    const result = validateDeepSeekConversation({
      conversationId: "session-1",
      currentMessageId: "2",
      rawMessageCount: 2,
      turns: [
        {
          id: "1",
          parentId: null,
          role: "user",
          sourceFragmentsArray: false,
          fragments: [],
        },
        {
          id: "2",
          parentId: "1",
          role: "assistant",
          sourceFragmentsArray: true,
          fragments: [{ type: "RESPONSE", content: "pong" }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "at least one DeepSeek source message no longer has an array fragments field",
    );
  });
});
