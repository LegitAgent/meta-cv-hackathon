import { LIMITS, type Checkpoint, type NoteSnapshot, type SummaryRequestPayload } from "./contracts";

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
  snapshots: NoteSnapshot[],
): { payload: SummaryRequestPayload; warnings: string[] } {
  const warnings: string[] = [];
  const notes: { id: string; body: string }[] = [];
  const overrides = snapshots.filter((s) => s.kind === "codeOverride" && s.linkedCheckpointId === checkpoint.id);
  const codeOverride = overrides[overrides.length - 1];
  if (overrides.length > 1) warnings.push("Multiple pasted code notes were selected; the last one is used as code.");
  if (codeOverride && codeOverride.body.length > LIMITS.CODE_MAX) {
    warnings.push(`Pasted code was trimmed to ${LIMITS.CODE_MAX.toLocaleString("en-US")} characters for the recap.`);
  }
  let code = codeOverride ? codeOverride.body.slice(0, LIMITS.CODE_MAX) : checkpoint.code;
  if (!codeOverride && code && code.length > LIMITS.CODE_MAX) {
    warnings.push(`Captured code was trimmed to ${LIMITS.CODE_MAX.toLocaleString("en-US")} characters for the recap.`);
    code = code.slice(0, LIMITS.CODE_MAX);
  }
  let used = 0;
  for (const s of snapshots) {
    if (s.kind === "codeOverride" && s.linkedCheckpointId === checkpoint.id) continue;
    if (s.kind === "codeOverride") warnings.push(`Note "${s.id}" is pasted code for another checkpoint and was included as a regular note.`);
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
        code,
        language: checkpoint.language,
        screenshot: checkpoint.screenshot,
        stuckPoint: checkpoint.stuckPoint,
        quality: codeOverride ? {
          ...checkpoint.quality,
          warnings: [...checkpoint.quality.warnings, "Code for this recap came from a pasted note and replaces captured code."],
        } : checkpoint.quality,
      },
      notes,
    },
    warnings,
  };
}
