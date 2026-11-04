// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { expandNoteSelection } from "../src/panel/store";
import type { Note } from "../src/shared/contracts";

function note(id: string, folderId: string | null): Note {
  return { id, revision: 0, title: id, body: "b", createdAt: "t", updatedAt: "t", linkedCheckpointId: null, folderId };
}

describe("expandNoteSelection", () => {
  it("unions direct picks with folder contents without duplicates", () => {
    const notes = [note("a", "f1"), note("b", "f1"), note("c", null)];
    expect(expandNoteSelection(notes, ["a", "c"], ["f1"]).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores unknown folders and keeps unknown ids for the worker to report", () => {
    expect(expandNoteSelection([note("a", "f1")], ["ghost"], ["nope"])).toEqual(["ghost"]);
  });

  it("resolves against live folder membership at send time", () => {
    expect(expandNoteSelection([note("a", null)], [], ["f1"])).toEqual([]);
    expect(expandNoteSelection([note("a", "f1")], [], ["f1"])).toEqual(["a"]);
  });
});
