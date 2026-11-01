// Called by the Render cron job: asks HaloDiary to move every client's visits forward.
const url = `${process.env.APP_URL ?? "https://halodiary.vercel.app"}/api/cron/advance`;
const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
const text = await res.text();
console.log(new Date().toISOString(), res.status, text.slice(0, 500));
if (!res.ok) process.exit(1);
