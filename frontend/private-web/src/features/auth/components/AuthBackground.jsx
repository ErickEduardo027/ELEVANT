// Ambient airport-geometry backdrop. All colors come from CSS variables
// (see LoginPage.css) so Light and Dark share one geometry but not one palette.
export default function AuthBackground() {
  return (
    <div className="elv-bg" aria-hidden="true">
      <svg className="elv-bg-svg" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="elv-slab-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="elv-stop-slab-a" />
            <stop offset="1" className="elv-stop-slab-b" />
          </linearGradient>
          <linearGradient id="elv-band-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="elv-stop-band-a" />
            <stop offset="1" className="elv-stop-band-b" />
          </linearGradient>
          <linearGradient id="elv-edge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="elv-stop-edge-a" />
            <stop offset="1" className="elv-stop-edge-b" />
          </linearGradient>
        </defs>

        <path className="elv-bg-panel-top" d="M0 0H478C410 190 320 360 200 470C140 522 60 524 0 470Z" />
        <path className="elv-bg-panel-right" d="M1536 400C1480 520 1400 650 1320 700C1230 755 1175 790 1130 865C1085 940 1040 1000 1000 1024H1536Z" />

        <path className="elv-bg-line elv-bg-line--soft" d="M478 0C410 190 320 360 200 470C140 522 60 524 0 470" />
        <path className="elv-bg-line elv-bg-line--soft" d="M1175 0L1045 205" />
        <path className="elv-bg-line elv-bg-line--soft" d="M1536 400C1480 520 1400 650 1320 700C1230 755 1175 790 1130 865C1085 940 1040 1000 1000 1024" />

        <path className="elv-bg-band" d="M0 462L566 1024H0Z" />
        <path className="elv-bg-slab" d="M0 578L446 1024H0Z" />
        <path className="elv-bg-line elv-bg-line--edge" d="M0 462L566 1024" />
        <path className="elv-bg-line elv-bg-line--glow" d="M0 578L446 1024" />
        <path className="elv-bg-line elv-bg-line--orange" d="M0 490L236 736" />

        <path className="elv-bg-line elv-bg-line--decor" d="M1275 332L1045 540" />
        <path className="elv-bg-line elv-bg-line--decor" d="M1460 240C1430 322 1350 372 1220 392" />
        <circle className="elv-bg-dot" cx="1460" cy="238" r="5" />
        <g className="elv-bg-cross">
          <path d="M1384 433H1418M1401 416V450" />
          <circle cx="1401" cy="433" r="2.5" />
        </g>
        <g className="elv-bg-plane" transform="translate(1293 310)">
          <g className="elv-bg-plane-drift">
            <path transform="rotate(45) scale(1.5) translate(-12 -12)" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
          </g>
        </g>
      </svg>
    </div>
  );
}
