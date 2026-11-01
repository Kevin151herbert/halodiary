import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session on every request and keeps signed-out
// visitors out of the app pages.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && (path.startsWith("/app") || path.startsWith("/onboarding"))) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }
  if (user && (path === "/login" || path === "/signup")) {
    const to = request.nextUrl.clone();
    to.pathname = "/app";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/paypal/webhook|api/cron|api/mcp|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
