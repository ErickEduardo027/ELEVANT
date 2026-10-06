const base = '/';

// The silhouettes use alpha masks cut from the official isotype asset (same
// bars, slant and wing cut-out, no redrawing): one for the two blue bars and
// one for the lower bar. Each silhouette is built from four stacked layers
// (soft cast shadow, lit edge, tonal body, faint accent) so it reads as a
// relief in the surface instead of a flat logo.
const MASK_MAIN = `url(${base}brand/elevant-silhouette-main.png)`;
const MASK_ACCENT = `url(${base}brand/elevant-silhouette-accent.png)`;

function Silhouette({ className }) {
  const style = { '--elv-mask-main': MASK_MAIN, '--elv-mask-accent': MASK_ACCENT };
  return (
    <div className={`elv-sil ${className}`} style={style}>
      <span className="elv-sil-layer elv-sil-shadow" />
      <span className="elv-sil-layer elv-sil-edge" />
      <span className="elv-sil-layer elv-sil-body" />
      <span className="elv-sil-layer elv-sil-accent" />
    </div>
  );
}

// Wide, soft diagonal planes that follow the isotype slant (tonal depth only).
const SLOPE = 58 / 128;
const H = 1086;
function band(x, width) {
  const run = SLOPE * H;
  return `M${x} 0 L${x + width} 0 L${x + width - run} ${H} L${x - run} ${H} Z`;
}

export default function AuthBackground() {
  return (
    <div className="elv-bg" aria-hidden="true">
      <div className="elv-bg-layer elv-bg-layer--light" />
      <div className="elv-bg-layer elv-bg-layer--dark" />
      <div className="elv-bg-glow" />
      <svg className="elv-bg-svg" viewBox="0 0 1448 1086" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="elv-band-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" className="elv-band-a" />
            <stop offset="1" className="elv-band-b" />
          </linearGradient>
        </defs>
        <path className="elv-band" d={band(560, 420)} />
        <path className="elv-band elv-band--soft" d={band(1180, 260)} />
        <g className="elv-bg-plane" transform="translate(1220 102)">
          <path transform="rotate(45) scale(1.45) translate(-12 -12)" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
        </g>
      </svg>
      <Silhouette className="elv-sil--main" />
      <Silhouette className="elv-sil--second" />
    </div>
  );
}
