import { describe, expect, it } from "vitest";
import { renderPreview, toggleBullets, wrapInline } from "../src/panel/components/noteFormat";

describe("wrapInline", () => {
  it("wraps a range and keeps the selection on the text", () => {
    expect(wrapInline("hello world", { start: 6, end: 11 }, "**")).toEqual({
      body: "hello **world**",
      selection: { start: 8, end: 13 },
    });
  });
  it("inserts an empty marker pair at a cursor", () => {
    expect(wrapInline("hi", { start: 2, end: 2 }, "*")).toEqual({
      body: "hi**",
      selection: { start: 3, end: 3 },
    });
  });
});

describe("toggleBullets", () => {
  it("prefixes the touched lines", () => {
    expect(toggleBullets("a\nb", { start: 0, end: 3 })).toEqual({
      body: "- a\n- b",
      selection: { start: 2, end: 7 },
    });
  });
  it("removes bullets when the whole selection has them", () => {
    expect(toggleBullets("- a\n- b", { start: 0, end: 7 })).toEqual({
      body: "a\nb",
      selection: { start: 0, end: 3 },
    });
  });
  it("bullets the current line on a collapsed cursor", () => {
    expect(toggleBullets("a\nb", { start: 3, end: 3 })).toEqual({
      body: "a\n- b",
      selection: { start: 5, end: 5 },
    });
  });
});

describe("renderPreview", () => {
  it("renders bold, italic, and lists without raw HTML", () => {
    expect(renderPreview("**bold** and *em*\n- one\n- two\n<script>x</script>")).toBe(
      "<p><strong>bold</strong> and <em>em</em></p><ul><li>one</li><li>two</li></ul><p>&lt;script&gt;x&lt;/script&gt;</p>",
    );
  });
  it("renders nothing for blank input", () => {
    expect(renderPreview("  \n ")).toBe("");
  });
});
