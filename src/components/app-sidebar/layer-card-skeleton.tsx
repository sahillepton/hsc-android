export default function LayerCardSkeleton() {
  return (
    // pb-3, not mb-3 — this is a react-virtuoso item root, and virtuoso measures
    // its wrapper with getBoundingClientRect().height, which EXCLUDES a child's
    // margin (the margin collapses through the wrapper's bottom edge). A margin
    // here makes every row measure 12 px short, so the list's scroll range ends up
    // 12 px × N too small: the last card can't scroll fully into view and fast
    // scrolls overshoot the computed end. Padding sits inside the border box and
    // is measured, with the same 12 px gap. Must match the real card's spacing.
    <div className="pb-3">
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
