// LeetCode site adapter. Selectors are isolated in LEETCODE_SELECTORS and
// tested against fixtures. Code extraction is best-effort: virtualized
// editor lines are labeled partial unless completeness is proven, and
// problem examples are never treated as user code.

import { CODE_MAX, cap, type ExtractionOutcome, type RawPageExtraction } from "./types";

export const LEETCODE_SELECTORS = {
  problemContainer: [
    '[data-track-load="description_content"]',
    ".elfjS",
    ".question-content",
    '[class*="description"]',
  ],
  editorLines: [".view-lines .view-line", ".monaco-editor .view-line"],
  editorRoot: [".monaco-editor", '[data-testid="code-editor"]', ".react-monaco-editor-container"],
  languageLabel: ['[data-testid="language-select"]', ".ant-select-selection-item", '[class*="language"]'],
} as const;

const PROBLEM_URL_RE = /^https:\/\/leetcode\.com\/problems\/[^/]+\/?/;

export function isLeetCodeProblemUrl(url: string): boolean {
  return PROBLEM_URL_RE.test(url);
}

export interface MinimalDoc {
  querySelector(sel: string): { textContent?: string | null; innerText?: string } | null;
  querySelectorAll(sel: string): ArrayLike<{ textContent?: string | null }>;
}

function pickText(doc: MinimalDoc, selectors: readonly string[]): string | null {
  for (const sel of selectors) {
    try {
      const el = doc.querySelector(sel);
      const t = (el?.textContent ?? "").trim();
      if (t) return t;
    } catch {
      continue;
    }
  }
  return null;
}

/** Pure extraction over a minimal DOM surface; unit-tested with fixtures. */
export function extractLeetCodeProblem(doc: MinimalDoc): {
  problemText: string | null;
  code: string | null;
  codePartial: boolean;
} {
  const problemText = pickText(doc, LEETCODE_SELECTORS.problemContainer);
  let code: string | null = null;
  let codePartial = false;
  for (const sel of LEETCODE_SELECTORS.editorLines) {
    let lines: ArrayLike<{ textContent?: string | null }>;
    try {
      lines = doc.querySelectorAll(sel);
    } catch {
      continue;
    }
    if (lines.length > 0) {
      const joined = Array.from(lines)
        .map((l) => l.textContent ?? "")
        .join("\n");
      if (joined.trim()) {
        code = joined;
        // DOM lines may be virtualized: only visible lines exist.
        codePartial = true;
        break;
      }
    }
  }
  return { problemText, code, codePartial };
}

export function buildLeetCodeOutcome(
  raw: RawPageExtraction & { pageTextFromProblem: string | null; codePartial: boolean },
): ExtractionOutcome {
  const missing = [...raw.missingFields];
  const warnings = [...raw.warnings];
  if (!raw.pageTextFromProblem) missing.push("problemStatement");
  if (raw.code === null) missing.push("code");
  if (raw.codePartial && raw.code !== null) warnings.push("Editor lines may be virtualized; code snapshot labeled partial.");
  const pageText = raw.pageTextFromProblem ?? raw.pageText;
  const page = cap(pageText, 20000);
  const sel = cap(raw.selectedText, 5000);
  const code = raw.code === null ? null : cap(raw.code, CODE_MAX);
  const truncated = [...raw.truncatedFields];
  if (page.truncated) truncated.push("pageText");
  if (sel.truncated) truncated.push("selectedText");
  if (code && code.truncated) truncated.push("code");
  const hasContent = Boolean(page.text || (code && code.text) || sel.text);
  return {
    title: raw.title.slice(0, 500),
    pageText: page.text,
    selectedText: sel.text,
    code: code ? code.text : null,
    language: raw.language,
    quality: {
      code: !hasContent ? "unavailable" : missing.length || truncated.length || warnings.length ? "partial" : "complete",
      missingFields: missing,
      truncatedFields: truncated,
      warnings,
    },
  };
}

/**
 * Self-contained page function: problem statement + code + language in one
 * serializable pass. Do not import here. Mirrors extractLeetCodeProblem so
 * the capture flow reads the problem container instead of the generic shell.
 */
export function extractLeetCodeProblemInPage(): {
  problemText: string | null;
  code: string | null;
  language: string | null;
  partial: boolean;
} {
  const problemSels = [
    '[data-track-load="description_content"]',
    ".elfjS",
    ".question-content",
    '[class*="description"]',
  ];
  let problemText: string | null = null;
  for (const sel of problemSels) {
    try {
      const el = document.querySelector(sel);
      const t = (el?.textContent ?? "").trim();
      if (t) {
        problemText = t;
        break;
      }
    } catch {
      continue;
    }
  }
  const lineSels = [".view-lines .view-line", ".monaco-editor .view-line"];
  let code: string | null = null;
  for (const sel of lineSels) {
    const nodes = document.querySelectorAll(sel);
    if (nodes.length > 0) {
      const joined = Array.from(nodes)
        .map((n) => n.textContent ?? "")
        .join("\n");
      if (joined.trim()) {
        code = joined;
        break;
      }
    }
  }
  const langSels = ['[data-testid="language-select"]', ".ant-select-selection-item", '[class*="language"]'];
  let language: string | null = null;
  for (const sel of langSels) {
    try {
      const el = document.querySelector(sel);
      const t = (el?.textContent ?? "").trim();
      if (t) {
        language = t.slice(0, 64);
        break;
      }
    } catch {
      continue;
    }
  }
  // DOM lines may be virtualized: only visible lines are guaranteed.
  return { problemText, code, language, partial: true };
}

/** Self-contained MAIN/isolated-world page function. Returns only code/language. */
export function extractLeetCodeCodeInPage(): { code: string | null; language: string | null; partial: boolean } {
  const lineSels = [".view-lines .view-line", ".monaco-editor .view-line"];
  for (const sel of lineSels) {
    const nodes = document.querySelectorAll(sel);
    if (nodes.length > 0) {
      const joined = Array.from(nodes)
        .map((n) => n.textContent ?? "")
        .join("\n");
      if (joined.trim()) return { code: joined, language: null, partial: true };
    }
  }
  return { code: null, language: null, partial: true };
}
