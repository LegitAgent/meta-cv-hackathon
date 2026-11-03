// Shared capture types + application-side input bounds.
// UI and backend constraints must agree (TECHNICAL_SPEC sections 5, 9).

export const PAGE_TEXT_MAX = 20000;
export const CODE_MAX = 30000;
export const SELECTED_MAX = 5000;
export const NOTES_TOTAL_MAX = 10000;

export interface RawPageExtraction {
  title: string;
  url: string;
  selectedText: string;
  pageText: string;
  code: string | null;
  language: string | null;
  missingFields: string[];
  truncatedFields: string[];
  warnings: string[];
}

export interface ExtractionOutcome {
  title: string;
  pageText: string;
  selectedText: string;
  code: string | null;
  language: string | null;
  quality: {
    code: "complete" | "partial" | "unavailable";
    missingFields: string[];
    truncatedFields: string[];
    warnings: string[];
  };
}

export function cap(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

/** Strip query strings and fragments so incidental tokens are not retained. */
export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return raw.slice(0, 2000);
  }
}

export function taskKeyForUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url.slice(0, 200);
  }
}
