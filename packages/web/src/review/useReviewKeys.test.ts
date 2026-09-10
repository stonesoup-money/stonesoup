import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReviewKeys } from "./useReviewKeys.js";

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function buildHandlers() {
  return {
    enabled: true,
    onConfirm: vi.fn(),
    onOpenPicker: vi.fn(),
    onCorrectToIndex: vi.fn(),
    onMore: vi.fn(),
    onSkip: vi.fn(),
  };
}

describe("useReviewKeys — one binding table (AGENTS.md, Design language)", () => {
  it("Y confirms, N opens the picker, M is more, S skips", () => {
    const handlers = buildHandlers();
    renderHook(() => useReviewKeys(handlers));

    press("y");
    press("n");
    press("m");
    press("s");

    expect(handlers.onConfirm).toHaveBeenCalledOnce();
    expect(handlers.onOpenPicker).toHaveBeenCalledOnce();
    expect(handlers.onMore).toHaveBeenCalledOnce();
    expect(handlers.onSkip).toHaveBeenCalledOnce();
  });

  it("is case-insensitive", () => {
    const handlers = buildHandlers();
    renderHook(() => useReviewKeys(handlers));
    press("Y");
    expect(handlers.onConfirm).toHaveBeenCalledOnce();
  });

  it("digits 1-9 map to 0-based indices", () => {
    const handlers = buildHandlers();
    renderHook(() => useReviewKeys(handlers));
    press("1");
    press("9");
    expect(handlers.onCorrectToIndex).toHaveBeenNthCalledWith(1, 0);
    expect(handlers.onCorrectToIndex).toHaveBeenNthCalledWith(2, 8);
  });

  it("ignores 0 and does nothing for it", () => {
    const handlers = buildHandlers();
    renderHook(() => useReviewKeys(handlers));
    press("0");
    expect(handlers.onCorrectToIndex).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const handlers = { ...buildHandlers(), enabled: false };
    renderHook(() => useReviewKeys(handlers));
    press("y");
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it("ignores a keypress with a modifier held", () => {
    const handlers = buildHandlers();
    renderHook(() => useReviewKeys(handlers));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", metaKey: true }));
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });
});
