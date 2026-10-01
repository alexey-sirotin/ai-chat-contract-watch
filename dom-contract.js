function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function expectedTurnIds(apiData) {
  return Array.isArray(apiData?.turns)
    ? apiData.turns.map((turn) => String(turn?.id || "")).filter(Boolean)
    : [];
}

function overlapCount(actualIds, expectedIds) {
  const expected = new Set((expectedIds || []).map(String));
  return [...new Set((actualIds || []).map(String))]
    .filter((id) => expected.has(id)).length;
}

export function validateSelectionDom(providerKey, snapshot, apiData = null) {
  if (!isObject(snapshot)) {
    return {
      ok: false,
      violations: ["DOM probe returned no snapshot object"],
      stats: {},
    };
  }

  switch (providerKey) {
    case "chatgpt":
      return validateChatGptDom(snapshot);
    case "claude":
      return validateClaudeDom(snapshot);
    case "grok":
      return validateGrokDom(snapshot, expectedTurnIds(apiData));
    case "deepseek":
      return validateDeepSeekDom(snapshot, expectedTurnIds(apiData));
    default:
      return {
        ok: false,
        violations: [`unknown DOM probe provider: ${providerKey}`],
        stats: snapshot,
      };
  }
}

function validateChatGptDom(snapshot) {
  const violations = [];
  const stats = {
    mode: snapshot.mode || "none",
    modernExchanges: Number(snapshot.modernExchanges || 0),
    userTurns: Number(snapshot.userTurns || 0),
    assistantTurns: Number(snapshot.assistantTurns || 0),
    recognizedTurns: Number(snapshot.recognizedTurns || 0),
  };

  if (stats.mode === "modern") {
    if (stats.userTurns < 1) {
      violations.push("modern ChatGPT DOM exposes no selectable user turn");
    }
    if (stats.assistantTurns < 1) {
      violations.push("modern ChatGPT DOM exposes no selectable assistant turn");
    }
  } else if (stats.mode === "legacy") {
    if (stats.recognizedTurns < 2) {
      violations.push("legacy ChatGPT DOM exposes fewer than two selectable turns");
    }
  } else {
    violations.push("ChatGPT DOM exposes neither the modern nor legacy selection structure");
  }

  return { ok: violations.length === 0, violations, stats };
}

function validateClaudeDom(snapshot) {
  const violations = [];
  const indexes = Array.isArray(snapshot.indexes)
    ? snapshot.indexes.filter((value) => Number.isInteger(value) && value >= 0)
    : [];
  const uniqueIndexes = [...new Set(indexes)];
  const stats = {
    rows: Number(snapshot.rows || 0),
    uniqueIndexes: uniqueIndexes.length,
    articleRows: Number(snapshot.articleRows || 0),
    ariaSetSize: Number.isInteger(snapshot.ariaSetSize) ? snapshot.ariaSetSize : null,
  };

  if (stats.rows < 2) {
    violations.push("Claude DOM exposes fewer than two transcript rows");
  }
  if (uniqueIndexes.length < 2) {
    violations.push("Claude transcript rows expose fewer than two usable data-index values");
  }

  return { ok: violations.length === 0, violations, stats };
}

function validateGrokDom(snapshot, expectedIds) {
  const violations = [];
  const ids = Array.isArray(snapshot.ids) ? snapshot.ids.map(String).filter(Boolean) : [];
  const uniqueIds = [...new Set(ids)];
  const overlap = overlapCount(uniqueIds, expectedIds);
  const expectedMinimum = Math.min(2, expectedIds.length);
  const stats = {
    responseNodes: Number(snapshot.responseNodes || 0),
    recognizedTurns: uniqueIds.length,
    userHosts: Number(snapshot.userHosts || 0),
    assistantHosts: Number(snapshot.assistantHosts || 0),
    expectedIdOverlap: overlap,
  };

  if (uniqueIds.length < 2) {
    violations.push("Grok DOM exposes fewer than two selectable response-* turns");
  }
  if (expectedMinimum > 0 && overlap < expectedMinimum) {
    violations.push("Grok DOM response ids no longer map to the active API branch ids");
  }

  return { ok: violations.length === 0, violations, stats };
}

function validateDeepSeekDom(snapshot, expectedIds) {
  const violations = [];
  const ids = Array.isArray(snapshot.ids) ? snapshot.ids.map(String).filter(Boolean) : [];
  const uniqueIds = [...new Set(ids)];
  const overlap = overlapCount(uniqueIds, expectedIds);
  const expectedMinimum = Math.min(2, expectedIds.length);
  const stats = {
    candidateNodes: Number(snapshot.candidateNodes || 0),
    recognizedTurns: uniqueIds.length,
    expectedIdOverlap: overlap,
  };

  if (uniqueIds.length < 2) {
    violations.push("DeepSeek DOM exposes fewer than two selectable message nodes with numeric ids");
  }
  if (expectedMinimum > 0 && overlap < expectedMinimum) {
    violations.push("DeepSeek DOM message ids no longer map to the active API branch ids");
  }

  return { ok: violations.length === 0, violations, stats };
}
