import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Next.js 16 renamed `middleware` to `proxy` (Node.js runtime by default).
const AUTH_ROUTES = ["/sign-in", "/sign-up"];
const PROTECTED_PREFIXES = ["/dashboard"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Optimistic gate only: we check for the presence of the signed session
  // cookie, never the database. Authoritative validation happens server-side
  // in the protected route via `auth.api.getSession`. This keeps the proxy
  // cheap and avoids coupling request routing to DB latency.
  const sessionCookie = getSessionCookie(request);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (isProtected && !sessionCookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && sessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/sign-in", "/sign-up"],
};
