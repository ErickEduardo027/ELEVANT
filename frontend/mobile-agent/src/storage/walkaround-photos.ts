import { Directory, File, Paths } from 'expo-file-system';

/**
 * Walk-around photos waiting to be sent (ADR-0032). The camera's cache file may be purged by the
 * system, so the photo is copied into the app's own documents folder first and removed only after
 * ELEVANT confirmed it. Local data is only a cache: the server copy is the record.
 */
const folder = () => new Directory(Paths.document, 'walkaround');

export function keepWalkaroundPhoto(sourceUri: string, markId: string, contentType: 'image/jpeg' | 'image/png'): string {
  const directory = folder();
  directory.create({ idempotent: true, intermediates: true });
  const target = new File(directory, `${markId}.${contentType === 'image/png' ? 'png' : 'jpg'}`);
  if (target.exists) target.delete();
  new File(sourceUri).copy(target);
  return target.uri;
}

export async function readWalkaroundPhoto(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

export function forgetWalkaroundPhoto(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone: nothing to clean.
  }
}
