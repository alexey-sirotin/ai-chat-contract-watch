export const ProbeStatus = Object.freeze({
  OK: "OK",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  NETWORK_ERROR: "NETWORK_ERROR",
  HTTP_ERROR: "HTTP_ERROR",
  SUSPECT: "SUSPECT",
  CONTRACT_MISMATCH: "CONTRACT_MISMATCH",
});

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractConversationId(value) {
  if (typeof value !== "string") return null;
  return value.match(UUID_RE)?.[0] ?? null;
}

export function validateChatGptConversation(data) {
  const violations = [];
  const stats = {
    mappingNodes: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolMessages: 0,
  };

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      violations: ["response is not an object"],
      stats,
      topLevelKeys: [],
    };
  }

  const topLevelKeys = Object.keys(data).sort();

  if (typeof data.current_node !== "string" || !data.current_node) {
    violations.push("current_node is missing or is not a non-empty string");
  }

  if (!data.mapping || typeof data.mapping !== "object" || Array.isArray(data.mapping)) {
    violations.push("mapping is missing or is not an object");
    return { ok: false, violations, stats, topLevelKeys };
  }

  const nodes = Object.values(data.mapping);
  stats.mappingNodes = nodes.length;

  if (data.current_node && !data.mapping[data.current_node]) {
    violations.push("mapping does not contain current_node");
  }

  for (const node of nodes) {
    const message = node?.message;
    if (!message || typeof message !== "object") continue;
    stats.messages += 1;

    const role = message.author?.role;
    if (role === "user") stats.userMessages += 1;
    else if (role === "assistant") stats.assistantMessages += 1;
    else if (role === "tool") stats.toolMessages += 1;

    if (!message.content || typeof message.content !== "object") {
      violations.push("at least one message has no content object");
      break;
    }
  }

  if (stats.mappingNodes === 0) violations.push("mapping is empty");
  if (stats.messages === 0) violations.push("mapping contains no messages");
  if (stats.userMessages === 0) violations.push("no user message was found");
  if (stats.assistantMessages === 0) violations.push("no assistant message was found");

  return {
    ok: violations.length === 0,
    violations,
    stats,
    topLevelKeys,
  };
}
