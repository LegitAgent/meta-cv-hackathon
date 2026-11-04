// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toggleFolderMembers } from "../src/panel/store";

describe("toggleFolderMembers", () => {
  it("checks every folder member without duplicates", () => {
    expect(toggleFolderMembers(["a"], ["a", "b"], true).sort()).toEqual(["a", "b"]);
  });

  it("clears only folder members, keeping other picks", () => {
    expect(toggleFolderMembers(["a", "b", "c"], ["b"], false)).toEqual(["a", "c"]);
  });

  it("is a no-op for an empty folder", () => {
    expect(toggleFolderMembers(["a"], [], true)).toEqual(["a"]);
    expect(toggleFolderMembers(["a"], [], false)).toEqual(["a"]);
  });
});
