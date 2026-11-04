// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/panel/App";
import { ResumeView } from "../src/panel/components/ResumeView";
import { HistoryView } from "../src/panel/components/HistoryView";
import type { Checkpoint, Note, SummaryJob } from "../src/shared/contracts";

function note(id: string, body = ""): Note {
  return { id, revision: 0, title: id, body, createdAt: "2026-01-01", updatedAt: "2026-01-01", linkedCheckpointId: null };
}

function setup() {
  const records: Record<string, unknown> = {
    workspace: { openNoteIds: ["a"], activeNoteId: "a", selectedCheckpointId: null, aiEnabled: false, autoSummarize: false, backendUrl: "http://127.0.0.1:8001" },
    "note:a": note("a"),
  };
  let resolveUpdate: (() => void) | null = null;
  let rejectUpdate: (() => void) | null = null;
  const updateSent = vi.fn();
  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[] | null) => {
          if (keys === null) return { ...records };
          return Object.fromEntries(keys.filter((key) => key in records).map((key) => [key, records[key]]));
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      lastError: undefined,
      sendMessage: (message: { type: string; id?: string; title?: string; body?: string; fields?: Record<string, unknown> }, callback: (response: unknown) => void) => {
        if (message.type === "NOTE_UPDATE") {
          updateSent(message);
          resolveUpdate = () => {
            const old = records[`note:${message.id}`] as Note;
            const saved = { ...old, revision: old.revision + 1, title: message.title, body: message.body };
            records[`note:${message.id}`] = saved;
            callback({ ok: true, data: { note: saved } });
          };
          rejectUpdate = () => callback({ ok: false, error: { code: "REVISION_CONFLICT", message: "Conflict" } });
        } else if (message.type === "NOTE_CREATE") {
          const created = note("b");
          records["note:b"] = created;
          records.workspace = { ...(records.workspace as object), openNoteIds: ["a", "b"], activeNoteId: "b" };
          callback({ ok: true, data: { note: created } });
        } else if (message.type === "WORKSPACE_UPDATE") {
          records.workspace = { ...(records.workspace as object), ...message.fields };
          callback({ ok: true, data: { workspace: records.workspace } });
        } else {
          callback({ ok: false, error: { code: "UNEXPECTED", message: message.type } });
        }
      },
    },
  };
  vi.stubGlobal("chrome", chromeMock);
  return {
    records,
    updateSent,
    releaseSave: () => { if (!resolveUpdate) throw new Error("No save pending"); resolveUpdate(); },
    rejectSave: () => { if (!rejectUpdate) throw new Error("No save pending"); rejectUpdate(); },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("panel note switching", () => {
  it("waits for the originating note save before creating the next note", async () => {
    const { records, updateSent, releaseSave } = setup();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
    const editor = await screen.findByRole("textbox", { name: "Note body" });
    fireEvent.change(editor, { target: { value: "A's unsaved text" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Note" }));
    await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(1));
    expect((records.workspace as { activeNoteId: string }).activeNoteId).toBe("a");
    await act(async () => releaseSave());
    await waitFor(() => expect((records.workspace as { activeNoteId: string }).activeNoteId).toBe("b"));
    expect((records["note:a"] as Note).body).toBe("A's unsaved text");
    expect((records["note:b"] as Note).body).toBe("");
  });

  it("keeps newer typing and saves it with the revision returned by a delayed save", async () => {
    const { records, updateSent, releaseSave } = setup();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
    const editor = await screen.findByRole("textbox", { name: "Note body" });
    fireEvent.change(editor, { target: { value: "first" } });
    fireEvent.click(screen.getByText("a", { selector: "span[title='Double-click to rename']" }));
    await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(1));
    fireEvent.change(editor, { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Note" }));
    await act(async () => releaseSave());
    await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(2));
    expect(updateSent.mock.calls[1][0]).toMatchObject({ id: "a", body: "second", baseRevision: 1 });
    await act(async () => releaseSave());
    await waitFor(() => expect((records.workspace as { activeNoteId: string }).activeNoteId).toBe("b"));
    expect((records["note:a"] as Note).body).toBe("second");
  });

  it("stops a note switch on revision conflict until the user resolves it", async () => {
    const { records, updateSent, rejectSave } = setup();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Note body" }), { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Note" }));
    await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(1));
    await act(async () => rejectSave());
    expect((records.workspace as { activeNoteId: string }).activeNoteId).toBe("a");
    expect(records["note:b"]).toBeUndefined();
    expect(await screen.findByRole("button", { name: "Keep my draft" })).toBeTruthy();
  });
});

const checkpoint: Checkpoint = {
  id: "c", schemaVersion: 1, createdAt: "2026-01-01", taskKey: "task", title: "Task",
  url: "https://example.com", adapter: "generic", pageText: "page", selectedText: "",
  code: "partial", language: "python", quality: { code: "partial", missingFields: [], truncatedFields: [], warnings: [] },
};

it("offers full-code paste for a partial capture", () => {
  render(<ResumeView checkpoint={checkpoint} job={null} onSummarize={() => undefined} onCopyCode={() => undefined}
    onOpenSource={() => undefined} busy={false} aiEnabled={false} onAiEnabled={() => undefined}
    autoSummarize={false} onAutoSummarize={() => undefined} onPasteCode={async () => true} pasteError={null} />);
  expect(screen.getByText("Captured code is partial? Paste the full code")).toBeTruthy();
});

it("disables History retry while AI is disabled", () => {
  const failedJob: SummaryJob = {
    checkpointId: "c", requestId: "r", status: "failed", startedAt: "2026-01-01", inputHash: null,
    includedNoteSnapshots: [], result: null, error: { code: "HTTP_500", message: "Failed" }, warnings: [],
  };
  const retry = vi.fn();
  render(<HistoryView checkpoints={[checkpoint]} summaries={{ c: failedJob }} events={[]} selectedId="c"
    onSelect={() => undefined} onDelete={() => undefined} onRetry={retry} aiEnabled={false} />);
  const button = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(retry).not.toHaveBeenCalled();
});
