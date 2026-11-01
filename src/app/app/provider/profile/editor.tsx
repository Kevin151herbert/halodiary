"use client";

import { AtSign, Camera, Globe, Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { ServiceIcon } from "@/components/service-icon";
import { Avatar, btn, field, Meter } from "@/components/ui";
import { profileCompleteness } from "@/lib/match-shared";
import { createClient } from "@/lib/supabase/client";
import { saveProviderProfile, type ProfileInput } from "../actions";

type Service = { id: string; name: string; category: string; typical_price: number };

const SOCIALS = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["linkedin", "LinkedIn"],
  ["x", "X"],
] as const;

/** Shrink a photo to a 512px square JPEG in the browser before upload. */
/** Square-crop to 512px and encode as WebP (about a third the size of JPEG), JPEG where WebP isn't supported. */
async function squareImage(file: File): Promise<{ blob: Blob; ext: "webp" | "jpg"; type: string }> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
  const encode = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  const webp = await encode("image/webp", 0.82);
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp", type: "image/webp" };
  const jpg = await encode("image/jpeg", 0.85);
  if (!jpg) throw new Error("Could not read that image");
  return { blob: jpg, ext: "jpg", type: "image/jpeg" };
}

export function ProfileEditor({
  providerId,
  profileId,
  hue,
  initial,
  services,
  currency,
  isNew,
}: {
  providerId: string;
  profileId: string;
  hue: number;
  initial: ProfileInput;
  services: Service[];
  currency: string;
  isNew: boolean;
}) {
  const [p, setP] = useState<ProfileInput>(initial);
  const [langs, setLangs] = useState(initial.languages.join(", "));
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setP((x) => ({ ...x, [k]: v }));
  const comp = useMemo(() => profileCompleteness({ ...p, website: p.website || null }), [p]);
  const offered = new Map(p.offers.map((o) => [o.service_id, o.price]));
  const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  async function upload(file: File) {
    setUploading(true);
    setMsg(null);
    try {
      const { blob, ext, type } = await squareImage(file);
      const supabase = createClient();
      const path = `${profileId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, blob, { contentType: type, upsert: true, cacheControl: "31536000" });
      if (error) throw error;
      set("photo_url", supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_320px]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveProviderProfile({ ...p, languages: langs.split(",").map((l) => l.trim()) });
          setMsg(res && "error" in res && res.error ? { ok: false, text: res.error } : { ok: true, text: "Profile saved. Clients near you see it now." });
        });
      }}
    >
      <div className="space-y-6">
        {isNew && (
          <p className="clay-sm px-5 py-4 text-sm">
            <span className="font-bold">Your listing is live.</span> Clients rank providers partly on how much they share, so a photo, a few lines about you
            and your team, and your links all lift you in their matches.
          </p>
        )}

        <section className="clay p-6">
          <h2 className="text-lg font-bold">About you</h2>
          <div className="mt-5 flex flex-wrap items-center gap-5">
            <Avatar name={p.display_name || "You"} hue={hue} size={96} photo={p.photo_url} />
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <button type="button" className={btn.ghost} onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Camera size={16} aria-hidden /> {uploading ? "Uploading…" : p.photo_url ? "Change photo" : "Add a photo"}
              </button>
              {p.photo_url && (
                <button type="button" className={btn.quiet} onClick={() => set("photo_url", null)}>
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Label text="Name or business name">
              <input value={p.display_name} onChange={(e) => set("display_name", e.target.value)} maxLength={60} required className={field} />
            </Label>
            <Label text="Years of experience">
              <input type="number" min={0} max={60} value={p.years_experience} onChange={(e) => set("years_experience", Number(e.target.value))} className={field} />
            </Label>
            <Label text="Headline" wide>
              <input value={p.headline} onChange={(e) => set("headline", e.target.value)} maxLength={120} placeholder="Detailed home cleaning with eco products" className={field} />
            </Label>
            <Label text="About you and how you work" wide>
              <textarea
                value={p.bio}
                onChange={(e) => set("bio", e.target.value)}
                rows={5}
                maxLength={1500}
                placeholder="What you do, how long you've done it, what clients can expect on every visit."
                className={`${field} resize-y`}
              />
              <span className="mt-1 block text-right text-[11px] font-normal text-slate">{p.bio.trim().length} characters{p.bio.trim().length < 80 ? ", 80 or more counts as complete" : ""}</span>
            </Label>
            <Label text="Languages (comma separated)">
              <input value={langs} onChange={(e) => setLangs(e.target.value)} placeholder="English, Spanish" className={field} />
            </Label>
            <Label text="Certifications">
              <input value={p.certifications} onChange={(e) => set("certifications", e.target.value)} maxLength={200} placeholder="Background checked, first aid" className={field} />
            </Label>
          </div>
          <label className="mt-5 flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block font-bold">Insured</span>
              <span className="text-sm text-slate">You hold liability insurance for your work.</span>
            </span>
            <input type="checkbox" checked={p.insured} onChange={(e) => set("insured", e.target.checked)} className="clay-switch" />
          </label>
        </section>

        <section className="clay p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Users size={18} aria-hidden /> Your team
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Label text="People in your team, including you">
              <input type="number" min={1} max={500} value={p.team_size} onChange={(e) => set("team_size", Number(e.target.value))} className={field} />
            </Label>
          </div>
          <ul className="mt-4 space-y-2">
            {p.team.map((t, i) => (
              <li key={i} className="flex gap-2">
                <input
                  aria-label="Team member name"
                  value={t.name}
                  onChange={(e) => set("team", p.team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Name"
                  className={`${field} flex-1`}
                />
                <input
                  aria-label="Role"
                  value={t.role}
                  onChange={(e) => set("team", p.team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                  placeholder="Role"
                  className={`${field} flex-1`}
                />
                <button type="button" onClick={() => set("team", p.team.filter((_, j) => j !== i))} className={btn.quiet} aria-label="Remove team member">
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={`${btn.ghost} mt-3`} onClick={() => set("team", [...p.team, { name: "", role: "" }])}>
            <Plus size={16} aria-hidden /> Add a team member
          </button>
        </section>

        <section className="clay p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Globe size={18} aria-hidden /> Website and social media
          </h2>
          <p className="mt-1 text-sm text-slate">Clients see these on your profile. Bookings, chat and payments still happen in HaloDiary.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Label text="Website" wide>
              <input value={p.website} onChange={(e) => set("website", e.target.value)} placeholder="yourbusiness.com" className={field} inputMode="url" />
            </Label>
            {SOCIALS.map(([k, label]) => (
              <Label key={k} text={label}>
                <span className="relative block">
                  <AtSign size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate" aria-hidden />
                  <input
                    value={p.socials[k] ?? ""}
                    onChange={(e) => set("socials", { ...p.socials, [k]: e.target.value })}
                    placeholder="handle"
                    className={`${field} pl-9`}
                  />
                </span>
              </Label>
            ))}
          </div>
        </section>

        <section className="clay p-6">
          <h2 className="text-lg font-bold">Services and prices</h2>
          <p className="mt-1 text-sm text-slate">Price per visit, in {currency}. Clients compare it with their budget when matching.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {services.map((s) => {
              const on = offered.has(s.id);
              return (
                <li key={s.id} className={`flex items-center gap-3 rounded-[18px] p-3 ${on ? "clay-sm ring-2 ring-halo" : "clay-inset"}`}>
                  <input
                    type="checkbox"
                    id={`svc-${s.id}`}
                    checked={on}
                    onChange={(e) =>
                      set("offers", e.target.checked ? [...p.offers, { service_id: s.id, price: s.typical_price }] : p.offers.filter((o) => o.service_id !== s.id))
                    }
                    className="h-4 w-4 accent-[#1d2238]"
                  />
                  <ServiceIcon id={s.id} size={16} />
                  <label htmlFor={`svc-${s.id}`} className="flex-1 text-sm font-bold">
                    {s.name}
                  </label>
                  {on ? (
                    <input
                      type="number"
                      min={1}
                      step={1}
                      aria-label={`Price for ${s.name}`}
                      value={offered.get(s.id)}
                      onChange={(e) => set("offers", p.offers.map((o) => (o.service_id === s.id ? { ...o, price: Number(e.target.value) } : o)))}
                      className="clay-inset w-20 rounded-xl px-2 py-1.5 text-right text-sm"
                    />
                  ) : (
                    <span className="text-xs text-slate">~{money(s.typical_price)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="clay p-6">
          <h2 className="text-lg font-bold">Bookings and payouts</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Label text="How far you travel (km)">
              <input type="number" min={1} max={100} value={p.service_radius_km} onChange={(e) => set("service_radius_km", Number(e.target.value))} className={field} />
            </Label>
            <Label text="PayPal email for payouts">
              <input type="email" value={p.paypal_email} onChange={(e) => set("paypal_email", e.target.value)} placeholder="you@example.com" className={field} />
            </Label>
          </div>
          <label className="mt-5 flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block font-bold">Accepting new clients</span>
              <span className="text-sm text-slate">Off hides you from new matches. Your current clients aren&apos;t affected.</span>
            </span>
            <input type="checkbox" checked={p.accepting_clients} onChange={(e) => set("accepting_clients", e.target.checked)} className="clay-switch" />
          </label>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section className="clay p-6">
          <p className="text-sm font-bold">Profile detail</p>
          <p className="mt-1 font-display text-4xl font-extrabold">{Math.round(comp.score * 100)}%</p>
          <div className="mt-3">
            <Meter value={comp.score} label="Profile detail" />
          </div>
          <p className="mt-3 text-xs text-slate">Counts for 15% of every match score clients see.</p>
          {comp.missing.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {comp.missing.map((m) => (
                <li key={m} className="clay-inset rounded-full px-2.5 py-1 text-xs font-bold text-slate">
                  + {m}
                </li>
              ))}
            </ul>
          )}
        </section>
        <button disabled={pending} className={`${btn.primary} w-full py-3.5`}>
          {pending ? "Saving…" : "Save profile"}
        </button>
        {msg && <p className={`text-sm font-bold ${msg.ok ? "text-sage" : "text-rose"}`}>{msg.text}</p>}
        <Link href={`/app/providers/${providerId}`} className={`${btn.ghost} w-full`}>
          See your public profile
        </Link>
      </aside>
    </form>
  );
}

function Label({ text, wide = false, children }: { text: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block text-xs font-bold text-slate ${wide ? "sm:col-span-2" : ""}`}>
      {text}
      <span className="mt-1.5 block text-sm text-ink">{children}</span>
    </label>
  );
}
