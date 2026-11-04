import { describe, expect, it } from "vitest";
import { fitScreenshot } from "../src/capture/screenshot";

describe("fitScreenshot", () => {
  it("passes through short data URLs untouched", async () => {
    const url = `data:image/jpeg;base64,${"a".repeat(100)}`;
    await expect(fitScreenshot(url)).resolves.toBe(url);
  });
  it("rejects non data-URL inputs without touching the network", async () => {
    await expect(fitScreenshot("https://example.com/x.jpg")).resolves.toBe(null);
    await expect(fitScreenshot("")).resolves.toBe(null);
  });
});
