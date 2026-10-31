"use client";

import { CalendarHeart, Compass, History, Settings, Store, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ role, unread, compact = false }: { role: "client" | "provider"; unread: number; compact?: boolean }) {
  const path = usePathname();
  const items =
    role === "client"
      ? [
          { href: "/app", label: "Diary", icon: CalendarHeart, badge: unread },
          { href: "/app/discover", label: "Discover", icon: Compass },
          { href: "/app/budget", label: "Budget", icon: Wallet },
          { href: "/app/provider", label: "Provider view", icon: Store },
          { href: "/app/activity", label: "Activity", icon: History },
          { href: "/app/settings", label: "Settings", icon: Settings },
        ]
      : [
          { href: "/app/provider", label: "My visits", icon: CalendarHeart, badge: unread },
          { href: "/app/activity", label: "Activity", icon: History },
          { href: "/app/settings", label: "Settings", icon: Settings },
        ];

  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));

  if (compact) {
    return (
      <nav className="flex justify-around px-1 py-1.5" aria-label="Main">
        {items.slice(0, 5).map(({ href, label, icon: Icon, badge }) => (
          <Link
            key={href}
            href={href}
            className={`relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[11px] font-bold ${active(href) ? "text-ink" : "text-slate"}`}
          >
            <Icon size={20} aria-hidden />
            {label.split(" ")[0]}
            {!!badge && <span className="absolute right-1 top-0 h-2 w-2 rounded-full bg-rose" aria-label={`${badge} unread`} />}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="mt-10 flex flex-col gap-1" aria-label="Main">
      {items.map(({ href, label, icon: Icon, badge }) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
            active(href) ? "bg-ink text-white" : "text-slate hover:bg-paper hover:text-ink"
          }`}
        >
          <Icon size={18} aria-hidden />
          <span className="flex-1">{label}</span>
          {!!badge && <span className="rounded-full bg-rose px-1.5 text-[11px] text-white">{badge}</span>}
        </Link>
      ))}
    </nav>
  );
}
