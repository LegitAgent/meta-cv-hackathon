import { describe, expect, it } from "vitest";
import { Repository, type AsyncStorageArea } from "../src/storage/repository";
import { reconcileOnStartup } from "../src/storage/migrations";
import type { Checkpoint, Note } from "../src/shared/contracts";

function memArea(seed: Record<string, unknown> = {}): AsyncStorageArea {
  const store: Record<string, unknown> = { ...seed };
  return {
    get: async (keys) => {
      if (keys === null) return { ...store };
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (items) => {
      Object.assign(store, items);
    },
    remove: async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
  };
}

function cp(id: string): Checkpoint {
  return {
    id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    taskKey: "leetcode.com/problems/two-sum/",
    title: "Two Sum",
    url: "https://leetcode.com/problems/two-sum/",
    adapter: "leetcode",
    pageText: "problem",
    selectedText: "",
    code: "x=1",
    language: "python",
    quality: { code: "complete", missingFields: [], truncatedFields: [], warnings: [] },
  };
}

const summary = {
  recap: "Saved attempt stores seen values.",
  observedFacts: [{ text: "The code creates a dict.", sourceFields: ["code"] }],
  possibleBlocker: null,
  nextAction: "Trace the loop with [2,7,11,15], target 9.",
  uncertainties: [],
};

describe("repository", () => {
  it("rejects stale note revisions instead of overwriting", async () => {
    const repo = new Repository(memArea());
    const note = await repo.createNote("n1");
    const first = await repo.updateNote(note.id, 0, "n1", "hello");
    expect(first.ok).toBe(true);
    const stale = await repo.updateNote(note.id, 0, "n1", "clobber");
    expect(stale.ok).toBe(false);
    if (!stale.ok && stale.code === "REVISION_CONFLICT") {
      expect(stale.current.body).toBe("hello");
    } else {
      throw new Error("expected revision conflict");
    }
    const got = await repo.getNote(note.id);
    expect((got as Note).body).toBe("hello");
  });

  it("deleting a checkpoint retains linked notes", async () => {
    const repo = new Repository(memArea());
    await repo.createCheckpoint(cp("c1"));
    const note = await repo.createNote("linked", "c1");
    const r = await repo.deleteCheckpoint("c1");
    expect(r.deleted).toBe(true);
    expect(await repo.getNote(note.id)).not.toBe(null);
    expect(await repo.getCheckpoint("c1")).toBe(null);
  });

  it("queues rapid successive captures without interleaving", async () => {
    const repo = new Repository(memArea());
    await Promise.all([repo.createCheckpoint(cp("a")), repo.createCheckpoint(cp("b")), repo.createCheckpoint(cp("c"))]);
    expect(await repo.getCheckpoint("a")).not.toBe(null);
    expect(await repo.getCheckpoint("b")).not.toBe(null);
    expect(await repo.getCheckpoint("c")).not.toBe(null);
  });

  it("summary inputs are frozen at begin time", async () => {
    const repo = new Repository(memArea());
    await repo.createCheckpoint(cp("c3"));
    const note = await repo.createNote("n");
    await repo.updateNote(note.id, 0, "n", "v1");
    const { job, notes, checkpoint } = await repo.beginSummary("c3", [note.id]);
    await repo.updateNote(note.id, 1, "n", "v2");
    expect(checkpoint.id).toBe("c3");
    expect(notes).toEqual([{ id: note.id, revision: 1, body: "v1" }]);
    expect(job.includedNoteSnapshots).toEqual([{ id: note.id, revision: 1, body: "v1" }]);
    expect(job.requestId).toBeTruthy();
  });

  it("late summary results do not overwrite newer jobs", async () => {
    const repo = new Repository(memArea());
    await repo.createCheckpoint(cp("c9"));
    const { job: first } = await repo.beginSummary("c9", []);
    const { job: second } = await repo.beginSummary("c9", []);
    expect(first.requestId).not.toBe(second.requestId);
    // Stale first result is rejected.
    expect(await repo.completeSummary("c9", first.requestId as string, summary)).toBe(false);
    expect(await repo.completeSummary("c9", second.requestId as string, summary)).toBe(true);
    const job = await repo.getSummaryJob("c9");
    expect(job.status).toBe("complete");
  });

  it("failed regeneration preserves the last valid result", async () => {
    const repo = new Repository(memArea());
    await repo.createCheckpoint(cp("c2"));
    const { job: j1 } = await repo.beginSummary("c2", []);
    await repo.completeSummary("c2", j1.requestId as string, summary);
    const { job: j2 } = await repo.beginSummary("c2", []);
    expect((await repo.getSummaryJob("c2")).result).toEqual(summary);
    await repo.failSummary("c2", j2.requestId as string, { code: "HTTP_502", message: "provider down" });
    const job = await repo.getSummaryJob("c2");
    expect(job.status).toBe("failed");
    expect(job.result).toEqual(summary);
  });

  it("reconciliation drops invalid workspace refs and interrupts stale jobs", async () => {
    const area = memArea({
      workspace: {
        openNoteIds: ["ghost"],
        activeNoteId: "ghost",
        selectedCheckpointId: "missing",
        aiEnabled: false,
        autoSummarize: false,
        backendUrl: "http://127.0.0.1:8001",
      },
      "summary:old": {
        checkpointId: "old",
        requestId: "r-old",
        status: "pending",
        startedAt: new Date(Date.now() - 120_000).toISOString(),
        inputHash: null,
        includedNoteSnapshots: [],
        result: null,
        error: null,
      },
    });
    const report = await reconcileOnStartup(area);
    expect(report.removedWorkspaceRefs.length).toBeGreaterThan(0);
    expect(report.interruptedJobs).toContain("old");
    const ws = (await area.get(["workspace"]))["workspace"] as { openNoteIds: string[]; activeNoteId: null };
    expect(ws.openNoteIds).toEqual([]);
    expect(ws.activeNoteId).toBe(null);
    const job = (await area.get(["summary:old"]))["summary:old"] as { status: string; error: { code: string } };
    expect(job.status).toBe("failed");
    expect(job.error.code).toBe("INTERRUPTED");
  });
});
