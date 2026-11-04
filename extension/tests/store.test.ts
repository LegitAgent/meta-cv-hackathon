import { describe, expect, it } from "vitest";
import {
  mergeSavedNote,
  resolveAdoptedDraft,
  shouldClaimSaved,
  shouldRetrySave,
} from "../src/panel/store";

// Locks the R1/R2 boundaries: pending text stays with its originating note,
// saves never clobber newer typing, conflicts never auto-retry, and "Saved"
// is claimed only with an empty outbox.
describe("note draft boundaries", () => {
  it("shows pending text only for its originating note", () => {
    const shown = resolveAdoptedDraft(
      { id: "b", title: "B", body: "saved-b", revision: 3 },
      { id: "a", title: "typed-a", body: "typed-a-body" },
    );
    expect(shown).toEqual({ id: "b", title: "B", body: "saved-b", baseRevision: 3 });
  });

  it("adopts the incoming revision for same-note pending text", () => {
    const shown = resolveAdoptedDraft(
      { id: "a", title: "saved", body: "saved-body", revision: 5 },
      { id: "a", title: "typed", body: "typed-body" },
    );
    expect(shown).toEqual({ id: "a", title: "typed", body: "typed-body", baseRevision: 5 });
  });

  it("keeps newer typing when a save lands underneath it", () => {
    const merged = mergeSavedNote(
      {
        id: "a",
        revision: 4,
        title: "t",
        body: "saved",
        createdAt: "",
        updatedAt: "",
        linkedCheckpointId: null,
        folderId: null,
      },
      { title: "typed", body: "typed-body" },
    );
    expect(merged).toEqual({ id: "a", title: "typed", body: "typed-body", baseRevision: 4 });
  });

  it("never auto-retries a revision conflict", () => {
    expect(shouldRetrySave(true, true)).toBe(false);
    expect(shouldRetrySave(false, true)).toBe(true);
    expect(shouldRetrySave(false, false)).toBe(false);
  });

  it("claims Saved only with an empty outbox", () => {
    expect(shouldClaimSaved(0)).toBe(true);
    expect(shouldClaimSaved(2)).toBe(false);
  });
});
