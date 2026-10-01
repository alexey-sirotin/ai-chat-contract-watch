import { describe, expect, it } from "vitest";
import { ActionIconState, actionIconStateForStatuses } from "../action-icon.js";

describe("actionIconStateForStatuses", () => {
  it("uses gray when there is no usable data", () => {
    expect(actionIconStateForStatuses([])).toBe(ActionIconState.NO_DATA);
    expect(actionIconStateForStatuses(["NOT_CONFIGURED", "NOT_CONFIGURED"]))
      .toBe(ActionIconState.NO_DATA);
  });

  it("uses green when at least one configured provider is healthy and none has a problem", () => {
    expect(actionIconStateForStatuses(["OK"]))
      .toBe(ActionIconState.OK);
    expect(actionIconStateForStatuses(["OK", "NOT_CONFIGURED", "NOT_CONFIGURED"]))
      .toBe(ActionIconState.OK);
  });

  it.each([
    "SUSPECT",
    "AUTH_REQUIRED",
    "NETWORK_ERROR",
    "HTTP_ERROR",
    "CONTRACT_MISMATCH",
  ])("uses red when any provider reports %s", (problemStatus) => {
    expect(actionIconStateForStatuses(["OK", problemStatus, "NOT_CONFIGURED"]))
      .toBe(ActionIconState.PROBLEM);
  });
});
