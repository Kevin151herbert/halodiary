import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:bg-ink/90 disabled:opacity-50",
  halo: "inline-flex items-center justify-center gap-2 rounded-full bg-halo px-5 py-2.5 text-sm font-bold text-ink transition hover:brightness-95 disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-full border border-mist bg-card px-4 py-2 text-sm font-bold text-ink transition hover:border-ink/30 disabled:opacity-50",
  quiet: "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-slate hover:bg-mist/60 hover:text-ink",
};

export function ButtonLink({ variant = "primary", ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof btn }) {
  return <Link {...props} className={`${btn[variant]} ${props.className ?? ""}`} />;
}

/** Initials on a soft colour, so demo providers need no photos. */
export function Avatar({ name, hue, size = 44 }: { name: string; hue: number; size?: number }) {
  const initials = name
    .replace(/\./g, "")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `hsl(${hue} 55% 90%)`,
        color: `hsl(${hue} 45% 28%)`,
      }}
    >
      {initials}
    </span>
  );
}

export function Rating({ value, count }: { value: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden className="text-halo">
        <path fill="currentColor" d="M10 1.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L1.4 7.8l6-.8z" />
      </svg>
      <span className="font-bold">{Number(value).toFixed(1)}</span>
      {count != null && <span className="text-slate">({count})</span>}
    </span>
  );
}

/** The halo: a ring whose arc fills with the share of a day that is booked. */
export function Halo({
  fill,
  size = 56,
  animate = false,
  children,
  label,
}: {
  fill: number;
  size?: number;
  animate?: boolean;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <span
      className={`halo-ring inline-flex ${animate ? "animate" : ""}`}
      style={{ ["--fill" as string]: Math.max(0, Math.min(1, fill)), width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <span className="flex h-full w-full flex-col items-center justify-center leading-none">{children}</span>
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-mist bg-card ${className}`}>{children}</div>;
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    scheduled: ["On the diary", "bg-mist text-slate"],
    awaiting: ["Needs your answer", "bg-rose-soft text-rose"],
    confirmed: ["Confirmed, payment held", "bg-sage-soft text-sage"],
    completed: ["Done and paid", "bg-sage text-white"],
    skipped: ["Skipped, no charge", "bg-mist text-slate"],
    cancelled: ["Moved", "bg-mist text-slate"],
  };
  const [label, cls] = map[status] ?? [status, "bg-mist text-slate"];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{label}</span>;
}

export function money(amount: number, currency = "EUR") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <circle cx="13" cy="13" r="10" fill="none" stroke="var(--mist)" strokeWidth="4" />
        <circle
          cx="13"
          cy="13"
          r="10"
          fill="none"
          stroke="var(--halo)"
          strokeWidth="4"
          strokeDasharray="44 63"
          strokeLinecap="round"
          transform="rotate(-90 13 13)"
        />
      </svg>
      HaloDiary
    </span>
  );
}
