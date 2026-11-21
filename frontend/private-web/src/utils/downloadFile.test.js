import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { downloadFile } from './downloadFile';

let clicked;
beforeEach(() => {
  vi.useFakeTimers();
  clicked = [];
  URL.createObjectURL = vi.fn(() => 'blob:elevant-file');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    clicked.push({ href: this.getAttribute('href'), download: this.download, attached: this.isConnected });
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('saves the blob with its name and frees the URL a second later', () => {
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  downloadFile(blob, 'elevant-occ-operations.pdf');
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  expect(clicked).toEqual([{ href: 'blob:elevant-file', download: 'elevant-occ-operations.pdf', attached: true }]);
  // The link leaves the page at once; the URL lives one more second so the browser can start the download.
  expect(document.querySelector('a[download]')).toBeNull();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:elevant-file');
});

it('frees the URL even when the click fails', () => {
  HTMLAnchorElement.prototype.click.mockImplementationOnce(() => { throw new Error('blocked'); });
  expect(() => downloadFile(new Blob(['x']), 'x.xlsx')).toThrow('blocked');
  expect(document.querySelector('a[download]')).toBeNull();
  vi.advanceTimersByTime(1000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:elevant-file');
});
