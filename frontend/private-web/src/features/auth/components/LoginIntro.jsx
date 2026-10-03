import { useEffect, useState } from 'react';

const SEEN_KEY = 'elevant-private-intro-seen';
const INTRO_MS = 2700;

let playedInThisPage = false;

function shouldPlay() {
  if (playedInThisPage || typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return window.sessionStorage?.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

function markPlayed() {
  playedInThisPage = true;
  try { window.sessionStorage?.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable */ }
}

export function resetLoginIntroForTests() {
  playedInThisPage = false;
  try { window.sessionStorage?.removeItem(SEEN_KEY); } catch { /* storage unavailable */ }
}

// Brief brand welcome shown once per browser session before the login. It is
// an overlay: the login underneath is already laid out and usable, so the
// animation never moves the final composition. Any click or key skips it.
export default function LoginIntro({ marks }) {
  const [visible, setVisible] = useState(shouldPlay);

  useEffect(() => {
    if (!visible) return undefined;
    markPlayed();
    const done = () => setVisible(false);
    const timer = setTimeout(done, INTRO_MS);
    window.addEventListener('keydown', done, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', done);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="elv-intro-screen" aria-hidden="true" onPointerDown={() => setVisible(false)}>
      <div className="elv-intro-glow" />
      <div className="elv-intro-lockup">
        <span className="elv-intro-mark">{marks}</span>
        <span className="elv-intro-name">ELEVANT</span>
      </div>
    </div>
  );
}
