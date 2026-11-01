// Placeholder shapes shown while a page renders on the server, so navigation answers instantly.
export function Bone({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-mist/80 ${className}`} aria-hidden />;
}

export function PageSkeleton({ variant = "list" }: { variant?: "list" | "grid" | "chat" | "table" }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center gap-4">
        <Bone className="h-12 w-12 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Bone className="h-8 w-2/3 max-w-sm" />
          <Bone className="h-4 w-full max-w-lg" />
        </div>
      </div>
      {variant === "grid" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="clay space-y-3 p-5">
              <div className="flex items-center gap-3">
                <Bone className="h-11 w-11 rounded-full" />
                <Bone className="h-5 flex-1" />
              </div>
              <Bone className="h-4 w-5/6" />
              <Bone className="h-10" />
            </div>
          ))}
        </div>
      )}
      {variant === "chat" && (
        <div className="clay space-y-4 p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`flex ${i % 2 ? "justify-end" : ""}`}>
              <Bone className={`h-12 ${i % 3 ? "w-1/2" : "w-2/3"} rounded-3xl`} />
            </div>
          ))}
          <Bone className="h-12 rounded-full" />
        </div>
      )}
      {variant === "table" && (
        <>
          <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
            <div className="clay space-y-3 p-6">
              {Array.from({ length: 4 }, (_, i) => (
                <Bone key={i} className="h-6" />
              ))}
            </div>
            <div className="clay space-y-3 p-6">
              <Bone className="h-10 w-1/2" />
              <Bone className="h-12 rounded-full" />
            </div>
          </div>
          <div className="clay space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Bone key={i} className="h-8 rounded-xl" />
            ))}
          </div>
        </>
      )}
      {variant === "list" && (
        <>
          <div className="clay flex justify-between gap-2 p-5">
            {Array.from({ length: 7 }, (_, i) => (
              <Bone key={i} className="h-14 w-14 rounded-full" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="clay flex items-center gap-4 p-5">
                <Bone className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-5 w-1/2" />
                  <Bone className="h-4 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
