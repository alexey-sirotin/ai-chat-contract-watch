import { describe, expect, it } from "vitest";
import { validateSelectionDom } from "../dom-contract.js";

describe("validateSelectionDom", () => {
  it("accepts the modern ChatGPT selection structure", () => {
    const result = validateSelectionDom("chatgpt", {
      mode: "modern",
      modernExchanges: 1,
      userTurns: 1,
      assistantTurns: 1,
      recognizedTurns: 2,
      ids: ["user-1", "assistant-1"],
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("rejects modern ChatGPT DOM without an assistant selection id", () => {
    const result = validateSelectionDom("chatgpt", {
      mode: "modern",
      modernExchanges: 1,
      userTurns: 1,
      assistantTurns: 0,
      recognizedTurns: 1,
      ids: ["user-1"],
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("modern ChatGPT DOM exposes no selectable assistant turn");
  });

  it("accepts two indexed Claude transcript rows", () => {
    const result = validateSelectionDom("claude", {
      rows: 2,
      indexes: [0, 1],
      articleRows: 2,
      ariaSetSize: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.stats.uniqueIndexes).toBe(2);
  });

  it("rejects Claude DOM when transcript-row disappeared", () => {
    const result = validateSelectionDom("claude", {
      rows: 0,
      indexes: [],
      articleRows: 0,
      ariaSetSize: null,
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("Claude DOM exposes fewer than two transcript rows");
  });

  it("requires Grok DOM ids to overlap the active API branch", () => {
    const apiData = {
      turns: [
        { id: "user-1", role: "user" },
        { id: "assistant-1", role: "assistant" },
      ],
    };
    const result = validateSelectionDom("grok", {
      responseNodes: 2,
      ids: ["user-1", "assistant-1"],
      userHosts: 1,
      assistantHosts: 1,
    }, apiData);

    expect(result.ok).toBe(true);
    expect(result.stats.expectedIdOverlap).toBe(2);
  });

  it("rejects Grok DOM ids that no longer match the API branch", () => {
    const apiData = {
      turns: [
        { id: "user-1", role: "user" },
        { id: "assistant-1", role: "assistant" },
      ],
    };
    const result = validateSelectionDom("grok", {
      responseNodes: 2,
      ids: ["new-user", "new-assistant"],
      userHosts: 1,
      assistantHosts: 1,
    }, apiData);

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("Grok DOM response ids no longer map to the active API branch ids");
  });

  it("accepts DeepSeek numeric DOM ids matching the active branch", () => {
    const apiData = {
      turns: [
        { id: "1001", role: "user" },
        { id: "1002", role: "assistant" },
      ],
    };
    const result = validateSelectionDom("deepseek", {
      candidateNodes: 2,
      ids: ["1001", "1002"],
    }, apiData);

    expect(result.ok).toBe(true);
    expect(result.stats.expectedIdOverlap).toBe(2);
  });
});
