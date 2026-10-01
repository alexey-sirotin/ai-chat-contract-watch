const STATUS_CLASS = {
  OK: "status-ok",
  SUSPECT: "status-warn",
  AUTH_REQUIRED: "status-warn",
  NETWORK_ERROR: "status-warn",
  HTTP_ERROR: "status-warn",
  CONTRACT_MISMATCH: "status-error",
  NOT_CONFIGURED: "status-neutral",
};

const STATUS_LABEL = {
  OK: "OK",
  SUSPECT: "SUSPECT",
  AUTH_REQUIRED: "AUTH",
  NETWORK_ERROR: "NETWORK",
  HTTP_ERROR: "HTTP",
  CONTRACT_MISMATCH: "MISMATCH",
  NOT_CONFIGURED: "NOT CONFIGURED",
};

const PROVIDER_KEYS = ["chatgpt", "claude"];
const cards = Object.fromEntries(
  PROVIDER_KEYS.map((key) => [key, providerCard(key)]),
);
const overallStatusEl = document.querySelector("#overall-status");
const runAllButton = document.querySelector("#run-all");
const errorEl = document.querySelector("#error");

for (const key of PROVIDER_KEYS) {
  cards[key].saveButton.addEventListener("click", () => void saveProvider(key));
  cards[key].runButton.addEventListener("click", () => void runProvider(key));
}
runAllButton.addEventListener("click", () => void runAll());

void load();

function providerCard(key) {
  const root = document.querySelector(`[data-provider="${key}"]`);
  if (!root) throw new Error(`Missing popup card for ${key}`);
  return {
    root,
    input: root.querySelector(".conversation-url"),
    saveButton: root.querySelector(".save"),
    runButton: root.querySelector(".run"),
    status: root.querySelector(".provider-status"),
    checkedAt: root.querySelector(".checked-at"),
    summary: root.querySelector(".summary"),
    details: root.querySelector(".details"),
  };
}

async function load() {
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-state" });
    assertOk(response);
    for (const key of PROVIDER_KEYS) {
      cards[key].input.value = response.config?.[key]?.conversationUrl ?? "";
      renderProvider(key, response.state?.providers?.[key]);
    }
    renderOverall(response.state);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function saveProvider(provider) {
  clearError();
  setBusy(true);
  try {
    const response = await saveProviderConfig(provider);
    renderProvider(provider, response.state?.providers?.[provider]);
    renderOverall(response.state);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runProvider(provider) {
  clearError();
  setBusy(true);
  setRunning(provider);
  try {
    await saveProviderConfig(provider);
    const response = await chrome.runtime.sendMessage({ type: "run-now", provider });
    assertOk(response);
    renderProvider(provider, response.state?.providers?.[provider]);
    renderOverall(response.state);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runAll() {
  clearError();
  setBusy(true);
  for (const key of PROVIDER_KEYS) setRunning(key);

  try {
    for (const key of PROVIDER_KEYS) await saveProviderConfig(key);
    const response = await chrome.runtime.sendMessage({ type: "run-all" });
    assertOk(response);
    for (const key of PROVIDER_KEYS) {
      renderProvider(key, response.state?.providers?.[key]);
    }
    renderOverall(response.state);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function saveProviderConfig(provider) {
  const response = await chrome.runtime.sendMessage({
    type: "save-config",
    provider,
    conversationUrl: cards[provider].input.value,
  });
  assertOk(response);
  return response;
}

function setRunning(provider) {
  const card = cards[provider];
  card.status.textContent = "RUNNING";
  card.status.className = "provider-status status status-neutral";
  card.summary.textContent = `Running ${provider === "chatgpt" ? "ChatGPT" : "Claude"} contract probe…`;
  card.details.hidden = true;
}

function renderProvider(providerKey, provider) {
  const card = cards[providerKey];
  const status = provider?.status ?? "NOT_CONFIGURED";
  card.status.textContent = STATUS_LABEL[status] ?? status;
  card.status.className = `provider-status status ${STATUS_CLASS[status] ?? "status-neutral"}`;
  card.checkedAt.textContent = formatTime(provider?.checkedAt);
  card.summary.textContent = provider?.summary ?? "No result yet.";

  const diagnostic = {};
  if (provider?.observedStatus && provider.observedStatus !== status) {
    diagnostic.observedStatus = provider.observedStatus;
  }
  if (provider?.consecutiveContractFailures) {
    diagnostic.consecutiveContractFailures = provider.consecutiveContractFailures;
  }
  if (provider?.stats) diagnostic.stats = provider.stats;
  if (provider?.violations?.length) diagnostic.violations = provider.violations;
  if (provider?.topLevelKeys?.length) diagnostic.topLevelKeys = provider.topLevelKeys;

  if (Object.keys(diagnostic).length) {
    card.details.textContent = JSON.stringify(diagnostic, null, 2);
    card.details.hidden = false;
  } else {
    card.details.hidden = true;
  }
}

function renderOverall(state) {
  const statuses = PROVIDER_KEYS.map((key) => state?.providers?.[key]?.status ?? "NOT_CONFIGURED");
  let status = "NOT_CONFIGURED";

  if (statuses.includes("CONTRACT_MISMATCH")) {
    status = "CONTRACT_MISMATCH";
  } else if (statuses.some((item) => ["SUSPECT", "AUTH_REQUIRED", "NETWORK_ERROR", "HTTP_ERROR"].includes(item))) {
    status = "SUSPECT";
  } else if (statuses.includes("OK")) {
    status = "OK";
  }

  overallStatusEl.textContent = STATUS_LABEL[status] ?? status;
  overallStatusEl.className = `status ${STATUS_CLASS[status] ?? "status-neutral"}`;
}

function formatTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setBusy(busy) {
  for (const card of Object.values(cards)) {
    card.saveButton.disabled = busy;
    card.runButton.disabled = busy;
    card.input.disabled = busy;
  }
  runAllButton.disabled = busy;
}

function assertOk(response) {
  if (!response?.ok) throw new Error(response?.error || "Extension background returned an error.");
}

function showError(error) {
  errorEl.textContent = error instanceof Error ? error.message : String(error);
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}
