import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../shell/useTheme';
import { useLanguage } from '../shell/useLanguage';
import { MailIcon, MoonIcon, ShieldCheckIcon, SunIcon } from '../shell/components/icons';
import { getLoginMessages } from './loginMessages';
import './LoginScreen.css';

// Public assets resolved through Vite's base URL so they work in dev and in
// production builds. Two official isotype variants, one per surface: the mark
// is swapped, never recoloured or filtered.
const MARK = {
  light: `${import.meta.env.BASE_URL}brand/elevant-isotipo-light.png`,
  dark: `${import.meta.env.BASE_URL}brand/elevant-isotipo-dark.png`,
};

// Deliberately permissive: the server is the authority on whether an address
// exists. This only catches input that cannot possibly be an email.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PARALLAX_RANGE = 8;

function LockIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </svg>
  );
}

function EyeIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="18" height="18">
      {open ? (
        <>
          <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3.1" />
        </>
      ) : (
        <>
          <path d="M4 4.5 20 20.5" />
          <path d="M9.9 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.4 4.1M6.4 8A17 17 0 0 0 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 3.3-.6" />
          <path d="M10 10a3 3 0 0 0 4.1 4.2" />
        </>
      )}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16">
      <path d="m5 12.5 4.4 4.5L19 7" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16" opacity="0.9">
      <path d="M4 12h14m-5.5-5.5L18.5 12l-6 5.5" />
    </svg>
  );
}

/** Two-option control shared by the language and theme pickers. */
function Segmented({ className, label, options, value, onSelect }) {
  const index = Math.max(0, options.findIndex(option => option.value === value));
  return (
    <div className={`elvl-seg ${className}`} role="group" aria-label={label} style={{ '--elvl-seg-i': index }}>
      <span className="elvl-seg-thumb" aria-hidden="true" />
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className="elvl-seg-btn"
          aria-pressed={option.value === value}
          aria-label={option.label}
          onClick={() => onSelect(option.value)}
        >
          {option.content}
        </button>
      ))}
    </div>
  );
}

// Background, reproduced from the reference mockups. Every coordinate below was
// measured off the 1536x1024 references and is expressed in thousandths of the
// viewport, so viewBox="-30 -30 1060 1060" with preserveAspectRatio="none" puts
// each element at the same percentage of the screen the mockup puts it at, at
// any aspect ratio. The -30 offset cancels the -3% inset the parallax planes
// carry.
//
// Measured on the dark reference:
//   architectural edge A  (29.7%, 4%) -> (22.7%, 24%) -> (8.8%, 70%) -> (13.9%, 96%)
//   architectural edge B  (75.3%, 4%) -> (68.2%, 24%), slope -0.355 %x per %y
//   orange ray            (0%, 48%)   -> (11.7%, 66.2%)       45 deg on screen
//   electric blue ray     (1.6%, 59%) -> (26.5%, 96.5%)       45 deg
//   faint third ray       (3%, 49.6%) -> (32.9%, 96.5%)       45 deg
//   flight path           (71.4%, 86.2%) -> (95.9%, 51.1%) -> (94.9%, 23.7%)
//   orange node           (95%, 23.2%)
//   aircraft              (81.7%, 33.2%)
//   technical crosshair   (91.2%, 42.2%)
//   navy wedge (light)    hypotenuse (8%, 68%) -> (27.3%, 98%), 45 deg
//
// Note on the 45-degree family: the references are 3:2, so a 45-degree line on
// screen is a slope of 1.5 in these square-normalised coordinates.

const EDGE_A = 'M311 0L227 240C200 380 110 560 88 700 84 800 95 890 139 960L139 1000';
const EDGE_B = 'M767 0L682 240 412 1000';
const EDGE_C = 'M1000 420L673 1000';

// Generated through the sixteen points measured along the reference curve, so
// the path matches it rather than approximating it.
const FLIGHT =
  'M714 862C716 857 723 840 728 830C733 820 738 810 742 800C746 790 750 780 755 770C760 760 763 750 771 740C779 730 786 720 803 710C820 700 856 688 872 680C888 672 892 668 900 660C908 652 912 640 917 630C922 620 924 610 928 600C932 590 936 580 939 570C942 560 946 550 949 540C952 530 958 527 960 510C962 493 962 468 962 440C962 412 959 374 957 340C955 306 951 254 950 237';

function Geometry() {
  return (
    <svg className="elvl-geo" viewBox="-30 -30 1060 1060" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="elvl-plane-a" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="var(--elvl-plane-hi)" />
          <stop offset="100%" stopColor="var(--elvl-plane-lo)" />
        </linearGradient>
        <linearGradient id="elvl-plane-b" x1="0.2" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--elvl-plane-mid)" />
          <stop offset="100%" stopColor="var(--elvl-plane-lo)" />
        </linearGradient>
        {/* Every hairline fades at both ends: that is what keeps a line from
            reading as a stroke drawn on top of the image. */}
        <linearGradient id="elvl-edge" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="var(--elvl-edge-line)" stopOpacity="0" />
          <stop offset="22%" stopColor="var(--elvl-edge-line)" stopOpacity="1" />
          <stop offset="82%" stopColor="var(--elvl-edge-line)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--elvl-edge-line)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="elvl-ray-orange" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--elvl-orange)" stopOpacity="0.4" />
          <stop offset="18%" stopColor="var(--elvl-orange)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--elvl-orange)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="elvl-ray-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--elvl-ray-blue)" stopOpacity="0" />
          <stop offset="38%" stopColor="var(--elvl-ray-blue)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--elvl-ray-blue)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* The three large planes the diagonals cut the screen into. */}
      <path d={`${EDGE_A}L0 1000L0 0Z`} fill="url(#elvl-plane-a)" />
      <path d={`${EDGE_B}L412 1000L139 1000C95 890 84 800 88 700 110 560 200 380 227 240L311 0Z`} fill="url(#elvl-plane-b)" />
      <path d={`${EDGE_C}L1000 1000Z`} fill="var(--elvl-plane-lo)" />

      {/* Their contour hairlines. 1px, faded at both ends, no exceptions. */}
      <g fill="none" stroke="url(#elvl-edge)" strokeWidth="1" vectorEffect="non-scaling-stroke">
        <path d={EDGE_A} />
        <path d={EDGE_B} />
        <path d={EDGE_C} opacity="0.55" />
      </g>

      {/* Solid navy wedge in the bottom-left corner; carries the light theme. */}
      <path className="elvl-geo-wedge" d="M0 571L286 1000L0 1000Z" fill="var(--elvl-wedge-fill)" />

      {/* The three 45-degree rays. Thin, gradient-faded, never uniform. */}
      <g vectorEffect="non-scaling-stroke" fill="none">
        <path d="M30 496L329 965" stroke="var(--elvl-ray-blue)" strokeOpacity="0.22" strokeWidth="0.9" />
        <path d="M16 590L265 965" stroke="url(#elvl-ray-blue)" strokeWidth="1.2" />
        <path d="M0 480L190 765" stroke="url(#elvl-ray-orange)" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

function FlightPath({ flightRef }) {
  return (
    <svg className="elvl-route" viewBox="-30 -30 1060 1060" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="elvl-track" x1="0" y1="1" x2="0.4" y2="0">
          <stop offset="0%" stopColor="var(--elvl-scene-track)" stopOpacity="0.06" />
          <stop offset="46%" stopColor="var(--elvl-scene-track)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--elvl-scene-track)" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="elvl-head" x1="0" y1="1" x2="0.4" y2="0">
          <stop offset="0%" stopColor="var(--elvl-scene-head)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--elvl-scene-head)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--elvl-scene-head)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" vectorEffect="non-scaling-stroke">
        <path ref={flightRef} d={FLIGHT} stroke="url(#elvl-track)" strokeWidth="1.2" />
        {/* pathLength normalises the dash maths against the real curve length. */}
        <path
          className="elvl-route-head"
          d={FLIGHT}
          pathLength="1000"
          stroke="url(#elvl-head)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="56 944"
        />
      </g>
    </svg>
  );
}

// Top-view commercial airliner. Drawn to real proportions — slender fuselage,
// defined nose, swept wings with underslung nacelles, swept tailplane and fin —
// so it reads as an aircraft at 54px and not as an arrow. Nose points up; the
// animation rotates the whole element to the heading.
function Airliner({ planeRef }) {
  return (
    <svg ref={planeRef} className="elvl-mark-plane elvl-scene-detail" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="elvl-skin" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0%" stopColor="var(--elvl-plane-lit)" />
          <stop offset="52%" stopColor="var(--elvl-scene-plane)" />
          <stop offset="100%" stopColor="var(--elvl-plane-shade)" />
        </linearGradient>
      </defs>
      <g fill="url(#elvl-skin)" stroke="var(--elvl-plane-edge)" strokeWidth="0.6" strokeLinejoin="round">
        {/* Wings, swept back from the forward fuselage to the tips. */}
        <path d="M26.6 24.2 2.6 41.2v3.9l24-5.9h12.8l24 5.9v-3.9l-24-17Z" />
        {/* Tailplane. */}
        <path d="M28.4 49.4 15.6 57v2.6l12.8-3.4h7.2l12.8 3.4V57l-12.8-7.6Z" />
        {/* Fuselage, nose to tailcone. */}
        <path d="M32 1.8c2.9 0 4.9 4.1 5.1 9.3l.5 38.2-1 8.1L32 62.2l-4.6-4.8-1-8.1.5-38.2c.2-5.2 2.2-9.3 5.1-9.3Z" />
      </g>
      {/* Engine nacelles. */}
      <g fill="var(--elvl-plane-shade)" stroke="var(--elvl-plane-edge)" strokeWidth="0.5">
        <rect x="15.6" y="32.4" width="5.6" height="10.4" rx="2.8" />
        <rect x="42.8" y="32.4" width="5.6" height="10.4" rx="2.8" />
      </g>
      {/* Spine highlight: the only lighting detail, enough to give volume. */}
      <path d="M32 6.4c1.3 0 2 2.4 2.1 5.2l.3 36h-4.8l.3-36c.1-2.8.8-5.2 2.1-5.2Z"
            fill="var(--elvl-plane-lit)" opacity="0.5" />
    </svg>
  );
}

// The three figurative marks. Positioned in percentages so they land exactly
// where the mockup puts them, but each drawn in its own square SVG so the
// non-uniform scale of the layers above never distorts them.
function Marks({ planeRef }) {
  return (
    <div className="elvl-marks" aria-hidden="true">
      <span className="elvl-mark-dot elvl-scene-dot" />
      <Airliner planeRef={planeRef} />
      <span className="elvl-mark-ring" />
      <svg className="elvl-mark-cross elvl-scene-detail" viewBox="0 0 24 24" aria-hidden="true">
        <g fill="none" stroke="var(--elvl-scene-mark)" strokeWidth="0.9">
          <path d="M0 12h6.5m11 0H24M12 0v6.5m0 11V24" />
          <circle cx="12" cy="12" r="4.6" strokeOpacity="0.5" />
        </g>
      </svg>
    </div>
  );
}

export default function LoginPage({ onSubmit = async () => {}, notice = '' }) {
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const t = getLoginMessages(language);

  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [shakeNonce, setShakeNonce] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'busy' | 'done'
  const [ripple, setRipple] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const rootRef = useRef(null);
  const flightRef = useRef(null);
  const planeRef = useRef(null);
  const submitRef = useRef(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Background-only parallax plus the cursor-reactive ambient light. The card
  // never moves. One listener feeds a ref; a single rAF flushes four custom
  // properties per frame, so a burst of pointer events still costs one write.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (window.matchMedia?.('(pointer: coarse)').matches) return undefined;

    let frame = 0;
    const next = { x: 0, y: 0, mx: 50, my: 50 };

    const flush = () => {
      frame = 0;
      root.style.setProperty('--elvl-px', `${next.x}px`);
      root.style.setProperty('--elvl-py', `${next.y}px`);
      root.style.setProperty('--elvl-mx', `${next.mx}%`);
      root.style.setProperty('--elvl-my', `${next.my}%`);
    };

    const handleMove = event => {
      const rx = event.clientX / window.innerWidth;
      const ry = event.clientY / window.innerHeight;
      next.x = (rx - 0.5) * -2 * PARALLAX_RANGE;
      next.y = (ry - 0.5) * -2 * PARALLAX_RANGE;
      next.mx = rx * 100;
      next.my = ry * 100;
      if (!frame) frame = window.requestAnimationFrame(flush);
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Flies the aircraft along the route path. The SVG is stretched
  // (preserveAspectRatio="none"), so the point is sampled in viewBox space and
  // converted to viewport percentages by hand; the heading is then measured in
  // SCREEN pixels, which is the only way the nose stays on the direction of
  // travel once the horizontal and vertical scales differ.
  useEffect(() => {
    const path = flightRef.current;
    const plane = planeRef.current;
    if (!path || !plane || typeof window === 'undefined') return undefined;
    // Not every environment implements SVGGeometryElement: jsdom does not, and
    // neither do very old engines. The CSS fallback already places the aircraft.
    if (typeof path.getTotalLength !== 'function' || typeof path.getPointAtLength !== 'function') {
      return undefined;
    }

    const VB = 1060; // viewBox span, offset -30 to cancel the planes' -3% inset
    const toPct = v => ((v + 30) / VB) * 106 - 3;

    // Fades in over the first stretch and out over the last, so the wrap back
    // to the stand is never seen as a jump.
    const fade = t => Math.min(1, t / 0.07, (1 - t) / 0.07);

    const place = distance => {
      const total = path.getTotalLength();
      if (!total) return;
      const d = distance % total;
      const a = path.getPointAtLength(d);
      const b = path.getPointAtLength((d + total * 0.004) % total);
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      // Heading in screen space, then +90deg because the glyph points up.
      const angle = Math.atan2((toPct(b.y) - toPct(a.y)) * h, (toPct(b.x) - toPct(a.x)) * w);
      plane.style.left = `${toPct(a.x)}%`;
      plane.style.top = `${toPct(a.y)}%`;
      plane.style.setProperty('--elvl-plane-rot', `${(angle * 180) / Math.PI + 90}deg`);
      plane.style.opacity = fade(d / total);
    };

    const DURATION = 46000;
    const narrow = window.matchMedia?.('(max-width: 900px)');
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    let frame = 0;
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };

    // Which of the three modes applies depends on the viewport, so it has to be
    // re-decided whenever that changes: a window resized from desktop width
    // down to a phone must stop flying, or the aircraft crosses the card.
    const apply = () => {
      stop();
      if (narrow?.matches) {
        // The card is nearly full-bleed here, so no stretch of the route is
        // clear of it. The aircraft parks in the free band below, on the
        // departure heading.
        plane.style.left = '79%';
        plane.style.top = '93%';
        plane.style.setProperty('--elvl-plane-rot', '32deg');
        plane.style.opacity = '1';
        return;
      }
      if (still?.matches) {
        place(path.getTotalLength() * 0.62);
        plane.style.opacity = '1';
        return;
      }
      let start = 0;
      const tick = now => {
        if (!start) start = now;
        const total = path.getTotalLength();
        place((((now - start) % DURATION) / DURATION) * total);
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    };

    apply();
    narrow?.addEventListener('change', apply);
    still?.addEventListener('change', apply);
    return () => {
      stop();
      narrow?.removeEventListener('change', apply);
      still?.removeEventListener('change', apply);
    };
  }, []);

  const busy = status !== 'idle';

  // Same shape as the contracts form modals: clearing the field's error lives
  // inside the updater, so typing always dismisses the message it caused.
  const update = useCallback((field, value) => {
    setValues(current => ({ ...current, [field]: value }));
    setErrors(current => (current[field] ? { ...current, [field]: undefined } : current));
  }, []);

  const validate = useCallback(
    ({ email, password }) => {
      const next = {};
      if (!email.trim()) next.email = t.errorEmailRequired;
      else if (!EMAIL_PATTERN.test(email.trim())) next.email = t.errorEmailInvalid;
      if (!password) next.password = t.errorPasswordRequired;
      return next;
    },
    [t],
  );

  const handleSubmit = e => {
    e.preventDefault();
    if (busy) return;

    const nextErrors = validate(values);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setShakeNonce(n => n + 1);
      return;
    }

    const rect = submitRef.current.getBoundingClientRect();
    setRipple({ id: Date.now(), x: rect.width / 2, y: rect.height / 2 });
    setStatus('busy');
    setErrorMessage('');

    Promise.resolve(onSubmit({ email: values.email, password: values.password, remember }))
      .then(() => {
        setStatus('done');
        timers.current.push(setTimeout(() => setStatus('idle'), 1200));
      })
      .catch(error => {
        setStatus('idle');
        setRipple(null);
        setErrorMessage(error?.message ?? t.genericError);
      });
  };

  const submitLabel = useMemo(() => {
    if (status === 'busy') return t.submitBusy;
    if (status === 'done') return t.submitDone;
    return t.submitIdle;
  }, [status, t]);

  // useTheme only exposes a toggle; selecting a theme flips it only when it is
  // not already the requested one, so the shared hook keeps its API.
  const selectTheme = next => {
    if (theme !== next) toggleTheme();
  };

  const shakeName = shakeNonce % 2 === 0 ? 'elvl-shake-a' : 'elvl-shake-b';
  const fieldStyle = invalid => (invalid ? { animationName: shakeName } : undefined);

  return (
    <div className="elvl-root" ref={rootRef}>
      <div className="elvl-decor" aria-hidden="true">
        <div className="elvl-plane elvl-plane--atmosphere">
          <div className="elvl-grain" />
        </div>
        <div className="elvl-plane elvl-plane--geometry">
          <Geometry />
        </div>
        <div className="elvl-plane elvl-plane--ops">
          <FlightPath flightRef={flightRef} />
        </div>
        <Marks planeRef={planeRef} />
        <div className="elvl-plane elvl-plane--light">
          <div className="elvl-glow elvl-glow--blue" />
          <div className="elvl-glow elvl-glow--orange" />
          <div className="elvl-cursor-light" />
        </div>
      </div>

      <header className="elvl-topbar">
        <img src={MARK[theme] ?? MARK.light} alt={t.brandAlt} className="elvl-mark" />

        <div className="elvl-controls">
          <Segmented
            className="elvl-seg--lang"
            label={t.languageLabel}
            value={language}
            onSelect={setLanguage}
            options={[
              { value: 'es', label: t.spanishLabel, content: 'ES' },
              { value: 'en', label: t.englishLabel, content: 'EN' },
            ]}
          />
          <Segmented
            className="elvl-seg--theme"
            label={t.themeLabel}
            value={theme}
            onSelect={selectTheme}
            options={[
              { value: 'light', label: t.lightModeLabel, content: <SunIcon /> },
              { value: 'dark', label: t.darkModeLabel, content: <MoonIcon /> },
            ]}
          />
        </div>
      </header>

      <div className="elvl-tagline" aria-hidden="true">
        <div className="elvl-rule" />
        <p className="elvl-micro">
          {t.taglineLines.map(line => (
            <span key={line} style={{ display: 'block' }}>{line}</span>
          ))}
        </p>
      </div>

      <div className="elvl-footnote" aria-hidden="true">
        <div className="elvl-rule" />
        <p className="elvl-micro">{t.footnote}</p>
      </div>

      <div className="elvl-stage">
        <div className="elvl-card-halo" aria-hidden="true" />

        <main className="elvl-card">
          <span className="elvl-card-sweep" aria-hidden="true" />
          <div className="elvl-card-body">
            <div className="elvl-card-head">
              <img src={MARK[theme] ?? MARK.light} alt={t.brandAlt} className="elvl-card-mark" />
              <h1 className="elvl-title">
                {t.welcomePrefix}
                <span className="elvl-title-brand">{t.welcomeBrand}</span>
              </h1>
              <p className="elvl-subtitle">{t.subtitle}</p>
            </div>

            <form className="elvl-form" onSubmit={handleSubmit} noValidate>
              <div>
                <div
                  className={`elvl-field${errors.email ? ' elvl-field--invalid' : ''}`}
                  style={fieldStyle(errors.email)}
                >
                  <label className="elvl-sr-only" htmlFor="elvl-email">{t.emailLabel}</label>
                  <MailIcon className="elvl-field-icon" />
                  <input
                    id="elvl-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder={t.emailLabel}
                    className="elvl-input"
                    value={values.email}
                    onChange={e => update('email', e.target.value)}
                    aria-invalid={errors.email ? 'true' : undefined}
                    aria-describedby={errors.email ? 'elvl-email-error' : undefined}
                  />
                </div>
                {errors.email && (
                  <p className="elvl-field-error" id="elvl-email-error">{errors.email}</p>
                )}
              </div>

              <div>
                <div
                  className={`elvl-field${errors.password ? ' elvl-field--invalid' : ''}`}
                  style={fieldStyle(errors.password)}
                >
                  <label className="elvl-sr-only" htmlFor="elvl-password">{t.passwordLabel}</label>
                  <LockIcon className="elvl-field-icon" />
                  <input
                    id="elvl-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder={t.passwordLabel}
                    className="elvl-input elvl-input--password"
                    value={values.password}
                    onChange={e => update('password', e.target.value)}
                    aria-invalid={errors.password ? 'true' : undefined}
                    aria-describedby={errors.password ? 'elvl-password-error' : undefined}
                  />
                  <button
                    type="button"
                    className="elvl-eye"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
                {errors.password && (
                  <p className="elvl-field-error" id="elvl-password-error">{errors.password}</p>
                )}
              </div>

              <div className="elvl-options">
                <label className="elvl-remember">
                  <input
                    type="checkbox"
                    className="elvl-checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                  />
                  {t.remember}
                </label>
                <a href="#" className="elvl-link">{t.forgot}</a>
              </div>

              {errorMessage && <div role="alert" className="elvl-alert">{errorMessage}</div>}
              {notice && <p role="status" className="elvl-notice">{notice}</p>}

              <button ref={submitRef} type="submit" disabled={busy} className="elvl-submit">
                {status === 'done' && <span className="elvl-submit-done" />}
                {ripple && (
                  <span
                    key={ripple.id}
                    className="elvl-submit-ripple"
                    style={{ left: ripple.x - 60, top: ripple.y - 60 }}
                  />
                )}
                <span className="elvl-submit-inner">
                  {status === 'busy' && <span className="elvl-spinner" />}
                  {status === 'done' && <CheckIcon />}
                  <span>{submitLabel}</span>
                  {status === 'idle' && <ArrowIcon />}
                </span>
              </button>
            </form>

            <div className="elvl-hr" />

            <div className="elvl-trust">
              <ShieldCheckIcon />
              {t.secureAccess}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
