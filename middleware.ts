import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user = null;
  let falloDeRed = false;
  try {
    const res = await supabase.auth.getUser();
    user = res.data.user;
    const e = res.error as { name?: string; status?: number; message?: string } | null;
    // Supabase no respondió (red/DNS/5xx): eso NO significa "sin sesión". No se redirige.
    if (e && !user && (e.name === "AuthRetryableFetchError" || e.status === 0 || (e.status ?? 0) >= 500 || /fetch failed|network|ENOTFOUND|ECONN|timeout/i.test(e.message ?? "")))
      falloDeRed = true;
  } catch {
    falloDeRed = true;
  }

  const { pathname } = request.nextUrl;
  const esLogin = pathname.startsWith("/login");

  if (!user && !esLogin && !falloDeRed) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|login/|icon/|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)$).*)",
  ],
};
