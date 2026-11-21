/**
 * Saves `blob` as `fileName` through a hidden link (ADR-0048, PR D): the only download helper of AVIAM Web. The link
 * leaves the page right after its click and the object URL is freed a second later, so the browser has time to start
 * the download (revoking it at once can cancel it in some browsers).
 *
 * @param {Blob} blob
 * @param {string} fileName
 */
export function downloadFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
