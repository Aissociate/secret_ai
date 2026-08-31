export function SkeletonCard() {
  return (
    <div className="border border-white/[0.06] rounded-2xl p-4 space-y-3">
      <div className="flex gap-3 items-center">
        <div className="skeleton w-12 h-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-3 w-16" />
        </div>
      </div>
      <div className="skeleton h-2 w-full rounded-full" />
      <div className="skeleton h-8 w-20 rounded-lg" />
    </div>
  );
}

export function SkeletonFeed() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border border-white/[0.06] rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="skeleton h-3.5 w-3.5 rounded" />
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-3 w-10 ml-auto" />
          </div>
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}
