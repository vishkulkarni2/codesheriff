/**
 * GitHub App installation callback route.
 *
 * After a user installs the CodeSheriff GitHub App, GitHub redirects them to
 * this setup_url with ?installation_id=xxx&setup_action=install.
 *
 * Because this runs in the user's browser session, we can authenticate them
 * via Clerk and reliably link the GitHub installation to their org — solving
 * the webhook-based guessing problem.
 *
 * Flow:
 *   1. GitHub redirects here after app install
 *   2. We get the Clerk session (user must be signed in)
 *   3. We call our API: POST /api/v1/orgs/current/github/link
 *   4. Redirect to /repos on success
 */

import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");

  // If no installation_id, redirect to repos page (nothing to link)
  if (!installationId) {
    return NextResponse.redirect(new URL("/repos", request.url));
  }

  // Get the authenticated user's session
  const { getToken, userId } = auth();

  if (!userId) {
    // User is not signed in — redirect to sign-in, then back here
    const callbackUrl = request.nextUrl.toString();
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", callbackUrl);
    return NextResponse.redirect(signInUrl);
  }

  const token = await getToken();
  if (!token) {
    const callbackUrl = request.nextUrl.toString();
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", callbackUrl);
    return NextResponse.redirect(signInUrl);
  }

  try {
    // Call our API to link the installation to the user's org and sync repos
    const response = await fetch(`${API_BASE}/orgs/current/github/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ installationId }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      console.error(
        "[github/callback] Failed to link installation:",
        result.error
      );
      // Still redirect to repos — the user can try manual sync
      const reposUrl = new URL("/repos", request.url);
      reposUrl.searchParams.set(
        "error",
        result.error ?? "Failed to link GitHub installation"
      );
      return NextResponse.redirect(reposUrl);
    }

    // Success — redirect to repos page
    return NextResponse.redirect(new URL("/repos", request.url));
  } catch (err) {
    console.error("[github/callback] Error linking installation:", err);
    const reposUrl = new URL("/repos", request.url);
    reposUrl.searchParams.set("error", "Failed to connect to API");
    return NextResponse.redirect(reposUrl);
  }
}
