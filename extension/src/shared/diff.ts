// Pure attempt-diff helper: what changed between two checkpoints of a task.
// No AI, no storage, no DOM — cheap to run in the panel and unit-tested here.

import type { Checkpoint } from "./contracts";

export interface ChangedLine {
  type: "add" | "remove";
  text: string;
}

export interface CheckpointDiff {
  sameTask: boolean;
  codeAdded: number;
  codeRemoved: number;
  pageTextDelta: number;
  titleChanged: boolean;
  summary: string;
  changedLines: ChangedLine[];
}

/** Cap on rendered changed lines; counts always cover the full diff. */
export const MAX_CHANGED_LINES = 40;
/** LCS guard: beyond this cell count the middle is reported wholesale. */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(code: string | null): string[] {
  if (!code) return [];
  return code.split("\n");
}

/**
 * Ordered add/remove ops for two line lists. Ties resolve toward removals
 * first so swaps read in the conventional remove-then-add order.
 */
function lcsOps(aMid: string[], bMid: string[]): ChangedLine[] {
  const m = aMid.length;
  const n = bMid.length;
  if (m * n > MAX_LCS_CELLS) {
    return [
      ...aMid.map((text): ChangedLine => ({ type: "remove", text })),
      ...bMid.map((text): ChangedLine => ({ type: "add", text })),
    ];
  }
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= m; i++) dp.push(new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aMid[i - 1] === bMid[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: ChangedLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (aMid[i - 1] === bMid[j - 1]) {
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      ops.push({ type: "remove", text: aMid[i - 1] });
      i--;
    } else {
      ops.push({ type: "add", text: bMid[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "remove", text: aMid[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "add", text: bMid[j - 1] });
    j--;
  }
  return ops.reverse();
}

function diffCodeLines(aCode: string | null, bCode: string | null): ChangedLine[] {
  const aLines = splitLines(aCode);
  const bLines = splitLines(bCode);
  let start = 0;
  while (start < aLines.length && start < bLines.length && aLines[start] === bLines[start]) start++;
  let endA = aLines.length - 1;
  let endB = bLines.length - 1;
  while (endA >= start && endB >= start && aLines[endA] === bLines[endB]) {
    endA--;
    endB--;
  }
  return lcsOps(aLines.slice(start, endA + 1), bLines.slice(start, endB + 1));
}

export function diffCheckpoints(a: Checkpoint, b: Checkpoint): CheckpointDiff {
  const sameTask = a.taskKey !== "" && a.taskKey === b.taskKey;
  const pageTextDelta = b.pageText.length - a.pageText.length;
  const titleChanged = a.title !== b.title;
  let codeAdded = 0;
  let codeRemoved = 0;
  let changedLines: ChangedLine[] = [];
  let codeSummary: string;
  if (!a.code || !b.code) {
    codeSummary = "no code in one snapshot";
  } else {
    const ops = diffCodeLines(a.code, b.code);
    codeRemoved = ops.filter((o) => o.type === "remove").length;
    codeAdded = ops.filter((o) => o.type === "add").length;
    changedLines = ops.slice(0, MAX_CHANGED_LINES);
    codeSummary = ops.length === 0 ? "code identical" : `code +${codeAdded} -${codeRemoved} lines`;
  }
  const pageSummary =
    pageTextDelta === 0 ? "page text same length" : `page text ${pageTextDelta > 0 ? "+" : ""}${pageTextDelta} chars`;
  const titleSummary = titleChanged ? "title changed" : "same title";
  return {
    sameTask,
    codeAdded,
    codeRemoved,
    pageTextDelta,
    titleChanged,
    summary: [sameTask ? "same task" : "different tasks", codeSummary, pageSummary, titleSummary].join("; "),
    changedLines,
  };
}
