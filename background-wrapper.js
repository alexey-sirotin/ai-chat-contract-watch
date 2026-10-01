import "./background.js";
import { refreshActionIconFromStorage } from "./action-icon.js";

let refreshTimer = null;

function scheduleIconRefresh(delayMs = 50) {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshActionIconFromStorage();
  }, delayMs);
}

chrome.runtime.onInstalled.addListener(() => scheduleIconRefresh());
chrome.runtime.onStartup.addListener(() => scheduleIconRefresh());
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.state) scheduleIconRefresh();
});

scheduleIconRefresh(0);
