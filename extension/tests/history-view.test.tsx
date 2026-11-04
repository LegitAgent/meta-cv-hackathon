// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryView } from "../src/panel/components/HistoryView";
import type { Checkpoint } from "../src/shared/contracts";

function checkpoint(id: string, title: string, createdAt: string): Checkpoint {
  return {
    id, schemaVersion: 1, createdAt, taskKey: "task", title,
    url: `https://example.com/${id}`, adapter: "generic", pageText: "page", selectedText: "",
    code: null, language: null, screenshot: null, quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
  };
}

afterEach(() => cleanup());

it("filters checkpoints by text without a native confirm", () => {
  const confirm = vi.spyOn(window, "confirm");
  render(
    <HistoryView
      checkpoints={[checkpoint("a", "Alpha page", "2026-01-01"), checkpoint("b", "Beta page", "2026-01-02")]}
      summaries={{}}
      events={[]}
      selectedId={null}
      onSelect={() => undefined}
      onDelete={() => undefined}
      onRetry={() => undefined}
      aiEnabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("Filter checkpoints"), { target: { value: "beta" } });
  expect(screen.queryByText("Alpha page")).toBeNull();
  expect(screen.getByText("Beta page")).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
});

it("sorts oldest first and confirms a single trash inline", () => {
  const onDelete = vi.fn();
  render(
    <HistoryView
      checkpoints={[checkpoint("a", "Alpha", "2026-01-02"), checkpoint("b", "Beta", "2026-01-01")]}
      summaries={{}}
      events={[]}
      selectedId={null}
      onSelect={() => undefined}
      onDelete={onDelete}
      onRetry={() => undefined}
      aiEnabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("Sort checkpoints"), { target: { value: "oldest" } });
  const rows = Array.from(document.querySelectorAll("ul.history li")).map((li) => li.textContent ?? "");
  expect(rows.length).toBe(2);
  expect(rows[0]).toContain("Beta");
  expect(rows[1]).toContain("Alpha");
  fireEvent.click(screen.getAllByRole("button", { name: "Trash" })[0]);
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onDelete).toHaveBeenCalledWith("b");
});

it("trashes several checkpoints at once", () => {
  const onDeleteMany = vi.fn();
  render(
    <HistoryView
      checkpoints={[checkpoint("a", "Alpha", "2026-01-01"), checkpoint("b", "Beta", "2026-01-02")]}
      summaries={{}}
      events={[]}
      selectedId={null}
      onSelect={() => undefined}
      onDelete={() => undefined}
      onDeleteMany={onDeleteMany}
      onRetry={() => undefined}
      aiEnabled={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Select shown" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash selected (2)" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onDeleteMany).toHaveBeenCalledWith(["b", "a"]);
});
