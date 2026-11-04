// Optional visual supplement to text capture: a compressed JPEG screenshot of
// the visible tab. Text extraction stays the source of truth; a missing or
// oversized screenshot never fails the capture — callers fall back to text.

import { LIMITS } from "../shared/contracts";

const ATTEMPTS = [
  { maxDim: 1280, quality: 0.7 },
  { maxDim: 1024, quality: 0.65 },
  { maxDim: 800, quality: 0.6 },
] as const;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Shrink an image data URL until it fits maxChars, or return null when it
 * cannot be made to fit. Inputs that already fit pass through untouched.
 */
export async function fitScreenshot(dataUrl: string, maxChars: number = LIMITS.SCREENSHOT_MAX): Promise<string | null> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return null;
  if (dataUrl.length <= maxChars) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      for (const { maxDim, quality } of ATTEMPTS) {
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.drawImage(bitmap, 0, 0, w, h);
        const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
        const url = await blobToDataUrl(out);
        if (url.length <= maxChars) return url;
      }
      return null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Capture the visible tab as a fitted JPEG data URL, or null when unavailable. */
export async function captureScreenshot(tabId: number, maxChars: number = LIMITS.SCREENSHOT_MAX): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId === undefined) return null;
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    if (!url) return null;
    return await fitScreenshot(url, maxChars);
  } catch {
    return null;
  }
}
