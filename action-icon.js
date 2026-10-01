export const ActionIconState = Object.freeze({
  NO_DATA: "no-data",
  OK: "ok",
  PROBLEM: "problem",
});

const ACTION_ICON_COLORS = Object.freeze({
  [ActionIconState.NO_DATA]: "#6b7280",
  [ActionIconState.OK]: "#198754",
  [ActionIconState.PROBLEM]: "#c62828",
});

const PROBLEM_STATUSES = new Set([
  "SUSPECT",
  "AUTH_REQUIRED",
  "NETWORK_ERROR",
  "HTTP_ERROR",
  "CONTRACT_MISMATCH",
]);

export function actionIconStateForStatuses(statuses) {
  const values = Array.from(statuses || []);
  if (values.some((status) => PROBLEM_STATUSES.has(status))) {
    return ActionIconState.PROBLEM;
  }
  if (values.includes("OK")) return ActionIconState.OK;
  return ActionIconState.NO_DATA;
}

export function drawActionIcon(size, iconState) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create action icon canvas context.");

  const color = ACTION_ICON_COLORS[iconState] || ACTION_ICON_COLORS[ActionIconState.NO_DATA];
  context.clearRect(0, 0, size, size);
  context.fillStyle = color;
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ffffff";
  drawPolygon(context, size, [
    [0.22, 0.75],
    [0.35, 0.25],
    [0.43, 0.25],
    [0.34, 0.75],
  ]);
  drawPolygon(context, size, [
    [0.35, 0.25],
    [0.43, 0.25],
    [0.57, 0.75],
    [0.46, 0.75],
  ]);
  drawPolygon(context, size, [
    [0.31, 0.54],
    [0.50, 0.54],
    [0.515, 0.60],
    [0.295, 0.60],
  ]);
  context.fillRect(size * 0.65, size * 0.25, size * 0.09, size * 0.50);

  return context.getImageData(0, 0, size, size);
}

export async function applyActionIconForStatuses(statuses) {
  const iconState = actionIconStateForStatuses(statuses);
  await chrome.action.setIcon({
    imageData: {
      16: drawActionIcon(16, iconState),
      32: drawActionIcon(32, iconState),
    },
  });
  await chrome.action.setBadgeText({ text: "" });
  return iconState;
}

export async function refreshActionIconFromStorage() {
  const { state } = await chrome.storage.local.get("state");
  const statuses = Object.values(state?.providers ?? {}).map((provider) => provider?.status);
  return applyActionIconForStatuses(statuses);
}

function drawPolygon(context, size, points) {
  context.beginPath();
  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    if (index === 0) context.moveTo(x * size, y * size);
    else context.lineTo(x * size, y * size);
  }
  context.closePath();
  context.fill();
}
