// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteTabs } from "../src/panel/components/NoteTabs";
import type { Note } from "../src/shared/contracts";

afterEach(() => cleanup());

function note(): Note {
  return { id: "a", revision: 0, title: "a", body: "Hello", createdAt: "2026-01-01", updatedAt: "2026-01-01", linkedCheckpointId: null, folderId: null };
}

function renderEditor(onDraftChange: (d: { title: string; body: string }) => void) {
  render(
    <NoteTabs
      notes={[note()]}
      folders={[]}
      openNoteIds={["a"]}
      activeNoteId="a"
      onSelect={() => undefined}
      onCreate={() => undefined}
      onClose={() => undefined}
      onDelete={() => undefined}
      onRename={() => undefined}
      onCreateFolder={() => undefined}
      onRenameFolder={() => undefined}
      onDeleteFolder={() => undefined}
      onMoveNote={() => undefined}
      draft={{ title: "a", body: "Hello" }}
      onDraftChange={onDraftChange}
      saveState="saved"
      conflictNote={null}
      onResolveConflict={() => undefined}
    />,
  );
}

it("dictates speech into the open note at the cursor", () => {
  type ResultEvent = { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> };
  const instances: Array<{
    start: () => void; stop: () => void;
    onresult: ((event: ResultEvent) => void) | null;
  }> = [];
  class MockRecognition {
    onresult: ((event: ResultEvent) => void) | null = null;
    start = vi.fn(() => undefined);
    stop = vi.fn(() => undefined);
    constructor() { instances.push(this); }
  }
  vi.stubGlobal("webkitSpeechRecognition", MockRecognition);
  // The component reads the constructor off window, not globalThis.
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = MockRecognition;
  const onDraftChange = vi.fn();
  try {
    renderEditor(onDraftChange);
    fireEvent.click(screen.getByRole("button", { name: "Dictate note" }));
    expect(instances).toHaveLength(1);
    instances[0].onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: " world" } }] });
    expect(onDraftChange).toHaveBeenCalledWith({ title: "a", body: "Hello world" });
    fireEvent.click(screen.getByRole("button", { name: "Stop dictation" }));
    expect(instances[0].stop).toHaveBeenCalled();
  } finally {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    vi.unstubAllGlobals();
  }
});

it("hides dictation when the browser has no speech recognition", () => {
  renderEditor(() => undefined);
  expect(screen.queryByRole("button", { name: "Dictate note" })).toBeNull();
});
