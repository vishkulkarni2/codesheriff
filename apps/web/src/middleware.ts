/**
 * Next.js middleware — enforces Clerk auth on all /dashboard routes.
 * Public routes (landing, sign-in, sign-up, API health check) are
 * explicitly allowed through.
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  '/api/github/callback',
]);

export default clerkMiddleware((auth, req) => {
  if (!isPublicRoute(req)) {
    const { userId, redirectToSignIn } = auth();
    if (!userId) {
      // Explicit redirect to /sign-in instead of Clerk's default
      // protect-rewrite-to-404 behavior, which makes legitimate dashboard
      // routes look broken to signed-out users (returns 404 instead of
      // bouncing them to sign in).
      return redirectToSignIn({ returnBackUrl: req.url });
    }
  }
});

export const config = {
  // Match all routes except Next.js internals and static assets
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)'],
};
