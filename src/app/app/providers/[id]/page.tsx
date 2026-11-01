import Link from "next/link";
import { notFound } from "next/navigation";
import { AttendanceCard } from "@/components/attendance";
import { Avatar, Card, money, Rating } from "@/components/ui";
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

  const { data: provider } = await supabase.from("providers").select("*").eq("id", id).maybeSingle();
  if (!provider) notFound();
  const { data: offers } = await supabase.from("provider_services").select("price, services(*)").eq("provider_id", id);
  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("provider_id", id)
    .order("created_at", { ascending: false })
    .limit(6);
  const near = await searchProviders(supabase, profile!, { radiusKm: 50 });
  const attendance = await attendanceFor(supabase, id, nowFor(profile!).toISOString());
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
            <Avatar name={provider.display_name} hue={provider.avatar_hue} size={76} />
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
