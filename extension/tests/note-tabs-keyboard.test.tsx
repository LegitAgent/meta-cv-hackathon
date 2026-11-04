// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoteTabs } from "../src/panel/components/NoteTabs";
import type { Note } from "../src/shared/contracts";

afterEach(() => cleanup());

function note(): Note {
  return { id: "a", revision: 0, title: "Shopping", body: "Milk", createdAt: "2026-01-01", updatedAt: "2026-01-01", linkedCheckpointId: null, folderId: null };
}

function folderProps() {
  return {
    folders: [],
    onCreateFolder: () => undefined,
    onRenameFolder: () => undefined,
    onDeleteFolder: () => undefined,
    onMoveNote: () => undefined,
  };
}

it("selects with Enter and opens rename with F2 from the keyboard", () => {
  const onSelect = vi.fn();
  render(
    <NoteTabs
      notes={[note()]}
      {...folderProps()}
      openNoteIds={["a"]}
      activeNoteId="a"
      onSelect={onSelect}
      onCreate={() => undefined}
      onClose={() => undefined}
      onDelete={() => undefined}
      onRename={vi.fn()}
      draft={{ title: "Shopping", body: "Milk" }}
      onDraftChange={() => undefined}
      saveState="saved"
      conflictNote={null}
      onResolveConflict={() => undefined}
    />,
  );
  const title = screen.getByText("Shopping", { selector: "span[title='Double-click to rename']" });
  fireEvent.keyDown(title, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith("a");
  fireEvent.keyDown(title, { key: "F2" });
  expect(screen.getAllByDisplayValue("Shopping")).toHaveLength(2);
});
