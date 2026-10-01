import {
  ProbeStatus,
  extractConversationId,
  validateChatGptConversation,
  validateClaudeConversation,
  validateGrokConversation,
} from "./contract.js";
import {
  fetchChatGptConversationInPage,
  fetchClaudeConversationInPage,
  fetchGrokConversationInPage,
} from "./providers.js";

const CHECK_ALARM = "contract-watch-periodic";
const RETRY_ALARM_PREFIX = "contract-watch-retry-";
const LEGACY_RETRY_ALARM = "contract-watch-retry";
const DEFAULT_INTERVAL_MINUTES = 12 * 60;
const RETRY_DELAY_MINUTES = 5;

const PROVIDERS = Object.freeze({
  chatgpt: {
    label: "ChatGPT",
    tabQuery: "https://chatgpt.com/*",
    validator: validateChatGptConversation,
    successSummary(stats) {
      return `ChatGPT contract looks compatible (${stats.messages} messages, ${stats.mappingNodes} mapping nodes).`;
    },
    fetchInPage: fetchChatGptConversationInPage,
  },
  claude: {
    label: "Claude",
    tabQuery: "https://claude.ai/*",
    validator: validateClaudeConversation,
    successSummary(stats) {
      return `Claude contract looks compatible (${stats.messages} messages, ${stats.activeBranchMessages} active-branch messages).`;
    },
    fetchInPage: fetchClaudeConversationInPage,
  },
  grok: {
    label: "Grok",
    tabQuery: "https://grok.com/*",
    validator: validateGrokConversation,
    successSummary(stats) {
      return `Grok contract looks compatible (${stats.responses} responses, ${stats.turns} active-branch turns).`;
    },
    fetchInPage: fetchGrokConversationInPage,
  },
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.clear(LEGACY_RETRY_ALARM);
  void ensurePeriodicAlarm();
  void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void ensurePeriodicAlarm();
  void refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) {
    void runAllProbes();
    return;
  }

  if (alarm.name.startsWith(RETRY_ALARM_PREFIX)) {
    const providerKey = alarm.name.slice(RETRY_ALARM_PREFIX.length);
    if (PROVIDERS[providerKey]) {
      void runProviderProbe(providerKey, { retry: true });
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = (async () => {
    if (message?.type === "get-state") {
      return {
        ok: true,
        config: await getConfig(),
        state: await getState(),
      };
    }

    if (message?.type === "save-config") {
      const providerKey = normalizeProviderKey(message?.provider);
      const conversationUrl = String(message?.conversationUrl ?? "").trim();
      const config = await getConfig();
      config[providerKey] = { conversationUrl };
      await chrome.storage.local.set({ config });

      const state = await getState();
      if (!conversationUrl) {
        state.providers[providerKey] = defaultProviderState(PROVIDERS[providerKey].label);
        await saveState(state);
      }

      return { ok: true, config: await getConfig(), state: await getState() };
    }

    if (message?.type === "run-now") {
      const providerKey = normalizeProviderKey(message?.provider);
      const result = await runProviderProbe(providerKey, { retry: false });
      return { ok: true, result, state: await getState() };
    }

    if (message?.type === "run-all") {
      const results = await runAllProbes();
      return { ok: true, results, state: await getState() };
    }

    throw new Error(`Unknown message type: ${message?.type ?? "<missing>"}`);
  })();

  task.then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

function normalizeProviderKey(value) {
  const key = String(value || "chatgpt");
  if (!PROVIDERS[key]) throw new Error(`Unknown provider: ${key}`);
  return key;
}

function defaultProviderState(label) {
  return {
    status: ProbeStatus.NOT_CONFIGURED,
    observedStatus: ProbeStatus.NOT_CONFIGURED,
    checkedAt: null,
    summary: `${label} canary is not configured.`,
    violations: [],
    stats: null,
    topLevelKeys: [],
    consecutiveContractFailures: 0,
  };
}

async function ensurePeriodicAlarm() {
  const existing = await chrome.alarms.get(CHECK_ALARM);
  if (!existing) {
    await chrome.alarms.create(CHECK_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: DEFAULT_INTERVAL_MINUTES,
    });
  }
}

async function getConfig() {
  const { config } = await chrome.storage.local.get("config");
  return Object.fromEntries(
    Object.keys(PROVIDERS).map((key) => [
      key,
      { conversationUrl: config?.[key]?.conversationUrl ?? "" },
    ]),
  );
}

async function getState() {
  const { state } = await chrome.storage.local.get("state");
  const providers = {};
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    providers[key] = {
      ...defaultProviderState(provider.label),
      ...(state?.providers?.[key] ?? {}),
    };
  }
  return { providers };
}

async function saveState(state) {
  await chrome.storage.local.set({ state });
  await applyBadge(state);
}

async function refreshBadge() {
  await applyBadge(await getState());
}

async function applyBadge(state) {
  const statuses = Object.values(state?.providers ?? {}).map((item) => item?.status);
  let text = "-";
  let color = "#6b7280";
  let titleStatus = "NOT CONFIGURED";

  if (statuses.includes(ProbeStatus.CONTRACT_MISMATCH)) {
    text = "!";
    color = "#c62828";
    titleStatus = "CONTRACT MISMATCH";
  } else if (
    statuses.some((status) => [
      ProbeStatus.SUSPECT,
      ProbeStatus.AUTH_REQUIRED,
      ProbeStatus.NETWORK_ERROR,
      ProbeStatus.HTTP_ERROR,
    ].includes(status))
  ) {
    text = "?";
    color = "#b78103";
    titleStatus = "ATTENTION";
  } else if (statuses.includes(ProbeStatus.OK)) {
    text = "✓";
    color = "#198754";
    titleStatus = "OK";
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title: `AI Chat Contract Watch — ${titleStatus}` });
}

async function setRunningBadge() {
  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  await chrome.action.setTitle({ title: "AI Chat Contract Watch — running" });
}

async function runAllProbes() {
  const results = {};
  for (const providerKey of Object.keys(PROVIDERS)) {
    results[providerKey] = await runProviderProbe(providerKey, { retry: false });
  }
  return results;
}

async function runProviderProbe(providerKey, { retry }) {
  const provider = PROVIDERS[providerKey];
  const config = await getConfig();
  const state = await getState();
  const previous = state.providers[providerKey];
  const conversationUrl = config[providerKey].conversationUrl;
  const conversationId = extractConversationId(conversationUrl);

  if (!conversationUrl || !conversationId) {
    const result = {
      ...defaultProviderState(provider.label),
      checkedAt: new Date().toISOString(),
      summary: conversationUrl
        ? `Configured ${provider.label} URL does not contain a conversation UUID.`
        : `${provider.label} canary is not configured.`,
    };
    state.providers[providerKey] = result;
    await saveState(state);
    return result;
  }

  await setRunningBadge();

  const observation = await observeInConversationTab({
    conversationUrl,
    conversationId,
    tabQuery: provider.tabQuery,
    providerLabel: provider.label,
    fetchInPage: provider.fetchInPage,
  });

  const interpreted = interpretObservation(observation, provider);
  const result = applyFailureConfirmation(interpreted, previous, retry);
  state.providers[providerKey] = result;
  await saveState(state);

  const retryAlarm = `${RETRY_ALARM_PREFIX}${providerKey}`;
  if (result.status === ProbeStatus.SUSPECT) {
    await chrome.alarms.create(retryAlarm, {
      when: Date.now() + RETRY_DELAY_MINUTES * 60_000,
    });
  } else {
    await chrome.alarms.clear(retryAlarm);
  }

  return result;
}

async function observeInConversationTab({
  conversationUrl,
  conversationId,
  tabQuery,
  providerLabel,
  fetchInPage,
}) {
  let temporaryTabId = null;

  try {
    const tabs = await chrome.tabs.query({ url: tabQuery });
    let tab = tabs.find((candidate) => candidate.url?.includes(conversationId));

    if (!tab) {
      tab = await chrome.tabs.create({ url: conversationUrl, active: false });
      temporaryTabId = tab.id ?? null;
    }

    if (!tab?.id) throw new Error(`Could not create or locate a ${providerLabel} tab.`);
    await waitForTabComplete(tab.id, 30_000, providerLabel);
    return await fetchInPage(tab.id, conversationId);
  } catch (error) {
    return {
      kind: "network-error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (temporaryTabId !== null) {
      try {
        await chrome.tabs.remove(temporaryTabId);
      } catch {
        // The user may have closed the temporary tab first.
      }
    }
  }
}

function interpretObservation(observation, provider) {
  const checkedAt = new Date().toISOString();
  const base = {
    checkedAt,
    violations: [],
    stats: null,
    topLevelKeys: [],
  };

  if (!observation || typeof observation !== "object") {
    return {
      ...base,
      status: ProbeStatus.NETWORK_ERROR,
      observedStatus: ProbeStatus.NETWORK_ERROR,
      summary: "Probe returned no structured result.",
    };
  }

  if (observation.kind === "auth-required") {
    return {
      ...base,
      status: ProbeStatus.AUTH_REQUIRED,
      observedStatus: ProbeStatus.AUTH_REQUIRED,
      summary: observation.message || `${provider.label} authentication is required.`,
    };
  }

  if (observation.kind === "network-error") {
    return {
      ...base,
      status: ProbeStatus.NETWORK_ERROR,
      observedStatus: ProbeStatus.NETWORK_ERROR,
      summary: observation.message || `${provider.label} request failed before a usable response arrived.`,
    };
  }

  if (observation.kind === "http-error") {
    const status = observation.status === 401 || observation.status === 403
      ? ProbeStatus.AUTH_REQUIRED
      : ProbeStatus.HTTP_ERROR;
    return {
      ...base,
      status,
      observedStatus: status,
      summary: `${observation.stage} returned HTTP ${observation.status}.`,
    };
  }

  if (observation.kind === "invalid-json") {
    return {
      ...base,
      status: ProbeStatus.CONTRACT_MISMATCH,
      observedStatus: ProbeStatus.CONTRACT_MISMATCH,
      summary: `${observation.stage} returned HTTP 200 but the body was not JSON.`,
      violations: [`${observation.stage} response is not valid JSON`],
    };
  }

  if (observation.kind === "contract-error") {
    return {
      ...base,
      status: ProbeStatus.CONTRACT_MISMATCH,
      observedStatus: ProbeStatus.CONTRACT_MISMATCH,
      summary: observation.message || `${provider.label} contract discovery failed.`,
      violations: [observation.violation || "provider contract discovery failed"],
    };
  }

  if (observation.kind !== "ok") {
    return {
      ...base,
      status: ProbeStatus.NETWORK_ERROR,
      observedStatus: ProbeStatus.NETWORK_ERROR,
      summary: `Unexpected probe result: ${observation.kind ?? "unknown"}.`,
    };
  }

  const validation = provider.validator(observation.data);
  if (!validation.ok) {
    return {
      ...base,
      status: ProbeStatus.CONTRACT_MISMATCH,
      observedStatus: ProbeStatus.CONTRACT_MISMATCH,
      summary: `${provider.label} returned HTTP 200, but ${validation.violations.length} contract invariant(s) failed.`,
      violations: validation.violations,
      stats: validation.stats,
      topLevelKeys: validation.topLevelKeys,
    };
  }

  return {
    ...base,
    status: ProbeStatus.OK,
    observedStatus: ProbeStatus.OK,
    summary: provider.successSummary(validation.stats),
    stats: validation.stats,
    topLevelKeys: validation.topLevelKeys,
  };
}

function applyFailureConfirmation(current, previous, retry) {
  if (current.observedStatus !== ProbeStatus.CONTRACT_MISMATCH) {
    return {
      ...current,
      consecutiveContractFailures: 0,
    };
  }

  const previousFailures = Number(previous?.consecutiveContractFailures || 0);
  const consecutiveContractFailures = previousFailures + 1;

  if (consecutiveContractFailures < 2) {
    return {
      ...current,
      status: ProbeStatus.SUSPECT,
      consecutiveContractFailures,
      summary: `${current.summary} Will retry in ${RETRY_DELAY_MINUTES} minutes before raising a contract alert.`,
    };
  }

  return {
    ...current,
    status: ProbeStatus.CONTRACT_MISMATCH,
    consecutiveContractFailures,
    summary: retry
      ? `${current.summary} The retry failed too; contract mismatch confirmed.`
      : `${current.summary} Contract mismatch confirmed by consecutive checks.`,
  };
}

async function waitForTabComplete(tabId, timeoutMs, providerLabel) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for the ${providerLabel} canary tab to load.`));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error(`The ${providerLabel} canary tab was closed before it finished loading.`));
      }
    };

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}
