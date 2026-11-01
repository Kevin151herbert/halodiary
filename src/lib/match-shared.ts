// Pure helpers shared by server ranking and client screens.

export type CompletenessInput = {
  photo_url: string | null;
  bio: string;
  headline: string;
  website: string | null;
  socials: Record<string, string>;
  team: { name: string; role: string }[];
  team_size: number;
  certifications: string;
  insured: boolean;
};

/** How much a provider tells clients about themselves, from 0 to 1, with what is missing. */
export function profileCompleteness(p: CompletenessInput) {
  const items: [string, boolean][] = [
    ["Photo", Boolean(p.photo_url)],
    ["About", (p.bio ?? "").trim().length >= 80],
    ["Headline", (p.headline ?? "").trim().length >= 10],
    ["Website", Boolean(p.website)],
    ["Social media", Object.values(p.socials ?? {}).some(Boolean)],
    ["Team", (p.team?.length ?? 0) > 0 || p.team_size > 1],
    ["Certifications", Boolean(p.certifications?.trim())],
    ["Insurance", p.insured],
  ];
  const done = items.filter(([, ok]) => ok).length;
  return { score: done / items.length, missing: items.filter(([, ok]) => !ok).map(([k]) => k), done, total: items.length };
}

