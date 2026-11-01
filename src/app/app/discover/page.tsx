import Link from "next/link";
import { AttendanceBadge } from "@/components/attendance";
import { Avatar, Card, money, Rating } from "@/components/ui";
import { attendanceRates } from "@/lib/attendance";
import { cadenceLabel } from "@/lib/cadence";
import { searchProviders } from "@/lib/actions-core";
import { getSession } from "@/lib/supabase/server";

type Search = Promise<{ service?: string; sort?: string }>;

export default async function DiscoverPage({ searchParams }: { searchParams: Search }) {
  const { service, sort = "distance" } = await searchParams;
  const { supabase, profile } = await getSession();
  const { data: services } = await supabase.from("services").select("*").order("sort_order");
  const { results } = await searchProviders(supabase, profile!, { service: service ?? null, radiusKm: 12 });

  const sorted = [...results].sort((a, b) =>
    sort === "rating" ? Number(b.rating) - Number(a.rating) || a.distance_km - b.distance_km : sort === "price" ? Number(a.price) - Number(b.price) : a.distance_km - b.distance_km,
  );
  const rates = await attendanceRates(supabase, [...new Set(results.map((r) => r.provider_id))]);
  const current = services?.find((s) => s.id === service);
  const currency = profile!.currency;

  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged = { service, sort, ...p };
    Object.entries(merged).forEach(([k, v]) => v && u.set(k, v));
    return `/app/discover?${u}`;
  };

  return (
    <div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">{current ? current.name : "Services"} near you</h1>
          <p className="mt-2 text-slate">
            {sorted.length} {sorted.length === 1 ? "provider" : "providers"} within 12 km of {profile!.city ?? "you"}
            {current && `, usually booked ${cadenceLabel(current.default_cadence).toLowerCase()}`}.
          </p>
        </div>
        <Radar rows={sorted.slice(0, 40)} />
      </div>

      <nav aria-label="Services" className="mt-8 flex gap-2 overflow-x-auto pb-2">
        <Link
          href={qs({ service: undefined })}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${!service ? "clay-btn-ink" : "clay-btn-ghost"}`}
        >
          All
        </Link>
        {services?.map((s) => (
          <Link
            key={s.id}
            href={qs({ service: s.id })}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${service === s.id ? "clay-btn-ink" : "clay-btn-ghost"}`}
          >
            {s.name}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <span className="text-slate">Sort by</span>
        {(["distance", "rating", "price"] as const).map((k) => (
          <Link key={k} href={qs({ sort: k })} className={`rounded-full px-3.5 py-1.5 font-bold capitalize ${sort === k ? "clay-inset text-ink" : "text-slate hover:text-ink"}`}>
            {k}
          </Link>
        ))}
      </div>

      {sorted.length === 0 ? (
        <Card className="mt-6 p-8 text-center">
          <p className="font-bold">No providers within 12 km for this service yet.</p>
          <p className="mt-1 text-slate">Try another service, or ask the assistant to widen the search.</p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {sorted.map((r) => (
            <li key={`${r.provider_id}-${r.service_id}`}>
              <Link
                href={`/app/providers/${r.provider_id}?service=${r.service_id}`}
                className="clay flex h-full gap-4 p-5"
              >
                <Avatar name={r.display_name} hue={r.avatar_hue} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display text-lg font-bold leading-tight">{r.display_name}</p>
                      <p className="text-sm text-slate">{r.service_name}</p>
                    </div>
                    <p className="text-right">
                      <span className="font-display text-lg font-bold">{money(Number(r.price), currency)}</span>
                      <span className="block text-xs text-slate">a visit</span>
                    </p>
                  </div>
                  <p className="mt-2 line-clamp-1 text-sm">{r.headline}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate">
                    <Rating value={r.rating} count={r.review_count} />
                    {rates.has(r.provider_id) && <AttendanceBadge rate={rates.get(r.provider_id)!} />}
                    <span>{r.distance_km.toFixed(1)} km away</span>
                    <span>Replies in {r.responds_within_hours}h</span>
                    {r.verified && <span className="font-bold text-sage">ID checked</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Providers plotted around you: rings at 2, 5 and 10 km. */
function Radar({ rows }: { rows: { provider_id: string; distance_km: number; rating: number; display_name: string; service_id: string }[] }) {
  const size = 168;
  const c = size / 2;
  const scale = (km: number) => (Math.min(km, 12) / 12) * (c - 6);
  // Spread providers by a stable angle from their id, so the picture doesn't jump between loads.
  const angle = (id: string) => (parseInt(id.replace(/-/g, "").slice(0, 6), 16) % 360) * (Math.PI / 180);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${rows.length} providers around you`} className="shrink-0">
      {[2, 5, 10].map((km) => (
        <circle key={km} cx={c} cy={c} r={scale(km)} fill="none" stroke="var(--mist)" />
      ))}
      {rows.map((r) => {
        const a = angle(r.provider_id);
        const d = scale(r.distance_km);
        return (
          <circle
            key={`${r.provider_id}-${r.service_id}`}
            cx={c + Math.cos(a) * d}
            cy={c + Math.sin(a) * d}
            r={Number(r.rating) >= 4.7 ? 4 : 3}
            fill={Number(r.rating) >= 4.7 ? "var(--halo)" : "var(--slate)"}
            opacity={0.85}
          >
            <title>{`${r.display_name}, ${r.distance_km.toFixed(1)} km`}</title>
          </circle>
        );
      })}
      <circle cx={c} cy={c} r={5} fill="var(--ink)" />
      <text x={c} y={size - 2} textAnchor="middle" fontSize="10" fill="var(--slate)">
        gold = rated 4.7+
      </text>
    </svg>
  );
}
