/**
 * Saves a file the API generated (an invoice, a note, a receipt) with a readable name. The blob URL is revoked one
 * second later: revoking it right after the click can cancel the download before the browser reads it.
 */
export function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
