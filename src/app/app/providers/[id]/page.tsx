import Link from "next/link";
import { notFound } from "next/navigation";
import { AttendanceCard } from "@/components/attendance";
import { Avatar, Card, Meter, money, Rating } from "@/components/ui";
import { profileCompleteness } from "@/lib/match-shared";
import { attendanceFor } from "@/lib/attendance";
import { nowFor } from "@/lib/engine";
import { cadenceLabel } from "@/lib/cadence";
import { searchProviders } from "@/lib/actions-core";
import { getSession } from "@/lib/supabase/server";
import { MessageCircle } from "lucide-react";
import { openChatAction } from "../../actions";
import { AddToDiary } from "./add-to-diary";

export default async function ProviderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ service?: string }> }) {
  const { id } = await params;
  const { service } = await searchParams;
  const { supabase, profile } = await getSession();

  const [{ data: provider }, { data: offers }, { data: reviews }, near, attendance] = await Promise.all([
    supabase.from("providers").select("*").eq("id", id).maybeSingle(),
    supabase.from("provider_services").select("price, services(*)").eq("provider_id", id),
    supabase.from("reviews").select("*").eq("provider_id", id).order("created_at", { ascending: false }).limit(6),
    searchProviders(supabase, profile!, { radiusKm: 50 }),
    attendanceFor(supabase, id, nowFor(profile!).toISOString()),
  ]);
  if (!provider) notFound();
  const completeness = profileCompleteness({ ...provider, socials: provider.socials ?? {}, team: provider.team ?? [] });
  const distance = near.results.find((r) => r.provider_id === id)?.distance_km;

  type Offer = { price: number; services: { id: string; name: string; default_cadence: string } };
  const list = (offers ?? []) as unknown as Offer[];
  const selected = list.find((o) => o.services.id === service) ?? list[0];

  return (
    <div>
      <Link href={`/app/discover${service ? `?service=${service}` : ""}`} className="clay-btn-ghost inline-flex rounded-full px-4 py-2 text-sm font-bold">
        Back to results
      </Link>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <div className="flex items-center gap-5">
            <Avatar name={provider.display_name} hue={provider.avatar_hue} size={76} photo={provider.photo_url} />
            <div>
              <h1 className="text-3xl font-extrabold">{provider.display_name}</h1>
              <p className="mt-1 text-slate">{provider.headline}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate">
                <Rating value={provider.rating} count={provider.review_count} />
                {distance != null && <span>{distance.toFixed(1)} km away</span>}
                <span>{provider.years_experience} years experience</span>
                {provider.verified && <span className="font-bold text-sage">ID checked</span>}
              </div>
            </div>
          </div>
          {profile!.role === "client" && (
            <form action={openChatAction.bind(null, provider.id)} className="mt-5">
              <button className="clay-btn-ghost inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold">
                <MessageCircle size={16} aria-hidden /> Message {provider.display_name.split(" ")[0]}
              </button>
            </form>
          )}
          <p className="mt-6 max-w-prose leading-relaxed">{provider.bio}</p>
          <p className="mt-3 text-sm text-slate">
            Speaks {provider.languages.join(", ")}. Usually replies within {provider.responds_within_hours} hours.
          </p>

          <section className="clay-inset mt-6 grid gap-4 p-5 text-sm sm:grid-cols-2" aria-label="Details">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate">Team</p>
              <p className="mt-1 font-bold">{provider.team_size > 1 ? `Team of ${provider.team_size}` : "Works solo"}</p>
              {(provider.team ?? []).length > 0 && (
                <p className="text-slate">{(provider.team as { name: string; role: string }[]).map((t) => `${t.name}${t.role ? ` (${t.role})` : ""}`).join(", ")}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate">Trust</p>
              <p className="mt-1">
                {[provider.insured ? "Insured" : "Not insured", provider.certifications || null, provider.verified ? "ID checked" : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate">Area</p>
              <p className="mt-1">Travels up to {provider.service_radius_km} km{provider.accepting_clients ? "" : " · not taking new clients"}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate">Online</p>
              <p className="mt-1 break-words">
                {provider.website && !provider.is_demo ? (
                  <a href={provider.website} target="_blank" rel="noopener noreferrer nofollow" className="font-bold underline">
                    {provider.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
                {Object.entries((provider.socials ?? {}) as Record<string, string>).map(([k, v]) => (
                  <span key={k} className="mr-3 inline-block">
                    {k === "x" ? "X" : k[0].toUpperCase() + k.slice(1)} @{v}
                  </span>
                ))}
                {!provider.website && !Object.keys(provider.socials ?? {}).length && <span className="text-slate">No links shared</span>}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate">Profile detail {Math.round(completeness.score * 100)}%</p>
              <div className="mt-2">
                <Meter value={completeness.score} label="Profile detail" />
              </div>
            </div>
          </section>

          <div className="mt-8">
            <AttendanceCard data={attendance} tz={profile!.timezone} name={provider.display_name} />
          </div>

          <h2 className="mt-10 text-xl font-bold">Services and prices</h2>
          <ul className="clay mt-3 divide-y divide-mist/70 px-2">
            {list.map((o) => (
              <li key={o.services.id} className="flex items-center justify-between px-4 py-3">
                <span>
                  <span className="font-bold">{o.services.name}</span>
                  <span className="block text-sm text-slate">Most clients book {cadenceLabel(o.services.default_cadence).toLowerCase()}</span>
                </span>
                <span className="font-display font-bold">{money(Number(o.price), profile!.currency)}</span>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 text-xl font-bold">Recent reviews</h2>
          <ul className="mt-3 space-y-3">
            {(reviews ?? []).map((r) => (
              <li key={r.id}>
                <Card className="p-5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold">{r.author_name}</span>
                    <Rating value={r.rating} />
                  </div>
                  <p className="mt-2">{r.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        {selected && (
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <AddToDiary
              providerId={provider.id}
              providerName={provider.display_name}
              offers={list.map((o) => ({ id: o.services.id, name: o.services.name, price: Number(o.price), cadence: o.services.default_cadence }))}
              initialService={selected.services.id}
              currency={profile!.currency}
              clientName={profile!.full_name || "You"}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
