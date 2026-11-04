import { describe, expect, it, vi } from "vitest";
import { openExistingOrNewTab, type TabsApi, type WindowsApi } from "../src/panel/reopen";

function apis(tabs: { id?: number; windowId?: number; url?: string }[]) {
  const query = vi.fn(async () => tabs);
  const update = vi.fn(async () => undefined);
  const create = vi.fn(async () => undefined);
  const focus = vi.fn(async () => undefined);
  const tabsApi: TabsApi = { query, update, create };
  const windowsApi: WindowsApi = { update: focus };
  return { tabsApi, windowsApi, query, update, create, focus };
}

describe("openExistingOrNewTab", () => {
  it("focuses the saved tab when its URL matches ignoring query and fragment", async () => {
    const { tabsApi, windowsApi, update, create, focus } = apis([
      { id: 7, windowId: 2, url: "https://example.com/page?x=1#y" },
    ]);
    const outcome = await openExistingOrNewTab(tabsApi, windowsApi, "https://example.com/page");
    expect(outcome).toBe("focused");
    expect(focus).toHaveBeenCalledWith(2, { focused: true });
    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("opens a new tab when nothing matches", async () => {
    const { tabsApi, windowsApi, update, create } = apis([
      { id: 7, windowId: 2, url: "https://example.com/other" },
    ]);
    const outcome = await openExistingOrNewTab(tabsApi, windowsApi, "https://example.com/page");
    expect(outcome).toBe("opened");
    expect(create).toHaveBeenCalledWith({ url: "https://example.com/page" });
    expect(update).not.toHaveBeenCalled();
  });

  it("activates a match without a window id and skips focusing", async () => {
    const { tabsApi, windowsApi, update, focus } = apis([{ id: 9, url: "https://example.com/page" }]);
    const outcome = await openExistingOrNewTab(tabsApi, windowsApi, "https://example.com/page");
    expect(outcome).toBe("focused");
    expect(update).toHaveBeenCalledWith(9, { active: true });
    expect(focus).not.toHaveBeenCalled();
  });

  it("rejects non-http urls without touching tabs", async () => {
    const { tabsApi, windowsApi, query, update, create } = apis([]);
    expect(await openExistingOrNewTab(tabsApi, windowsApi, "ftp://example.com/page")).toBe("invalid");
    expect(await openExistingOrNewTab(tabsApi, windowsApi, "")).toBe("invalid");
    expect(query).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
