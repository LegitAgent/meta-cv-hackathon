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

function setup(opts: { signedIn?: boolean } = {}) {
  const records: Record<string, unknown> = {
    workspace: { openNoteIds: ["a"], activeNoteId: "a", selectedCheckpointId: null, aiEnabled: false, autoSummarize: false, backendUrl: "http://127.0.0.1:8001" },
    "note:a": note("a"),
  };
  let resolveUpdate: (() => void) | null = null;
  let rejectUpdate: (() => void) | null = null;
  const updateSent = vi.fn();
  const captures: unknown[] = [];
  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[] | null) => {
          if (keys === null) return { ...records };
          return Object.fromEntries(keys.filter((key) => key in records).map((key) => [key, records[key]]));
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      session: {
        get: vi.fn(async () => (opts.signedIn ? { backendCredential: { origin: "https://backtrack.martinalba.dev", token: "test-token", email: "test@gmail.com", expiresAt: Date.now() + 3600000 } } : {})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
    runtime: {
      lastError: undefined,
      sendMessage: (message: { type: string; id?: string; title?: string; body?: string; stuckPoint?: string; fields?: Record<string, unknown> }, callback: (response: unknown) => void) => {
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
        } else if (message.type === "NOTE_DELETE") {
          delete records[`note:${message.id}`];
          const ws = records.workspace as { openNoteIds: string[]; activeNoteId: string | null };
          const open = ws.openNoteIds.filter((id) => id !== message.id);
          records.workspace = { ...ws, openNoteIds: open, activeNoteId: ws.activeNoteId === message.id ? (open[open.length - 1] ?? null) : ws.activeNoteId };
          callback({ ok: true, data: { deleted: true } });
        } else if (message.type === "CAPTURE") {
          captures.push(message);
          const cp = {
            id: "p1", schemaVersion: 1, createdAt: "2026-02-01", taskKey: "example.com/page",
            title: "Saved page", url: "https://example.com/page", adapter: "generic",
            pageText: "page", selectedText: "", code: null, language: null,
            quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
          };
          records["checkpoint:p1"] = cp;
          records["meta:lastCapture"] = { ok: true, at: "2026-02-01", checkpointId: "p1", code: null, message: null };
          records.workspace = { ...(records.workspace as object), selectedCheckpointId: "p1" };
          callback({ ok: true, data: { checkpoint: cp } });
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
    captures,
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
    const { records, updateSent, releaseSave } = setup({ signedIn: true });
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
    const { records, updateSent, releaseSave } = setup({ signedIn: true });
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
    const { records, updateSent, rejectSave, releaseSave } = setup({ signedIn: true });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Note body" }), { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Note" }));
    await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(1));
    records["note:a"] = { ...(records["note:a"] as Note), revision: 1, body: "other panel" };
    await act(async () => rejectSave());
    expect((records.workspace as { activeNoteId: string }).activeNoteId).toBe("a");
    expect(records["note:b"]).toBeUndefined();
    fireEvent.click(await screen.findByRole("button", { name: "Keep my draft" }));
    await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(2));
    expect(updateSent.mock.calls[1][0]).toMatchObject({ id: "a", baseRevision: 1, body: "my draft" });
    await act(async () => releaseSave());
    await waitFor(() => expect((records["note:a"] as Note).body).toBe("my draft"));
  });
});

it("flushes pending typing before renaming the note", async () => {
  const { records, updateSent, releaseSave } = setup({ signedIn: true });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Note body" }), { target: { value: "typed body" } });
  fireEvent.doubleClick(screen.getByText("a", { selector: "span[title='Double-click to rename']" }));
  const renameInput = document.querySelector(".tab.active input");
  expect(renameInput).toBeTruthy();
  fireEvent.change(renameInput as HTMLInputElement, { target: { value: "renamed" } });
  fireEvent.keyDown(renameInput as HTMLInputElement, { key: "Enter", code: "Enter", charCode: 13 });
  await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(1));
  await act(async () => releaseSave());
  await waitFor(() => expect(updateSent).toHaveBeenCalledTimes(2));
  expect(updateSent.mock.calls[0][0]).toMatchObject({ id: "a", body: "typed body", baseRevision: 0 });
  expect(updateSent.mock.calls[1][0]).toMatchObject({ id: "a", title: "renamed", body: "typed body", baseRevision: 1 });
  await act(async () => releaseSave());
  await waitFor(() => expect((records["note:a"] as Note).title).toBe("renamed"));
  expect((records["note:a"] as Note).body).toBe("typed body");
});

it("filters the recap note list and bulk-selects only the visible notes", async () => {
  const { records } = setup({ signedIn: true });
  records["note:alpha"] = { ...note("alpha"), title: "alpha plan" };
  records["note:beta"] = { ...note("beta"), title: "beta scratch" };
  render(<App />);
  const filter = await screen.findByRole("textbox", { name: "Filter notes to include" });
  const boxes = () => Array.from(document.querySelectorAll(".notes-include .check input"));
  const checked = () => boxes().filter((b) => (b as HTMLInputElement).checked);
  expect(boxes()).toHaveLength(3);
  fireEvent.change(filter, { target: { value: "alpha" } });
  expect(boxes()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(checked()).toHaveLength(1);
  fireEvent.change(filter, { target: { value: "beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  fireEvent.change(filter, { target: { value: "" } });
  expect(boxes()).toHaveLength(3);
  expect(checked()).toHaveLength(2);
  fireEvent.change(filter, { target: { value: "beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  fireEvent.change(filter, { target: { value: "" } });
  expect(checked()).toHaveLength(1);
});

it("deleting a note drops its pending autosave instead of retrying it", async () => {
  const { records, updateSent } = setup({ signedIn: true });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Note body" }), { target: { value: "doomed draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await waitFor(() => expect(records["note:a"]).toBeUndefined());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  expect(updateSent).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "Note body" })).toBeNull();
});

it("keeping a note delete confirmation leaves the note alone", async () => {
  const { records } = setup({ signedIn: true });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
  expect(records["note:a"]).toBeDefined();
  expect(screen.queryByRole("button", { name: "Delete note" })).not.toBeNull();
});

it("sends the stuck point with an explicit capture", async () => {
  const { captures } = setup({ signedIn: true });
  render(<App />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Where are you stuck? (optional)" }), {
    target: { value: "loop logic" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save this page" }));
  await waitFor(() => expect(captures).toHaveLength(1));
  expect(captures[0]).toMatchObject({ type: "CAPTURE", stuckPoint: "loop logic" });
  expect((screen.getByRole("textbox", { name: "Where are you stuck? (optional)" }) as HTMLInputElement).value).toBe("");
});

const checkpoint: Checkpoint = {
  id: "c", schemaVersion: 1, createdAt: "2026-01-01", taskKey: "task", title: "Task",
  url: "https://example.com", adapter: "generic", pageText: "page", selectedText: "",
  code: "partial", language: "python", screenshot: null, stuckPoint: null, quality: { code: "partial", missingFields: [], truncatedFields: [], warnings: [] },
};

it("offers full-code paste for a partial capture", () => {
  render(<ResumeView checkpoint={checkpoint} job={null} related={[]} onCapture={() => undefined} capturing={false}
    onSummarize={() => undefined} onCopyCode={() => undefined}
    onOpenSource={() => undefined} onOpenCheckpoint={() => undefined} busy={false}
    autoSummarize={false} onAutoSummarize={() => undefined} onPasteCode={async () => true} pasteError={null} />);
  expect(screen.getByText("Captured code is partial? Paste the full code")).toBeTruthy();
});

it("shows only the sign-in page until signed in", async () => {
  setup();
  render(<App />);
  expect(await screen.findByText("Leave your work. Keep your place.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Notes" })).toBeNull();
});

it("opens the guide and closes it again", async () => {
  setup({ signedIn: true });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Wiki" }));
  expect(await screen.findByText("Backtrack guide")).toBeTruthy();
  expect(screen.getByText("Press Save this page to capture the current tab as a checkpoint. Optionally type where you are stuck first; it is stored with the checkpoint so the recap knows what you were wrestling with. Saving captures the page text, your selected text, editor code when it can be read, and a small screenshot.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close guide" }));
  await waitFor(() => expect(screen.queryByText("Backtrack guide")).toBeNull());
});

it("shows the recap button once signed in", async () => {
  const { records } = setup();
  records["checkpoint:c"] = { ...checkpoint };
  records["summary:c"] = {
    checkpointId: "c", requestId: null, status: "idle", startedAt: null,
    includedNoteSnapshots: [], result: null, error: null, warnings: [],
  };
  records.workspace = { ...(records.workspace as object), selectedCheckpointId: "c" };
  const sessionStore: Record<string, unknown> = {
    backendCredential: {
      origin: "https://backtrack.martinalba.dev",
      token: "id-token",
      email: "person@gmail.com",
      expiresAt: Date.now() + 3600000,
    },
  };
  const storage = (globalThis as unknown as { chrome: { storage: { session: { get: (k: string) => Promise<unknown> } } } }).chrome.storage;
  const session = { get: async (key: string) => ({ [key]: sessionStore[key] }) };
  Object.assign(storage, { session });
  render(<App />);
  expect(await screen.findByRole("button", { name: "Generate recap" })).toBeTruthy();
});

it("captures the current tab from the in-panel button", async () => {
  setup({ signedIn: true });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Save this page" }));
  expect(await screen.findByText("Saved page")).toBeTruthy();
});

it("shows saved state with a save-again action when a checkpoint exists", async () => {
  const { records } = setup({ signedIn: true });
  records["checkpoint:c"] = { ...checkpoint };
  records["summary:c"] = {
    checkpointId: "c", requestId: null, status: "idle", startedAt: null,
    includedNoteSnapshots: [], result: null, error: null, warnings: [],
  };
  records.workspace = { ...(records.workspace as object), selectedCheckpointId: "c" };
  render(<App />);
  expect(await screen.findByText("Saved ✓")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save again" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save this page" })).toBeNull();
});

it("disables History retry while AI is disabled", () => {
  const failedJob: SummaryJob = {
    checkpointId: "c", requestId: "r", status: "failed", startedAt: "2026-01-01",
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
