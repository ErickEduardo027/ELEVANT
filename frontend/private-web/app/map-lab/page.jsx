import { notFound } from 'next/navigation';

// The map lab (src/features/maps/lab): fixed scenes of the OCC map for the visual suite, with no session and no API.
// Development only. The lab is imported inside the development branch, which the production build drops together
// with its import, so the lab never enters the production bundle (scripts/verify-map-chunks.mjs checks every build);
// a production server answers this route with the 404 page.
export default async function MapLabPage() {
  if (process.env.NODE_ENV === 'development') {
    const { default: MapLabLoader } = await import('./MapLabLoader');
    return <MapLabLoader />;
  }
  notFound();
}
