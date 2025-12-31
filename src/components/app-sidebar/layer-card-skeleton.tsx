export default function LayerCardSkeleton() {
  return (
    <div className="mb-3">
      <div className="relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm">
        {/* Top row - action buttons */}
        <div className="absolute right-3 top-3 flex items-center gap-1">
          <div className="h-7 w-7 rounded-full bg-zinc-100 animate-shimmer" />
          <div className="h-7 w-7 rounded-full bg-zinc-100 animate-shimmer" />
          <div className="h-7 w-7 rounded-full bg-zinc-100 animate-shimmer" />
          <div className="h-7 w-7 rounded-full bg-zinc-100 animate-shimmer" />
        </div>

        {/* Content */}
        <div className="min-w-0 pr-14">
          <div className="flex items-start gap-2 mb-2">
            <div className="h-4 w-4 shrink-0 rounded bg-zinc-100 animate-shimmer" />
            <div className="h-4 w-32 rounded-full bg-zinc-100 animate-shimmer" />
          </div>
          <div className="h-3 w-24 rounded-full bg-zinc-100 animate-shimmer" />
        </div>
      </div>
    </div>
  );
}
