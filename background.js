import { ProbeStatus, extractConversationId, validateChatGptConversation } from "./contract.js";

const CHECK_ALARM = "contract-watch-periodic";
const RETRY_ALARM = "contract-watch-retry";
const DEFAULT_INTERVAL_MINUTES = 12 * 60;
const RETRY_DELAY_MINUTES = 5;

const DEFAULT_STATE = {
  providers: {
    chatgpt: {
      status: ProbeStatus.NOT_CONFIGURED,
      observedStatus: ProbeStatus.NOT_CONFIGURED,
      checkedAt: null,
      summary: "ChatGPT canary is not configured.",
      violations: [],
      stats: null,
      topLevelKeys: [],
      consecutiveContractFailures: 0,
    },
  },
};

chrome.runtime.onInstalled.addListener(() => {
  void ensurePeriodicAlarm();
  void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void ensurePeriodicAlarm();
  void refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) {
    void runChatGptProbe({ retry: false });
  } else if (alarm.name === RETRY_ALARM) {
    void runChatGptProbe({ retry: true });
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
      const conversationUrl = String(message?.conversationUrl ?? "").trim();
      await chrome.storage.local.set({
        config: {
          ...(await getConfig()),
          chatgpt: { conversationUrl },
        },
      });
      const state = await getState();
      if (!conversationUrl) {
        state.providers.chatgpt = {
          ...DEFAULT_STATE.providers.chatgpt,
        };
        await saveState(state);
      }
      return { ok: true, config: await getConfig(), state: await getState() };
    }

    if (message?.type === "run-now") {
      const result = await runChatGptProbe({ retry: false });
      return { ok: true, result, state: await getState() };
    }

    throw new Error(`Unknown message type: ${message?.type ?? "<missing>"}`);
  })();

  task.then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

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
  return {
    chatgpt: {
      conversationUrl: config?.chatgpt?.conversationUrl ?? "",
    },
  };
}

async function getState() {
  const { state } = await chrome.storage.local.get("state");
  return {
    providers: {
      chatgpt: {
        ...DEFAULT_STATE.providers.chatgpt,
        ...(state?.providers?.chatgpt ?? {}),
      },
    },
  };
}

async function saveState(state) {
  await chrome.storage.local.set({ state });
  await applyBadge(state.providers.chatgpt);
}

async function refreshBadge() {
  await applyBadge((await getState()).providers.chatgpt);
}

async function applyBadge(providerState) {
  let text = "?";
  let color = "#6b7280";

  switch (providerState?.status) {
    case ProbeStatus.OK:
      text = "✓";
      color = "#198754";
      break;
    case ProbeStatus.CONTRACT_MISMATCH:
      text = "!";
      color = "#c62828";
      break;
    case ProbeStatus.SUSPECT:
    case ProbeStatus.AUTH_REQUIRED:
    case ProbeStatus.NETWORK_ERROR:
    case ProbeStatus.HTTP_ERROR:
      text = "?";
      color = "#b78103";
      break;
    case ProbeStatus.NOT_CONFIGURED:
    default:
      text = "-";
      color = "#6b7280";
      break;
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({
    title: `AI Chat Contract Watch — ${providerState?.status ?? ProbeStatus.NOT_CONFIGURED}`,
  });
}

async function runChatGptProbe({ retry }) {
  const config = await getConfig();
  const state = await getState();
  const previous = state.providers.chatgpt;
  const conversationUrl = config.chatgpt.conversationUrl;
  const conversationId = extractConversationId(conversationUrl);

  if (!conversationUrl || !conversationId) {
    const result = {
      ...DEFAULT_STATE.providers.chatgpt,
      checkedAt: new Date().toISOString(),
      summary: conversationUrl
        ? "Configured ChatGPT URL does not contain a conversation UUID."
        : "ChatGPT canary is not configured.",
    };
    state.providers.chatgpt = result;
    await saveState(state);
    return result;
  }

  await chrome.action.setBadgeText({ text: "…" });
  await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });

  let temporaryTabId = null;
  let observation;

  try {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    let tab = tabs.find((candidate) => candidate.url?.includes(conversationId));

    if (!tab) {
      tab = await chrome.tabs.create({ url: conversationUrl, active: false });
      temporaryTabId = tab.id ?? null;
    }

    if (!tab?.id) throw new Error("Could not create or locate a ChatGPT tab.");
    await waitForTabComplete(tab.id, 30_000);
    observation = await fetchConversationInPage(tab.id, conversationId);
  } catch (error) {
    observation = {
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

  const interpreted = interpretObservation(observation);
  const result = applyFailureConfirmation(interpreted, previous, retry);
  state.providers.chatgpt = result;
  await saveState(state);

  if (result.status === ProbeStatus.SUSPECT) {
    await chrome.alarms.create(RETRY_ALARM, {
      when: Date.now() + RETRY_DELAY_MINUTES * 60_000,
    });
  } else {
    await chrome.alarms.clear(RETRY_ALARM);
  }

  return result;
}

function interpretObservation(observation) {
  const checkedAt = new Date().toISOString();

  if (!observation || typeof observation !== "object") {
    return {
      status: ProbeStatus.NETWORK_ERROR,
      observedStatus: ProbeStatus.NETWORK_ERROR,
      checkedAt,
      summary: "Probe returned no structured result.",
      violations: [],
      stats: null,
      topLevelKeys: [],
    };
  }

  if (observation.kind === "auth-required") {
    return {
      status: ProbeStatus.AUTH_REQUIRED,
      observedStatus: ProbeStatus.AUTH_REQUIRED,
      checkedAt,
      summary: observation.message || "ChatGPT authentication is required.",
      violations: [],
      stats: null,
      topLevelKeys: [],
    };
  }

  if (observation.kind === "network-error") {
    return {
      status: ProbeStatus.NETWORK_ERROR,
      observedStatus: ProbeStatus.NETWORK_ERROR,
      checkedAt,
      summary: observation.message || "ChatGPT request failed before a usable response arrived.",
      violations: [],
      stats: null,
      topLevelKeys: [],
    };
  }

  if (observation.kind === "http-error") {
    if (observation.status === 401 || observation.status === 403) {
      return {
        status: ProbeStatus.AUTH_REQUIRED,
        observedStatus: ProbeStatus.AUTH_REQUIRED,
        checkedAt,
        summary: `${observation.stage} returned HTTP ${observation.status}.`,
        violations: [],
        stats: null,
        topLevelKeys: [],
      };
    }
    return {
      status: ProbeStatus.HTTP_ERROR,
      observedStatus: ProbeStatus.HTTP_ERROR,
      checkedAt,
      summary: `${observation.stage} returned HTTP ${observation.status}.`,
      violations: [],
      stats: null,
      topLevelKeys: [],
    };
  }

  if (observation.kind === "invalid-json") {
    return {
      status: ProbeStatus.CONTRACT_MISMATCH,
      observedStatus: ProbeStatus.CONTRACT_MISMATCH,
      checkedAt,
      summary: "ChatGPT conversation endpoint returned HTTP 200 but the body was not JSON.",
      violations: ["conversation response is not valid JSON"],
      stats: null,
      topLevelKeys: [],
    };
  }

  if (observation.kind !== "ok") {
    return {
      status: ProbeStatus.NETWORK_ERROR,
      observedStatus: ProbeStatus.NETWORK_ERROR,
      checkedAt,
      summary: `Unexpected probe result: ${observation.kind ?? "unknown"}.`,
      violations: [],
      stats: null,
      topLevelKeys: [],
    };
  }

  const validation = validateChatGptConversation(observation.data);
  if (!validation.ok) {
    return {
      status: ProbeStatus.CONTRACT_MISMATCH,
      observedStatus: ProbeStatus.CONTRACT_MISMATCH,
      checkedAt,
      summary: `ChatGPT returned HTTP 200, but ${validation.violations.length} contract invariant(s) failed.`,
      violations: validation.violations,
      stats: validation.stats,
      topLevelKeys: validation.topLevelKeys,
    };
  }

  return {
    status: ProbeStatus.OK,
    observedStatus: ProbeStatus.OK,
    checkedAt,
    summary: `ChatGPT contract looks compatible (${validation.stats.messages} messages, ${validation.stats.mappingNodes} mapping nodes).`,
    violations: [],
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

async function waitForTabComplete(tabId, timeoutMs) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the ChatGPT canary tab to load."));
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
        reject(new Error("The ChatGPT canary tab was closed before it finished loading."));
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

async function fetchConversationInPage(tabId, conversationId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [conversationId],
    func: async (id) => {
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          credentials: "include",
        });

        if (!sessionResponse.ok) {
          return {
            kind: "http-error",
            stage: "auth/session",
            status: sessionResponse.status,
          };
        }

        let session;
        try {
          session = await sessionResponse.json();
        } catch {
          return {
            kind: "invalid-json",
            stage: "auth/session",
            status: sessionResponse.status,
          };
        }

        const accessToken = session?.accessToken;
        if (!accessToken) {
          return {
            kind: "auth-required",
            message: "ChatGPT session has no access token; sign in and retry.",
          };
        }

        const conversationResponse = await fetch(
          `/backend-api/conversation/${encodeURIComponent(id)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            credentials: "include",
          },
        );

        if (!conversationResponse.ok) {
          return {
            kind: "http-error",
            stage: "backend-api/conversation",
            status: conversationResponse.status,
          };
        }

        try {
          return {
            kind: "ok",
            status: conversationResponse.status,
            data: await conversationResponse.json(),
          };
        } catch {
          return {
            kind: "invalid-json",
            stage: "backend-api/conversation",
            status: conversationResponse.status,
          };
        }
      } catch (error) {
        return {
          kind: "network-error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  return result;
}
