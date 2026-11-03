// Generic page extractor. The injected entry `extractGenericInPage` is
// fully self-contained (no imports, no extension APIs) so the worker can
// run it via scripting.executeScript. The pure `buildGenericOutcome`
// helper applies bounds and is unit-tested against fixtures.

import {
  CODE_MAX,
  PAGE_TEXT_MAX,
  SELECTED_MAX,
  cap,
  type ExtractionOutcome,
  type RawPageExtraction,
} from "./types";

export function buildGenericOutcome(raw: RawPageExtraction): ExtractionOutcome {
  const page = cap(raw.pageText, PAGE_TEXT_MAX);
  const sel = cap(raw.selectedText, SELECTED_MAX);
  const code = raw.code === null ? null : cap(raw.code, CODE_MAX);
  const truncatedFields = [...raw.truncatedFields];
  if (page.truncated) truncatedFields.push("pageText");
  if (sel.truncated) truncatedFields.push("selectedText");
  if (code && code.truncated) truncatedFields.push("code");
  const missing = [...raw.missingFields];
  let q: ExtractionOutcome["quality"]["code"] = "complete";
  if (missing.length > 0 || truncatedFields.length > 0 || raw.warnings.length > 0) q = "partial";
  if (!raw.pageText && raw.code === null && !raw.selectedText) q = "unavailable";
  return {
    title: raw.title.slice(0, 500),
    pageText: page.text,
    selectedText: sel.text,
    code: code ? code.text : null,
    language: raw.language,
    quality: { code: q, missingFields: missing, truncatedFields, warnings: raw.warnings },
  };
}

/** Self-contained function serialized into the page. Do not import here. */
export function extractGenericInPage(): RawPageExtraction {
  const warnings: string[] = [];
  const missing: string[] = [];
  const doc = document;
  let pageText = "";
  try {
    const root = doc.querySelector("main, article") || doc.body;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript, input, textarea, select").forEach((n) => n.remove());
    pageText = (clone.innerText || "").trim();
  } catch {
    missing.push("pageText");
  }
  if (!pageText) missing.push("pageText");
  let selectedText = "";
  try {
    selectedText = (window.getSelection()?.toString() || "").trim();
  } catch {
    selectedText = "";
  }
  return {
    title: doc.title || "",
    url: location.href,
    selectedText,
    pageText,
    code: null,
    language: null,
    missingFields: missing,
    truncatedFields: [],
    warnings,
  };
}
