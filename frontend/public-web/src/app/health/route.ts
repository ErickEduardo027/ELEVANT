export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return Response.json(
    {
      application: "Elevant.PublicWeb",
      status: "ok",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
