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
const CLAUDE_ROOT_PARENT = "00000000-0000-4000-8000-000000000000";

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

  if (!isObject(data)) {
    return invalidObjectResult(stats);
  }

  const topLevelKeys = Object.keys(data).sort();

  if (typeof data.current_node !== "string" || !data.current_node) {
    violations.push("current_node is missing or is not a non-empty string");
  }

  if (!isObject(data.mapping)) {
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
    if (!isObject(message)) continue;
    stats.messages += 1;

    const role = message.author?.role;
    if (role === "user") stats.userMessages += 1;
    else if (role === "assistant") stats.assistantMessages += 1;
    else if (role === "tool") stats.toolMessages += 1;

    if (!isObject(message.content)) {
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

export function validateClaudeConversation(data) {
  const violations = [];
  const stats = {
    messages: 0,
    humanMessages: 0,
    assistantMessages: 0,
    contentBlocks: 0,
    activeBranchMessages: 0,
  };

  if (!isObject(data)) {
    return invalidObjectResult(stats);
  }

  const topLevelKeys = Object.keys(data).sort();
  const messages = data.chat_messages;

  if (!Array.isArray(messages)) {
    violations.push("chat_messages is missing or is not an array");
    return { ok: false, violations, stats, topLevelKeys };
  }

  if (typeof data.current_leaf_message_uuid !== "string" || !data.current_leaf_message_uuid) {
    violations.push("current_leaf_message_uuid is missing or is not a non-empty string");
  }

  const byId = new Map();
  for (const message of messages) {
    if (!isObject(message)) {
      violations.push("at least one chat_messages entry is not an object");
      continue;
    }

    stats.messages += 1;
    const id = message.uuid;
    if (typeof id !== "string" || !id) {
      violations.push("at least one Claude message has no non-empty uuid");
    } else {
      byId.set(id, message);
    }

    if (message.sender === "human") stats.humanMessages += 1;
    else if (message.sender === "assistant") stats.assistantMessages += 1;

    if (message.content != null && !Array.isArray(message.content)) {
      violations.push("at least one Claude message has non-array content");
    } else if (Array.isArray(message.content)) {
      stats.contentBlocks += message.content.length;
    }
  }

  const leafId = data.current_leaf_message_uuid;
  if (leafId && !byId.has(leafId)) {
    violations.push("chat_messages does not contain current_leaf_message_uuid");
  }

  if (leafId && byId.has(leafId)) {
    const seen = new Set();
    let id = leafId;
    while (id) {
      if (seen.has(id)) {
        violations.push("active Claude message branch contains a cycle");
        break;
      }
      seen.add(id);

      const message = byId.get(id);
      if (!message) {
        violations.push(`active branch references missing parent message ${id}`);
        break;
      }

      stats.activeBranchMessages += 1;
      const parent = message.parent_message_uuid;
      if (!parent || parent === CLAUDE_ROOT_PARENT) break;
      id = parent;
    }
  }

  if (stats.messages === 0) violations.push("chat_messages is empty");
  if (stats.humanMessages === 0) violations.push("no human Claude message was found");
  if (stats.assistantMessages === 0) violations.push("no assistant Claude message was found");

  const uniqueViolations = [...new Set(violations)];
  return {
    ok: uniqueViolations.length === 0,
    violations: uniqueViolations,
    stats,
    topLevelKeys,
  };
}

export function validateGrokConversation(data) {
  const violations = [];
  const stats = {
    responses: 0,
    responseIds: 0,
    controlResponses: 0,
    turns: 0,
    userTurns: 0,
    assistantTurns: 0,
    turnsWithCards: 0,
    turnsWithFiles: 0,
  };

  if (!isObject(data)) {
    return invalidObjectResult(stats);
  }

  const topLevelKeys = Object.keys(data).sort();

  if (typeof data.conversationId !== "string" || !data.conversationId) {
    violations.push("conversationId is missing or is not a non-empty string");
  }

  if (!Array.isArray(data.responses)) {
    violations.push("responses is missing or is not an array");
    return { ok: false, violations, stats, topLevelKeys };
  }

  if (!Array.isArray(data.turns)) {
    violations.push("turns is missing or is not an array");
    return { ok: false, violations, stats, topLevelKeys };
  }

  const responseIds = new Set();
  for (const response of data.responses) {
    if (!isObject(response)) {
      violations.push("at least one Grok response is not an object");
      continue;
    }

    stats.responses += 1;
    if (response.isControl === true) stats.controlResponses += 1;
    if (response.responseId != null && String(response.responseId)) {
      responseIds.add(String(response.responseId));
      stats.responseIds += 1;
    }
  }

  for (const turn of data.turns) {
    if (!isObject(turn)) {
      violations.push("at least one Grok active-branch turn is not an object");
      continue;
    }

    stats.turns += 1;
    const id = typeof turn.id === "string" ? turn.id : "";
    if (!id) {
      violations.push("at least one Grok turn has no non-empty id");
    } else if (!responseIds.has(id)) {
      violations.push(`Grok turn ${id} is absent from the raw responses array`);
    }

    if (turn.role === "user") stats.userTurns += 1;
    else if (turn.role === "assistant") stats.assistantTurns += 1;
    else violations.push("at least one Grok turn has an unrecognized role");

    if (typeof turn.message !== "string") {
      violations.push("at least one Grok turn has a non-string message");
    }
    if (!Array.isArray(turn.cardAttachmentsJson)) {
      violations.push("at least one Grok turn has non-array cardAttachmentsJson");
    } else if (turn.cardAttachmentsJson.length) {
      stats.turnsWithCards += 1;
    }
    if (!Array.isArray(turn.fileAttachments)) {
      violations.push("at least one Grok turn has non-array fileAttachments");
    } else if (turn.fileAttachments.length) {
      stats.turnsWithFiles += 1;
    }
    if (
      turn.parentResponseId != null &&
      typeof turn.parentResponseId !== "string"
    ) {
      violations.push("at least one Grok turn has a non-string parentResponseId");
    }
  }

  if (stats.responses === 0) violations.push("responses is empty");
  if (stats.responseIds === 0) violations.push("responses contains no responseId values");
  if (stats.turns === 0) violations.push("active Grok branch contains no recognized turns");
  if (stats.userTurns === 0) violations.push("no user Grok turn was found");
  if (stats.assistantTurns === 0) violations.push("no assistant Grok turn was found");

  const uniqueViolations = [...new Set(violations)];
  return {
    ok: uniqueViolations.length === 0,
    violations: uniqueViolations,
    stats,
    topLevelKeys,
  };
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function invalidObjectResult(stats) {
  return {
    ok: false,
    violations: ["response is not an object"],
    stats,
    topLevelKeys: [],
  };
}
