"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While PayPal has not yet confirmed a step, refresh every 6 seconds for up to 90 seconds so the tick appears by itself. */
export function TrailRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      router.refresh();
      if (n >= 15) clearInterval(t);
    }, 6000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
