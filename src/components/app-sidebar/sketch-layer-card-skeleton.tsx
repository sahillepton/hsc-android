export default function SketchLayerCardSkeleton() {
  return (
    <div className="mb-3">
      <div className="relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm">
        {/* Top row - action buttons */}
        <div className="absolute right-3 top-3 flex items-center gap-1">
          <div className="h-7 w-7 rounded-full bg-zinc-100 animate-shimmer" />
          <div className="h-7 w-7 rounded-full bg-zinc-100 animate-shimmer" />
          <div className="h-7 w-7 rounded-full bg-zinc-100 animate-shimmer" />
        </div>

        {/* Content */}
        <div className="min-w-0 pr-14">
          {/* Header with checkbox and name */}
          <div className="flex items-start gap-2 mb-2">
            <div className="h-4 w-4 shrink-0 rounded bg-zinc-100 animate-shimmer mt-1" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-4 w-32 rounded-full bg-zinc-100 animate-shimmer" />
              <div className="h-3 w-12 rounded-full bg-zinc-100 animate-shimmer" />
            </div>
          </div>

          {/* Measurements grid skeleton */}
          <div className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-2">
            <div className="flex flex-col gap-2">
              <div className="h-3.5 w-20 rounded-full bg-zinc-100 animate-shimmer" />
              <div className="h-3 w-16 rounded-full bg-zinc-100 animate-shimmer" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-3.5 w-24 rounded-full bg-zinc-100 animate-shimmer" />
              <div className="h-3 w-20 rounded-full bg-zinc-100 animate-shimmer" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-3.5 w-18 rounded-full bg-zinc-100 animate-shimmer" />
              <div className="h-3 w-14 rounded-full bg-zinc-100 animate-shimmer" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-3.5 w-22 rounded-full bg-zinc-100 animate-shimmer" />
              <div className="h-3 w-18 rounded-full bg-zinc-100 animate-shimmer" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
