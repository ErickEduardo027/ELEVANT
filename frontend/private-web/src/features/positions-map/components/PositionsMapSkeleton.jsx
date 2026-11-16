export default function PositionsMapSkeleton() {
  return (
    <div data-testid="positions-map-skeleton" className="flex flex-1 flex-col gap-4">
      <div className="h-24 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
      <div className="min-h-[420px] flex-1 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
    </div>
  );
}
