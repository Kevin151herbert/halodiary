// Generates supabase/seed.sql: the service catalogue plus demo providers with
// ratings and reviews. Demo providers are stored as offsets (km north/east),
// so they appear around whichever location a judge signs in from.
//
// Run: node scripts/generate-seed.mjs

import { writeFileSync } from "node:fs";

// Small deterministic random generator so the seed is identical on every run.
let state = 20261112;
const rand = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return ((state >>> 0) % 1_000_000) / 1_000_000;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Deterministic UUIDs, so re-running the seed updates the same providers.
const uuid = () => {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const services = [
  // id, name, category, cadence, typical price (EUR), core
  ["cleaning", "Cleaning", "Home", "twice_weekly", 35, true],
  ["tutoring", "Tutoring", "Family", "thrice_weekly", 30, true],
  ["dog-walking", "Dog walking", "Pets", "weekends", 15, true],
  ["pool-cleaning", "Pool cleaning", "Home", "twice_monthly", 60, true],
  ["upholstery", "Upholstery cleaning", "Home", "monthly", 70, true],
  ["security-check", "Home security check", "Home", "monthly", 45, true],
  ["car-servicing", "Car servicing", "Vehicle", "quarterly", 180, true],
  ["gardening", "Gardening and lawn care", "Home", "weekly", 40, false],
  ["laundry", "Laundry pickup and ironing", "Home", "weekly", 25, false],
  ["window-cleaning", "Window cleaning", "Home", "monthly", 50, false],
  ["pest-control", "Pest control", "Home", "quarterly", 90, false],
  ["ac-servicing", "Air conditioning servicing", "Home", "every_6_months", 85, false],
  ["generator", "Generator servicing", "Home", "monthly", 55, false],
  ["water-tank", "Water tank cleaning", "Home", "quarterly", 75, false],
  ["car-wash", "Car wash and valet", "Vehicle", "biweekly", 30, false],
  ["personal-trainer", "Personal trainer", "Wellness", "thrice_weekly", 40, false],
  ["barber", "Hair and barber", "Wellness", "every_3_weeks", 25, false],
  ["pet-grooming", "Pet grooming", "Pets", "every_6_weeks", 45, false],
  ["lessons", "Music or language lessons", "Family", "weekly", 35, false],
  ["babysitting", "Babysitting", "Family", "weekly", 50, false],
  ["elderly-care", "Elderly care visit", "Family", "weekly", 45, false],
  ["meal-prep", "Meal prep or private chef", "Wellness", "weekly", 80, false],
];

const firstNames = [
  "Amara", "Lucía", "Tomás", "Ngozi", "Jordi", "Mei", "Kwame", "Sofía", "Rahul", "Elena",
  "Chidi", "Marta", "Yusuf", "Ana", "Daniel", "Fatima", "Pau", "Linh", "Oluwaseun", "Clara",
  "Mateo", "Aisha", "Hugo", "Zainab", "Nil", "Priya", "Bruno", "Thandi", "Iker", "Hana",
  "Emeka", "Laia", "Diego", "Sade", "Marc", "Yuki", "Kofi", "Inés", "Arjun", "Nadia",
  "Pablo", "Adaeze", "Joan", "Leila", "Samuel", "Mireia", "Tunde", "Carmen", "Minh", "Grace",
];
const lastInitials = "ABCDEFGHJKLMNOPRSTVZ".split("");
const languagesPool = [["English"], ["English", "Spanish"], ["Spanish", "Catalan", "English"], ["English", "French"], ["English", "Yoruba"], ["English", "Hausa"], ["English", "Vietnamese"], ["English", "Portuguese"]];

const headlines = {
  "cleaning": ["Detailed home cleaning, eco products", "Weekly cleans for busy families", "Deep cleans and regular upkeep"],
  "tutoring": ["Maths and science tutor, ages 8 to 16", "Homework club and exam prep", "Bilingual tutor for primary school"],
  "dog-walking": ["Small-group walks, GPS photos after each", "Weekend walks for energetic dogs", "Calm one-to-one walks"],
  "pool-cleaning": ["Pool care, chemistry checks included", "Skim, vacuum and balance every visit"],
  "upholstery": ["Sofa and mattress steam cleaning", "Stain removal for fabric and leather"],
  "security-check": ["Monthly alarm, lock and camera checks", "Home security walkthrough with report"],
  "car-servicing": ["Mobile mechanic, servicing at your door", "Quarterly service and safety check"],
  "gardening": ["Lawn, hedges and seasonal planting", "Balcony and terrace gardens"],
  "laundry": ["Pickup, wash, iron and return in 48h", "Shirts and bedding, collected weekly"],
  "window-cleaning": ["Streak-free windows, inside and out"],
  "pest-control": ["Preventive pest control plans"],
  "ac-servicing": ["AC filter, gas and drain service"],
  "generator": ["Generator servicing and load tests"],
  "water-tank": ["Tank cleaning and disinfection"],
  "car-wash": ["Hand wash and interior valet at home"],
  "personal-trainer": ["Strength training at home or in the park", "Beginner-friendly fitness coaching"],
  "barber": ["Home visits for cuts and beard trims"],
  "pet-grooming": ["Mobile grooming van, all breeds"],
  "lessons": ["Piano and guitar for all ages", "English and Spanish conversation lessons"],
  "babysitting": ["Evening babysitting, first-aid certified"],
  "elderly-care": ["Companionship and check-in visits"],
  "meal-prep": ["Weekly meal prep, menus planned with you"],
};

const reviewBits = {
  great: [
    "Always on time and very thorough.",
    "Reliable every single week, I never have to chase.",
    "Friendly, careful and great value.",
    "Rescheduled without fuss when we travelled.",
    "Does exactly what was agreed, no surprises.",
    "Our home has never been better looked after.",
    "Clear communication and lovely to deal with.",
  ],
  ok: [
    "Good work, occasionally a few minutes late.",
    "Solid service, would like a bit more detail on the report.",
    "Fine overall, needed a reminder once.",
  ],
};
const reviewers = ["Laura M.", "James O.", "Núria P.", "Chinedu A.", "Sarah K.", "Albert F.", "Hoa T.", "Miguel R.", "Bisi O.", "Emma L.", "Xavi G.", "Rosa D."];

// How many demo providers per service: more for the seven core services.
const perService = (s) => (s[5] ? 6 : 3);

const providers = [];
const providerServices = [];
const reviews = [];
let nameIdx = 0;

for (const s of services) {
  for (let i = 0; i < perService(s); i++) {
    const id = uuid();
    const first = firstNames[nameIdx % firstNames.length];
    const name = `${first} ${pick(lastInitials)}.`;
    nameIdx++;

    // Ratings: mostly strong, a few middling, so ranking matters.
    const strong = rand() < 0.8;
    const rating = strong ? between(4.4, 5.0) : between(3.6, 4.3);
    const reviewCount = Math.floor(between(6, 180));

    // Position relative to the viewer: 0.3 to 9 km in any direction.
    const angle = rand() * Math.PI * 2;
    const dist = 0.3 + Math.pow(rand(), 1.4) * 8.7;

    providers.push({
      id,
      name,
      headline: pick(headlines[s[0]]),
      bio: `${first} has been helping households with ${s[1].toLowerCase()} for years and works around your routine. Bookings run on HaloDiary, so reminders, changes and payments are handled automatically.`,
      hue: Math.floor(rand() * 360),
      rating: Math.round(rating * 10) / 10,
      reviewCount,
      years: Math.floor(between(1, 16)),
      languages: pick(languagesPool),
      responds: pick([1, 1, 2, 2, 4, 8]),
      verified: rand() < 0.7,
      north: Math.round(Math.cos(angle) * dist * 1000) / 1000,
      east: Math.round(Math.sin(angle) * dist * 1000) / 1000,
    });

    // Price around the typical price.
    const price = Math.round(s[4] * between(0.8, 1.3));
    providerServices.push([id, s[0], price]);

    // Some providers offer a related second service.
    const related = { "cleaning": "upholstery", "dog-walking": "pet-grooming", "car-servicing": "car-wash", "tutoring": "lessons", "pool-cleaning": "gardening", "security-check": "generator" }[s[0]];
    if (related && rand() < 0.35) {
      const rs = services.find((x) => x[0] === related);
      providerServices.push([id, related, Math.round(rs[4] * between(0.85, 1.2))]);
    }

    const n = 3 + Math.floor(rand() * 3);
    for (let r = 0; r < n; r++) {
      const good = rating >= 4.3 ? rand() < 0.9 : rand() < 0.55;
      reviews.push({
        provider: id,
        service: s[0],
        author: pick(reviewers),
        rating: good ? pick([5, 5, 5, 4]) : pick([4, 3, 3]),
        body: good ? pick(reviewBits.great) : pick(reviewBits.ok),
        daysAgo: Math.floor(between(2, 200)),
      });
    }
  }
}

const lines = [];
lines.push("-- Generated by scripts/generate-seed.mjs. Re-run the script rather than editing by hand.");
lines.push("begin;");
lines.push("delete from public.reviews where provider_id in (select id from public.providers where is_demo);");
lines.push("delete from public.provider_services where provider_id in (select id from public.providers where is_demo);");
lines.push("delete from public.providers where is_demo and id not in (select provider_id from public.plans union select provider_id from public.visits);");
lines.push("");
lines.push("insert into public.services (id, name, category, default_cadence, typical_price, sort_order, is_core) values");
lines.push(
  services
    .map((s, i) => `  (${q(s[0])}, ${q(s[1])}, ${q(s[2])}, ${q(s[3])}, ${s[4]}, ${i + 1}, ${s[5]})`)
    .join(",\n") +
    "\non conflict (id) do update set name = excluded.name, category = excluded.category, default_cadence = excluded.default_cadence, typical_price = excluded.typical_price, sort_order = excluded.sort_order, is_core = excluded.is_core;",
);
lines.push("");
lines.push("insert into public.providers (id, display_name, headline, bio, avatar_hue, rating, review_count, years_experience, languages, responds_within_hours, verified, is_demo, offset_north_km, offset_east_km) values");
lines.push(
  providers
    .map(
      (p) =>
        `  (${q(p.id)}, ${q(p.name)}, ${q(p.headline)}, ${q(p.bio)}, ${p.hue}, ${p.rating.toFixed(1)}, ${p.reviewCount}, ${p.years}, array[${p.languages.map(q).join(", ")}], ${p.responds}, ${p.verified}, true, ${p.north}, ${p.east})`,
    )
    .join(",\n") + "\non conflict (id) do nothing;",
);
lines.push("");
lines.push("insert into public.provider_services (provider_id, service_id, price) values");
lines.push(providerServices.map(([p, s, price]) => `  (${q(p)}, ${q(s)}, ${price})`).join(",\n") + "\non conflict do nothing;");
lines.push("");
lines.push("insert into public.reviews (provider_id, service_id, author_name, rating, body, created_at) values");
lines.push(
  reviews
    .map((r) => `  (${q(r.provider)}, ${q(r.service)}, ${q(r.author)}, ${r.rating}, ${q(r.body)}, now() - interval '${r.daysAgo} days')`)
    .join(",\n") + ";",
);
lines.push("commit;");

writeFileSync(new URL("../supabase/seed.sql", import.meta.url), lines.join("\n") + "\n");
console.log(`services ${services.length}, providers ${providers.length}, provider_services ${providerServices.length}, reviews ${reviews.length}`);

// Compact variant with identical rows: repeated text is stored once and expanded in SQL.
// Used to push the seed through tools with size limits.
{
  const bodies = [...new Set(reviews.map((r) => r.body))];
  const authors = [...new Set(reviews.map((r) => r.author))];
  const pIndex = new Map(providers.map((p, i) => [p.id, i + 1]));
  const bioOf = new Map(providers.map((p) => [p.id, p.bio]));
  const bioTail = " Bookings run on HaloDiary, so reminders, changes and payments are handled automatically.";
  const out = [];
  out.push("begin;");
  out.push(lines.slice(2, 5).join("\n"));
  out.push(lines[6] + "\n" + lines[7]);
  const prov = providers.map((p) => {
    const svc = bioOf.get(p.id).match(/with (.*) for years/)[1];
    return [p.id, p.name, p.headline, svc, p.hue, p.rating, p.reviewCount, p.years, p.languages, p.responds, p.verified, p.north, p.east];
  });
  out.push(`insert into public.providers (id, display_name, headline, bio, avatar_hue, rating, review_count, years_experience, languages, responds_within_hours, verified, is_demo, offset_north_km, offset_east_km)
select (r->>0)::uuid, r->>1, r->>2,
  split_part(r->>1, ' ', 1) || ' has been helping households with ' || (r->>3) || ' for years and works around your routine.' || ${q(bioTail)},
  (r->>4)::int, (r->>5)::numeric, (r->>6)::int, (r->>7)::int, array(select jsonb_array_elements_text(r->8)), (r->>9)::int, (r->>10)::boolean, true, (r->>11)::float8, (r->>12)::float8
from jsonb_array_elements(${q(JSON.stringify(prov))}::jsonb) r
on conflict (id) do nothing;`);
  out.push(`insert into public.provider_services (provider_id, service_id, price)
select (r->>0)::uuid, r->>1, (r->>2)::numeric from jsonb_array_elements(${q(JSON.stringify(providerServices))}::jsonb) r
on conflict do nothing;`);
  const rv = reviews.map((r) => [pIndex.get(r.provider), r.service, authors.indexOf(r.author), r.rating, bodies.indexOf(r.body), r.daysAgo]);
  out.push(`with p as (select (r->>0)::uuid id, n from jsonb_array_elements(${q(JSON.stringify(providers.map((p) => [p.id])))}::jsonb) with ordinality t(r, n)),
a as (select ${q(JSON.stringify(authors))}::jsonb j), b as (select ${q(JSON.stringify(bodies))}::jsonb j)
insert into public.reviews (provider_id, service_id, author_name, rating, body, created_at)
select p.id, r->>1, (select j->>((r->>2)::int) from a), (r->>3)::int, (select j->>((r->>4)::int) from b), now() - make_interval(days => (r->>5)::int)
from jsonb_array_elements(${q(JSON.stringify(rv))}::jsonb) r join p on p.n = (r->>0)::int;`);
  out.push("commit;");
  writeFileSync(new URL("../supabase/seed-compact.sql", import.meta.url), out.join("\n\n") + "\n");
}
