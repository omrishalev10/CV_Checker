import { fetchDownload } from "./api";

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function triggerAnchorDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

/** Fetch a same-origin file without leaving the PWA (iPhone navigations get stuck on a blank app page). */
export async function downloadFromApi(url: string, fallbackName: string): Promise<void> {
  const { blob, filename } = await fetchDownload(url);
  const name = filename || fallbackName;
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });

  if (isIos() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }

  triggerAnchorDownload(blob, name);
}
