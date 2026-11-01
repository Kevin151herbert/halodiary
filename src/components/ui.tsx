import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const btn = {
  primary: "clay-btn-ink inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50",
  halo: "clay-btn-halo inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50",
  ghost: "clay-btn-ghost inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50",
  quiet: "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-slate transition hover:bg-white/70 hover:text-ink",
};

/** Text inputs and selects pressed into the surface. */
export const field = "clay-inset w-full px-4 py-3 text-sm font-normal";

export function ButtonLink({ variant = "primary", ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof btn }) {
  return <Link {...props} className={`${btn[variant]} ${props.className ?? ""}`} />;
}

/** Initials on a soft colour, so demo providers need no photos. */
export function Avatar({ name, hue, size = 44, photo }: { name: string; hue: number; size?: number; photo?: string | null }) {
  if (photo)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, boxShadow: "4px 5px 10px -3px rgba(29,34,56,0.3), inset 1px 1px 2px rgba(255,255,255,0.9)" }}
      />
    );
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
        background: `linear-gradient(145deg, hsl(${hue} 70% 94%), hsl(${hue} 50% 84%))`,
        color: `hsl(${hue} 45% 26%)`,
        boxShadow: `4px 5px 10px -3px hsl(${hue} 30% 40% / 0.35), inset 1px 1px 2px rgba(255,255,255,0.9), inset -2px -2px 4px hsl(${hue} 40% 50% / 0.15)`,
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
  return <div className={`clay ${className}`}>{children}</div>;
}

/** A soft gradient tile holding an icon, like the "+" button in the style reference. */
export function IconChip({ children, tone = "ink", size = 40 }: { children: ReactNode; tone?: "ink" | "halo" | "sage" | "rose"; size?: number }) {
  const bg = {
    ink: "linear-gradient(135deg,#46508a,#1d2238)",
    halo: "linear-gradient(135deg,#f9d77f,#eba721)",
    sage: "linear-gradient(135deg,#5fbfa5,#2e8a74)",
    rose: "linear-gradient(135deg,#e88aa0,#c8506a)",
  }[tone];
  return (
    <span aria-hidden className={`clay-chip inline-flex shrink-0 items-center justify-center ${tone === "halo" ? "text-ink" : "text-white"}`} style={{ width: size, height: size, background: bg }}>
      {children}
    </span>
  );
}

/** A big ring gauge with the value in a raised centre, like the 75% dial in the reference. */
export function RingGauge({
  value,
  size = 150,
  label,
  segments,
}: {
  value: number;
  size?: number;
  label?: string;
  segments?: { value: number; color: string }[];
}) {
  const stroke = Math.round(size * 0.075);
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segs = segments ?? [{ value, color: "url(#ring-halo)" }];
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id="ring-halo" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f9d77f" />
            <stop offset="1" stopColor="#eba721" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#dfe3ea" strokeWidth={stroke} />
        {segs.map((s, i) => {
          const len = Math.max(0, Math.min(1, s.value)) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - (segs.length > 1 && len > 0 ? 3 : 0))} ${c}`}
              strokeDashoffset={-offset}
              strokeLinecap={segs.length > 1 ? "butt" : "round"}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <span
        className="clay relative flex flex-col items-center justify-center rounded-full"
        style={{ width: size - stroke * 4.2, height: size - stroke * 4.2, borderRadius: 9999 }}
      >
        <span className="font-display font-extrabold leading-none" style={{ fontSize: size * 0.2 }}>
          {Math.round(value * 100)}
          <span style={{ fontSize: size * 0.1 }}>%</span>
        </span>
      </span>
    </span>
  );
}

/** A pressed-in track with a gradient fill and a round knob at its end. */
export function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="clay-inset relative h-3.5 rounded-full" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <div className="fill-halo absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%` }} />
      <span className="knob absolute top-1/2 h-6 w-6 -translate-y-1/2" style={{ left: `calc(${pct}% - 12px)` }} />
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    scheduled: ["On the diary", "bg-white/80 text-slate"],
    awaiting: ["Needs your answer", "bg-rose-soft text-rose"],
    confirmed: ["Confirmed, payment held", "bg-sage-soft text-sage"],
    completed: ["Done and paid", "bg-sage text-white"],
    skipped: ["Skipped", "bg-white/80 text-slate"],
    cancelled: ["Moved", "bg-white/80 text-slate"],
    pending: ["Waiting for signature", "bg-halo-soft text-ink"],
    active: ["In force", "bg-sage-soft text-sage"],
    superseded: ["Replaced", "bg-white/80 text-slate"],
    declined: ["Declined", "bg-rose-soft text-rose"],
    terminated: ["Ended", "bg-white/80 text-slate"],
  };
  const [label, cls] = map[status] ?? [status, "bg-white/80 text-slate"];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold shadow-[inset_1px_1px_1px_rgba(255,255,255,0.8),2px_3px_6px_-2px_rgba(29,34,56,0.15)] ${cls}`}>
      {label}
    </span>
  );
}

export function money(amount: number, currency = "EUR") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <circle cx="13" cy="13" r="10" fill="none" stroke="#dfe3ea" strokeWidth="4" />
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
