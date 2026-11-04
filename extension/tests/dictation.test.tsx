// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../src/panel/App";

interface RecogInstance {
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function stubSpeechRecognition(created: RecogInstance[]) {
  Object.defineProperty(window, "SpeechRecognition", {
    value: class implements RecogInstance {
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        created.push(this);
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onerror?.({ error: "aborted" });
        this.onend?.();
      }
    },
    configurable: true,
  });
}

function setup() {
  const records: Record<string, unknown> = {
    workspace: {
      openNoteIds: ["a", "b"],
      activeNoteId: "a",
      selectedCheckpointId: null,
      aiEnabled: false,
      autoSummarize: false,
      lastFollowedTabId: null,
    },
    "note:a": { id: "a", revision: 0, title: "a", body: "", createdAt: "2026-01-01", updatedAt: "2026-01-01", linkedCheckpointId: null },
    "note:b": { id: "b", revision: 0, title: "b", body: "", createdAt: "2026-01-01", updatedAt: "2026-01-01", linkedCheckpointId: null },
  };
  const chromeMock = {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys == null) return { ...records };
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in records).map((k) => [k, records[k]]));
        },
        set: async (items: Record<string, unknown>) => {
          Object.assign(records, items);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete records[k];
        },
        onChanged: { addListener: () => undefined, removeListener: () => undefined },
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
      session: {
        get: async () => ({
          backendCredential: {
            origin: "https://backtrack.martinalba.dev",
            token: "tok",
            email: "a@gmail.com",
            expiresAt: Date.now() + 3600000,
          },
        }),
        set: async () => undefined,
        remove: async () => undefined,
      },
    },
    runtime: {
      sendMessage: (message: { type: string }, callback: (response: unknown) => void) => {
        callback?.({ ok: true, data: { note: records["note:a"] } });
      },
      onMessage: { addListener: () => undefined },
    },
  };
  vi.stubGlobal("chrome", chromeMock);
  return { records };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

it("explains a blocked microphone and lets the error be dismissed", async () => {
  const created: RecogInstance[] = [];
  stubSpeechRecognition(created);
  setup();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Dictate note" }));
  expect(created).toHaveLength(1);
  await act(async () => {
    created[0].onerror?.({ error: "not-allowed" });
  });
  expect(screen.getByRole("alert").textContent).toMatch(/Microphone blocked/);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss dictation error" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("does not blame the microphone when switching notes aborts dictation", async () => {
  const created: RecogInstance[] = [];
  stubSpeechRecognition(created);
  setup();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Dictate note" }));
  expect(created).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Stop dictation" })).toBeTruthy();
  // Switching notes aborts the recognizer; the abort error must stay silent.
  fireEvent.click(screen.getByText("b", { selector: "span[title='Double-click to rename']" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
