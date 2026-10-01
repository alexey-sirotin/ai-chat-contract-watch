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

const urlInput = document.querySelector("#conversation-url");
const saveButton = document.querySelector("#save");
const runButton = document.querySelector("#run");
const statusEl = document.querySelector("#status");
const checkedAtEl = document.querySelector("#checked-at");
const summaryEl = document.querySelector("#summary");
const detailsEl = document.querySelector("#details");
const errorEl = document.querySelector("#error");

saveButton.addEventListener("click", () => void saveConfig());
runButton.addEventListener("click", () => void runNow());

void load();

async function load() {
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-state" });
    assertOk(response);
    urlInput.value = response.config?.chatgpt?.conversationUrl ?? "";
    render(response.state?.providers?.chatgpt);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function saveConfig() {
  clearError();
  setBusy(true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "save-config",
      conversationUrl: urlInput.value,
    });
    assertOk(response);
    render(response.state?.providers?.chatgpt);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runNow() {
  clearError();
  setBusy(true);
  statusEl.textContent = "RUNNING";
  statusEl.className = "status status-neutral";
  summaryEl.textContent = "Running ChatGPT contract probe…";
  detailsEl.hidden = true;

  try {
    const saveResponse = await chrome.runtime.sendMessage({
      type: "save-config",
      conversationUrl: urlInput.value,
    });
    assertOk(saveResponse);

    const response = await chrome.runtime.sendMessage({ type: "run-now" });
    assertOk(response);
    render(response.state?.providers?.chatgpt);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function render(provider) {
  const status = provider?.status ?? "NOT_CONFIGURED";
  statusEl.textContent = STATUS_LABEL[status] ?? status;
  statusEl.className = `status ${STATUS_CLASS[status] ?? "status-neutral"}`;
  checkedAtEl.textContent = formatTime(provider?.checkedAt);
  summaryEl.textContent = provider?.summary ?? "No result yet.";

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
    detailsEl.textContent = JSON.stringify(diagnostic, null, 2);
    detailsEl.hidden = false;
  } else {
    detailsEl.hidden = true;
  }
}

function formatTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function setBusy(busy) {
  saveButton.disabled = busy;
  runButton.disabled = busy;
  urlInput.disabled = busy;
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
