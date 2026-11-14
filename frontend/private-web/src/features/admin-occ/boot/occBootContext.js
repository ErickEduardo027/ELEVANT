'use client';

import { createContext, useContext } from 'react';

// The two contexts of the OCC boot screen (OccBootProvider.jsx). They live apart from the provider so that the screens
// that end the wait (the console, the map engine) import them without importing the provider or the screen.

/** The public value, `{ markReady(source) }`, stable for the life of the provider. */
export const OccBootContext = createContext(null);

/**
 * Internal: `{ report(event) }`, the channel through which OccBootAccessSignal tells the provider that the session was
 * checked and that the department access loaded or failed.
 */
export const OccBootSignalContext = createContext(null);

const NOOP_BOOT = Object.freeze({ markReady: () => {} });

/**
 * `markReady(source)` tells the boot screen that a screen has its first data on screen: `'console'` from the console,
 * `'map'` from the map engine. The first report counts and repeating one does nothing. Outside the provider (other
 * departments, the map lab, isolated screens and tests) it is a safe no-op.
 */
export function useOccBoot() {
  return useContext(OccBootContext) ?? NOOP_BOOT;
}

/** The provider's internal channel; null outside it. */
export function useOccBootSignal() {
  return useContext(OccBootSignalContext);
}
