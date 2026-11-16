'use client';

// The OCC console. Its route is in this page's chunk and starts the console's reads as soon as the session and the
// department access let it render; the view with the map engine loads beside them, client only (ConsoleRoute.jsx).
import ConsoleRoute from '../../../src/features/dashboard/noc/ConsoleRoute';

export default function Page() { return <ConsoleRoute />; }
