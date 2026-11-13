import Image from 'next/image';
import { preload } from 'react-dom';
import styles from './OccBootScreen.module.css';

// The official isotype for a dark ground (white and orange), the one the rail shows (OccSidebar's mark): the boot
// screen is always the dark canvas, and one download serves both.
export const OCC_BOOT_ISOTYPE_SRC = '/brand/elevant-mark-dark.png';

/**
 * Asks the browser for the isotype from the page's <head> (`<link rel="preload">`, also in the server render), so the
 * screen's entry never waits for it after a login. Called while OccBootProvider renders, as Next documents
 * ReactDOM.preload; repeated calls are one hint.
 */
export function preloadOccBootIsotype() {
  preload(OCC_BOOT_ISOTYPE_SRC, { as: 'image' });
}

// Inline, so that no stylesheet can delay it: a leaving screen never takes a click.
const LETS_CLICKS_THROUGH = Object.freeze({ pointerEvents: 'none' });

// «Rutas que se trazan»: air routes on a 1600 × 900 chart, as quadratic arcs that turn around the centre clockwise and
// leave it clear for the logo. Each route is drawn from its first point to its last; `origin` and `stop` are the ends
// that sit inside the chart, drawn as airports. Two routes share an airport on each side.
const ROUTES = Object.freeze([
  { className: styles.route1, d: 'M-80 360Q780-110 1680 230' },
  { className: styles.route2, d: 'M1452 352Q1530 640 1236 812', origin: [1452, 352], stop: [1236, 812] },
  { className: styles.route3, d: 'M150 640Q180 360 432 262', origin: [150, 640], stop: [432, 262] },
  { className: styles.route4, d: 'M1680 600Q960 500 260 990' },
  { className: styles.route5, d: 'M1064 150Q1236 70 1386 214', origin: [1064, 150], stop: [1386, 214] },
  { className: styles.route6, d: 'M472 818Q330 700 196 772', origin: [472, 818], stop: [196, 772] },
  { className: styles.route7, d: 'M1680 40Q1590 250 1452 352', stop: [1452, 352] },
  { className: styles.route8, d: 'M-80 120Q180 120 432 262', stop: [432, 262] },
]);

const AIRPORT_RADIUS = 2;

// Static, so it is built once: the screen re-renders only when its phase or its progress changes.
const BACKGROUND = (
  <svg className={styles.routes} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
    {ROUTES.map(route => (
      <g key={route.d} className={route.className}>
        <path className={styles.trace} d={route.d} pathLength="1" data-occ-boot-part="route" />
        {route.origin ? (
          <circle className={styles.origin} cx={route.origin[0]} cy={route.origin[1]} r={AIRPORT_RADIUS} />
        ) : null}
        {route.stop ? <circle className={styles.stop} cx={route.stop[0]} cy={route.stop[1]} r={AIRPORT_RADIUS} /> : null}
      </g>
    ))}
  </svg>
);

/**
 * The OCC boot screen (contratos 2.6, owner decision 14): the isotype and the logo «ELEVANT · OCC» in the centre, a thin
 * progress line that follows the orchestrator (`progress`: session, access, screen, complete) and, behind, thin air
 * routes that are drawn and fade out. No lists and no figures. It covers the page from the session check until the
 * first screen is ready, and renders outside ShellFrame, so it carries the OCC scope (`data-department`) and therefore
 * its dark tokens itself. It is hidden from assistive technology, which hears the provider's announcement and the
 * plain loading screens underneath. From the moment it starts leaving (`phase`), clicks reach the console while the
 * logo and the canvas fade out over it.
 */
export default function OccBootScreen({ phase, progress }) {
  return (
    <div
      data-testid="occ-boot-screen"
      data-department="occ"
      data-occ-boot-phase={phase}
      data-occ-boot-progress={progress}
      aria-hidden="true"
      className={styles.root}
      style={phase === 'leaving' ? LETS_CLICKS_THROUGH : undefined}
    >
      {BACKGROUND}
      <div className={styles.brand}>
        <Image src={OCC_BOOT_ISOTYPE_SRC} alt="" width={560} height={401} loading="eager" draggable={false}
          className={styles.isotype} data-occ-boot-part="isotype" />
        <p className={styles.wordmark} data-occ-boot-part="wordmark">
          ELEVANT <span className={styles.unit}>· OCC</span>
        </p>
        <div className={styles.track} data-occ-boot-part="progress">
          <div className={styles.bar} data-occ-boot-part="bar" />
        </div>
      </div>
    </div>
  );
}
