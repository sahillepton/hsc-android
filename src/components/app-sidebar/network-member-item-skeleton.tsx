export default function NetworkMemberItemSkeleton() {
  return (
    <div className="py-2 border-b border-border/20 last:border-b-0">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="h-3 w-20 rounded bg-zinc-200 animate-pulse" />
          <div className="h-3 w-24 rounded bg-zinc-100 animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-16 rounded bg-zinc-200 animate-pulse" />
          <div className="h-3 w-32 rounded bg-zinc-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
