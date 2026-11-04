// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteTabs } from "../src/panel/components/NoteTabs";
import type { Note } from "../src/shared/contracts";

afterEach(() => cleanup());

function note(): Note {
  return { id: "a", revision: 0, title: "a", body: "Hello world", createdAt: "2026-01-01", updatedAt: "2026-01-01", linkedCheckpointId: null };
}

it("reads the open note aloud with the browser speech engine", () => {
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak, cancel, getVoices: () => [] });
  try {
    render(
      <NoteTabs
        notes={[note()]}
        openNoteIds={["a"]}
        activeNoteId="a"
        onSelect={() => undefined}
        onCreate={() => undefined}
        onClose={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
        draft={{ title: "a", body: "Hello world" }}
        onDraftChange={() => undefined}
        saveState="saved"
        conflictNote={null}
        onResolveConflict={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play note aloud" }));
    expect(speak).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(cancel).toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
