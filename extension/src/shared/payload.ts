import { LIMITS, type Checkpoint, type SummaryRequestPayload } from "./contracts";

/**
 * Build the summary request payload from the exact persisted inputs returned
 * by beginSummary: the saved checkpoint plus its note snapshots. Never read
 * live notes here; edits after SUMMARY_BEGIN must not change the request.
 *
 * Notes share a 10,000-character transport budget (backend aggregate limit).
 * Snapshots are trimmed in selection order and every trim is reported, so
 * content is never silently discarded.
 */
export function buildSummaryPayload(
  checkpoint: Checkpoint,
  requestId: string,
  snapshots: { id: string; revision: number; body: string }[],
): { payload: SummaryRequestPayload; warnings: string[] } {
  const warnings: string[] = [];
  const notes: { id: string; body: string }[] = [];
  let used = 0;
  for (const s of snapshots) {
    const room = LIMITS.NOTES_TOTAL_MAX - used;
    if (room <= 0) {
      warnings.push(`Note "${s.id}" was left out: notes share a ${LIMITS.NOTES_TOTAL_MAX.toLocaleString("en-US")}-character recap budget.`);
      continue;
    }
    if (s.body.length <= room) {
      notes.push({ id: s.id, body: s.body });
      used += s.body.length;
    } else {
      notes.push({ id: s.id, body: s.body.slice(0, room) });
      used += room;
      warnings.push(
        `Note "${s.id}" was trimmed to ${room.toLocaleString("en-US")} characters: notes share a ${LIMITS.NOTES_TOTAL_MAX.toLocaleString("en-US")}-character recap budget.`,
      );
    }
  }
  return {
    payload: {
      requestId,
      checkpoint: {
        id: checkpoint.id,
        title: checkpoint.title,
        pageText: checkpoint.pageText,
        selectedText: checkpoint.selectedText,
        code: checkpoint.code,
        language: checkpoint.language,
        quality: checkpoint.quality,
      },
      notes,
    },
    warnings,
  };
}
