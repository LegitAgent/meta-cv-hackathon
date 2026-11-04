// Reopening a checkpoint prefers the tab it came from: focus the first open
// tab whose page matches the checkpoint URL, and only open a new tab when
// no match exists. URLs are compared query/fragment-insensitive, the same
// way captures store them.

import { cleanUrl } from "../capture/types";

export interface OpenTab {
  id?: number;
  windowId?: number;
  url?: string;
}

export interface TabsApi {
  query(query: Record<string, never>): Promise<OpenTab[]>;
  update(id: number, props: { active: boolean }): Promise<unknown>;
  create(props: { url: string }): Promise<unknown>;
}

export interface WindowsApi {
  update(id: number, props: { focused: boolean }): Promise<unknown>;
}

function norm(url: string): string {
  const cleaned = cleanUrl(url);
  return cleaned.endsWith("/") && !cleaned.endsWith("://") ? cleaned.slice(0, -1) : cleaned;
}

export async function openExistingOrNewTab(
  tabs: TabsApi,
  windows: WindowsApi,
  url: string,
): Promise<"focused" | "opened" | "invalid"> {
  if (!url || !/^https?:\/\//.test(url)) return "invalid";
  const target = norm(url);
  const open = await tabs.query({});
  const existing = open.find((t) => t.id !== undefined && !!t.url && norm(t.url) === target);
  if (existing?.id !== undefined) {
    if (existing.windowId !== undefined) {
      try {
        await windows.update(existing.windowId, { focused: true });
      } catch {
        // Focusing is best-effort; activating the tab below still lands the user.
      }
    }
    await tabs.update(existing.id, { active: true });
    return "focused";
  }
  await tabs.create({ url });
  return "opened";
}
