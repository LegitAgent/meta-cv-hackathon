import { afterEach, describe, expect, it, vi } from "vitest";
import { captureScreenshot, fitScreenshot } from "../src/capture/screenshot";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fitScreenshot", () => {
  it("passes through images that already fit", async () => {
    const small = `data:image/jpeg;base64,${"a".repeat(100)}`;
    await expect(fitScreenshot(small, 120000)).resolves.toBe(small);
  });

  it("rejects non-image inputs", async () => {
    await expect(fitScreenshot("not-a-url", 120000)).resolves.toBeNull();
    await expect(fitScreenshot("", 120000)).resolves.toBeNull();
  });

  it("downscales oversized images until they fit", async () => {
    const fitted = `data:image/jpeg;base64,${"b".repeat(50)}`;
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2000, height: 1000, close: () => undefined }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { drawImage: () => undefined };
        }
        async convertToBlob() {
          return new Blob(["x"], { type: "image/jpeg" });
        }
      } as unknown as typeof OffscreenCanvas,
    );
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_blob: Blob) {
          this.result = fitted;
          this.onload?.();
        }
      } as unknown as typeof FileReader,
    );
    const big = `data:image/jpeg;base64,${"a".repeat(200000)}`;
    await expect(fitScreenshot(big, 120000)).resolves.toBe(fitted);
  });

  it("returns null when the image cannot be made to fit", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2000, height: 1000, close: () => undefined }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: () => undefined };
        }
        async convertToBlob() {
          return new Blob(["x"], { type: "image/jpeg" });
        }
      } as unknown as typeof OffscreenCanvas,
    );
    const huge = `data:image/jpeg;base64,${"z".repeat(200000)}`;
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | null = null;
        onload: (() => void) | null = null;
        readAsDataURL(_blob: Blob) {
          this.result = huge;
          this.onload?.();
        }
      } as unknown as typeof FileReader,
    );
    await expect(fitScreenshot(huge, 120000)).resolves.toBeNull();
  });

  it("returns null when decoding fails", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("bad bitmap");
    });
    const big = `data:image/jpeg;base64,${"a".repeat(200000)}`;
    await expect(fitScreenshot(big, 120000)).resolves.toBeNull();
  });
});

describe("captureScreenshot", () => {
  it("captures the visible tab and fits the shot", async () => {
    const shot = `data:image/jpeg;base64,${"c".repeat(10)}`;
    vi.stubGlobal("chrome", {
      tabs: {
        get: async () => ({ id: 1, windowId: 7 }),
        captureVisibleTab: async () => shot,
      },
    });
    await expect(captureScreenshot(1)).resolves.toBe(shot);
  });

  it("returns null when capture is unavailable", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        get: async () => ({ id: 1 }),
        captureVisibleTab: async () => {
          throw new Error("denied");
        },
      },
    });
    await expect(captureScreenshot(1)).resolves.toBeNull();
  });
});
