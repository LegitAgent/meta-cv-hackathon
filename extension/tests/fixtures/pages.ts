import type { RawPageExtraction } from "../../src/capture/types";

export function genericPage(): RawPageExtraction {
  return {
    title: "Example task",
    url: "https://example.com/task",
    selectedText: "key line",
    pageText: "task content with steps",
    code: null,
    language: null,
    missingFields: [],
    truncatedFields: [],
    warnings: [],
  };
}

export function missingMain(): RawPageExtraction {
  return {
    title: "",
    url: "https://example.com/empty",
    selectedText: "",
    pageText: "",
    code: null,
    language: null,
    missingFields: ["pageText"],
    truncatedFields: [],
    warnings: [],
  };
}

export function longEditor(): RawPageExtraction {
  return {
    title: "Long editor",
    url: "https://example.com/editor",
    selectedText: "",
    pageText: "some context",
    code: "x = 1\n".repeat(20000),
    language: "python",
    missingFields: [],
    truncatedFields: [],
    warnings: [],
  };
}
