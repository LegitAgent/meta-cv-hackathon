// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SummaryCard } from "../src/panel/components/ResumeView";
import type { SummaryJob } from "../src/shared/contracts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function job(): SummaryJob {
  return {
    checkpointId: "c", requestId: "r", status: "complete", startedAt: "2026-01-01",
    includedNoteSnapshots: [],
    result: {
      recap: "Saved attempt", observedFacts: [], possibleBlocker: null,
      nextAction: "Trace one input", uncertainties: [],
    },
    error: null, warnings: [],
  };
}

it("copies the recap and flashes green, then fades", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<SummaryCard job={job()} />);
  const button = screen.getByRole("button", { name: "Copy Recap" });
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toContain("Saved attempt");
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Copied" }).className).toContain("copied");
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  expect(screen.getByRole("button", { name: "Copy Recap" }).className).not.toContain("copied");
});

it("surfaces a hint when the clipboard write fails", async () => {
  const writeText = vi.fn(async (_text: string) => { throw new Error("denied"); });
  Object.assign(navigator, { clipboard: { writeText } });
  render(<SummaryCard job={job()} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy Recap" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Copy failed");
});
