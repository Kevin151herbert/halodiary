"use client";

import { CalendarHeart, Compass, FileSignature, History, Settings, Store, Wallet } from "lucide-react";
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
          { href: "/app/agreements", label: "Agreements", icon: FileSignature },
          { href: "/app/provider", label: "Provider view", icon: Store },
          { href: "/app/activity", label: "Activity", icon: History },
          { href: "/app/settings", label: "Settings", icon: Settings },
        ]
      : [
          { href: "/app/provider", label: "My visits", icon: CalendarHeart, badge: unread },
          { href: "/app/agreements", label: "Agreements", icon: FileSignature },
          { href: "/app/activity", label: "Activity", icon: History },
          { href: "/app/settings", label: "Settings", icon: Settings },
        ];

  const active = (href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));

  if (compact) {
    return (
      <nav className="flex justify-around px-1.5 py-1.5" aria-label="Main">
        {items.slice(0, 5).map(({ href, label, icon: Icon, badge }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={`relative flex flex-col items-center gap-0.5 rounded-2xl px-2.5 py-1.5 text-[11px] font-bold transition ${
              active(href) ? "clay-btn-ink" : "text-slate"
            }`}
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
          className={`flex items-center gap-3 rounded-2xl px-2 py-2 text-sm font-bold transition ${
            active(href) ? "clay-sm text-ink" : "text-slate hover:text-ink"
          }`}
        >
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${active(href) ? "clay-btn-ink" : "clay-tile"}`}
            aria-hidden
          >
            <Icon size={17} />
          </span>
          <span className="flex-1">{label}</span>
          {!!badge && <span className="rounded-full bg-rose px-1.5 text-[11px] text-white">{badge}</span>}
        </Link>
      ))}
    </nav>
  );
}
