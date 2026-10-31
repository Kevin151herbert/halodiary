// PayPal sandbox REST client: vault (save PayPal once), authorize, capture, void, payouts.
// When credentials are missing, callers fall back to simulated mode and label it in the UI.

const BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let cached: { token: string; expires: number } | null = null;

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

async function call<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(),
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = json?.details?.[0]?.description || json?.message || res.statusText;
    throw new Error(`PayPal ${path} failed: ${detail}`);
  }
  return json as T;
}

const money = (amount: number, currency: string) => ({ currency_code: currency, value: amount.toFixed(2) });

/** Step 1 of saving PayPal: a setup token the PayPal button opens for the payer to approve. */
export async function createSetupToken(opts: { capText: string; returnUrl: string; cancelUrl: string }) {
  const json = await call<{ id: string; links?: { rel: string; href: string }[] }>("/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        description: `HaloDiary monthly services budget: ${opts.capText}. Charged per visit, only after each visit is confirmed.`,
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        permit_multiple_payment_tokens: false,
        experience_context: {
          brand_name: "HaloDiary",
          shipping_preference: "NO_SHIPPING",
          vault_instruction: "ON_PAYER_APPROVAL",
          return_url: opts.returnUrl,
          cancel_url: opts.cancelUrl,
        },
      },
    },
  });
  const approveUrl = json.links?.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal did not return an approval link");
  return { id: json.id, approveUrl };
}

/** Step 2: exchange the approved setup token for a reusable payment token. */
export async function createPaymentToken(setupTokenId: string) {
  const json = await call<{ id: string; payment_source?: { paypal?: { email_address?: string } } }>(
    "/v3/vault/payment-tokens",
    { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  );
  return { paymentToken: json.id, email: json.payment_source?.paypal?.email_address ?? null };
}

type Order = {
  id: string;
  status: string;
  purchase_units?: { payments?: { authorizations?: { id: string; status: string }[] } }[];
};

/** Hold money for a confirmed visit: an AUTHORIZE order paid with the saved PayPal account. */
export async function authorizeWithVault(opts: {
  paymentToken: string;
  amount: number;
  currency: string;
  description: string;
  visitId: string;
}) {
  const order = await call<Order>("/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: opts.visitId,
        custom_id: opts.visitId,
        description: opts.description.slice(0, 127),
        amount: money(opts.amount, opts.currency),
      },
    ],
    payment_source: { paypal: { vault_id: opts.paymentToken } },
  });

  let authId = order.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authId) {
    const authorized = await call<Order>(`/v2/checkout/orders/${order.id}/authorize`, {});
    authId = authorized.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  }
  if (!authId) throw new Error("PayPal did not return an authorization");
  return { orderId: order.id, authorizationId: authId };
}

export async function captureAuthorization(authorizationId: string) {
  const json = await call<{ id: string; status: string }>(`/v2/payments/authorizations/${authorizationId}/capture`, {
    final_capture: true,
  });
  return json.id;
}

export async function voidAuthorization(authorizationId: string) {
  await call(`/v2/payments/authorizations/${authorizationId}/void`, undefined);
}

/** Pay the provider their share after a visit is done. */
export async function payout(opts: { receiver: string; amount: number; currency: string; note: string }) {
  const json = await call<{ batch_header: { payout_batch_id: string } }>("/v1/payments/payouts", {
    sender_batch_header: {
      sender_batch_id: `halodiary-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      email_subject: "You have a HaloDiary payout",
    },
    items: [
      {
        recipient_type: "EMAIL",
        receiver: opts.receiver,
        amount: { currency: opts.currency, value: opts.amount.toFixed(2) },
        note: opts.note,
      },
    ],
  });
  return json.batch_header.payout_batch_id;
}

/** Recent transactions for the assistant's spend questions (requires transaction search on the app). */
export async function listTransactions(startIso: string, endIso: string) {
  const qs = new URLSearchParams({ start_date: startIso, end_date: endIso, fields: "transaction_info" });
  return call<{ transaction_details?: unknown[] }>(`/v1/reporting/transactions?${qs}`, undefined, "GET");
}
