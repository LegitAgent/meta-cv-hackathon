import { describe, expect, it } from "vitest";
import { buildGenericOutcome } from "../src/capture/generic";
import { buildLeetCodeOutcome, extractLeetCodeProblem, isLeetCodeProblemUrl } from "../src/capture/leetcode";
import { cleanUrl, taskKeyForUrl } from "../src/capture/types";
import { genericPage, missingMain, longEditor } from "./fixtures/pages";
import { leetCodeDom } from "./fixtures/leetcode";

function fakeDoc(html: { problem: string | null; lines: string[] }) {
  return {
    querySelector: (sel: string) => {
      if (sel.includes("description") || sel.includes("elfjS") || sel.includes("question-content")) {
        return html.problem ? { textContent: html.problem } : null;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes("view-line")) return html.lines.map((t) => ({ textContent: t }));
      return [];
    },
  };
}

describe("capture adapters", () => {
  it("extracts a generic page within bounds", () => {
    const out = buildGenericOutcome(genericPage());
    expect(out.quality.code).toBe("complete");
    expect(out.pageText).toContain("task content");
  });

  it("flags missing main content", () => {
    const out = buildGenericOutcome(missingMain());
    expect(out.quality.code).toBe("unavailable");
    expect(out.quality.missingFields).toContain("pageText");
  });

  it("caps long editor code and marks truncation", () => {
    const out = buildGenericOutcome(longEditor());
    expect(out.code?.length).toBeLessThanOrEqual(30000);
    expect(out.quality.truncatedFields).toContain("code");
  });

  it("detects approved LeetCode URLs only", () => {
    expect(isLeetCodeProblemUrl("https://leetcode.com/problems/two-sum/")).toBe(true);
    expect(isLeetCodeProblemUrl("https://www.leetcode.com/problems/two-sum/")).toBe(true);
    expect(isLeetCodeProblemUrl("https://leetcode.cn/problems/two-sum/")).toBe(true);
    expect(isLeetCodeProblemUrl("https://leetcode.com/contest/weekly/")).toBe(false);
    expect(isLeetCodeProblemUrl("https://example.com/problems/two-sum/")).toBe(false);
  });

  it("labels virtualized DOM editor lines partial", () => {
    const { problemText, code, codePartial } = extractLeetCodeProblem(fakeDoc(leetCodeDom()));
    expect(problemText).toContain("Two Sum");
    expect(code).toContain("def twoSum");
    expect(codePartial).toBe(true);
    const out = buildLeetCodeOutcome({
      title: "Two Sum",
      url: "https://leetcode.com/problems/two-sum/",
      selectedText: "",
      pageText: problemText ?? "",
      pageTextFromProblem: problemText,
      code,
      language: "python",
      codePartial,
      missingFields: [],
      truncatedFields: [],
      warnings: [],
    });
    expect(out.quality.code).toBe("partial");
    expect(out.quality.warnings.join(" ")).toMatch(/virtualized/i);
  });

  it("reports every missing field and skips the virtualized warning when nothing was read", () => {
    const out = buildLeetCodeOutcome({
      title: "Two Sum",
      url: "https://leetcode.com/problems/two-sum/",
      selectedText: "",
      pageText: "",
      pageTextFromProblem: null,
      code: null,
      language: null,
      codePartial: true,
      missingFields: [],
      truncatedFields: [],
      warnings: [],
    });
    expect(out.quality.missingFields).toContain("problemStatement");
    expect(out.quality.missingFields).toContain("code");
    expect(out.quality.warnings.join(" ")).not.toMatch(/virtualized/i);
  });

  it("navigation mismatch is detectable via task keys", () => {
    expect(taskKeyForUrl("https://a.com/p/1?x=1#y")).toBe(taskKeyForUrl("https://a.com/p/1"));
    expect(taskKeyForUrl("https://a.com/p/1")).not.toBe(taskKeyForUrl("https://a.com/p/2"));
  });

  it("strips query strings and fragments from persisted URLs", () => {
    expect(cleanUrl("https://a.com/p/1?token=secret#frag")).toBe("https://a.com/p/1");
  });
});
