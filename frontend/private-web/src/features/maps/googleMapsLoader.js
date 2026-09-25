import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

let configuredKey = null;

export async function loadGoogleMap(key) {
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('Google Maps is not configured.');
  }
  if (configuredKey && configuredKey !== key) {
    throw new Error('Google Maps cannot change API keys during a browser session.');
  }
  if (!configuredKey) {
    setOptions({ key, v: 'weekly', language: 'es', region: 'DO' });
    configuredKey = key;
  }
  await importLibrary('maps');
  await importLibrary('marker');
  return globalThis.google.maps;
}
