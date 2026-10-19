import { useEffect, useRef, useState } from 'react';

const INTRO_MS = 2700;
const ASSET_WAIT_MS = 20000;

let playedInThisPage = false;

export function resetLoginIntroForTests() {
  playedInThisPage = false;
}

// One welcome per document, including reloads. Slow images never consume its
// animation time or block the form. Any interaction cancels even a pending intro.
export default function LoginIntro({ marks }) {
  const [phase, setPhase] = useState('preparing');
  const root = useRef(null);
  const claimed = useRef(false);

  useEffect(() => {
    if (playedInThisPage && !claimed.current) {
      setPhase('done');
      return undefined;
    }
    let finished = false;
    let started = false;
    let animationTimer;
    const images = [...root.current.querySelectorAll('img')];
    const ready = new Set(images.filter(image => image.complete && image.naturalWidth > 0));
    const done = () => {
      finished = true;
      playedInThisPage = true;
      claimed.current = true;
      clearTimeout(animationTimer);
      clearTimeout(assetTimer);
      setPhase('done');
    };
    const start = () => {
      if (finished || started || ready.size !== images.length) return;
      started = true;
      playedInThisPage = true;
      claimed.current = true;
      clearTimeout(assetTimer);
      setPhase('playing');
      animationTimer = setTimeout(done, INTRO_MS);
    };
    const loaded = event => {
      if (event.currentTarget.naturalWidth > 0) ready.add(event.currentTarget);
      start();
    };
    const assetTimer = setTimeout(done, ASSET_WAIT_MS);
    images.forEach(image => {
      image.addEventListener('load', loaded);
      image.addEventListener('error', done);
    });
    window.addEventListener('keydown', done, { once: true });
    window.addEventListener('pointerdown', done, { once: true });
    window.addEventListener('click', done, { once: true });
    window.addEventListener('focusin', done, { once: true });
    start();
    return () => {
      finished = true;
      clearTimeout(animationTimer);
      clearTimeout(assetTimer);
      images.forEach(image => {
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', done);
      });
      window.removeEventListener('keydown', done);
      window.removeEventListener('pointerdown', done);
      window.removeEventListener('click', done);
      window.removeEventListener('focusin', done);
    };
  }, []);

  if (phase === 'done') return null;

  return (
    <div ref={root} className="elv-intro-screen" aria-hidden="true" hidden={phase !== 'playing'}>
      <div className="elv-intro-glow" />
      <div className="elv-intro-lockup">
        <span className="elv-intro-mark">{marks}</span>
        <span className="elv-intro-name">ELEVANT</span>
      </div>
    </div>
  );
}
