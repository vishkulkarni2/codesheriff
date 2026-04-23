/**
 * Onboarding page — server component.
 *
 * Auto-redirects to /dashboard if the org already has repos connected.
 * Otherwise renders the OnboardingWizard client component.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { listRepos } from '@/lib/api';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';

export const metadata = { title: 'Get started' };

// Don't cache — we need a fresh check after GitHub App install
export const revalidate = 0;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { installation_id?: string; setup_action?: string };
}) {
  // GitHub redirects here after App installation with ?installation_id=&setup_action=install.
  // Forward to the dedicated callback handler that links the installation to the org,
  // then syncs repos and redirects to /repos. This fires because the GitHub App
  // setup_url is configured as /onboarding rather than /api/github/callback.
  if (searchParams.installation_id) {
    const params = new URLSearchParams({ installation_id: searchParams.installation_id });
    if (searchParams.setup_action) params.set('setup_action', searchParams.setup_action);
    redirect(`/api/github/callback?${params.toString()}`);
  }

  const { getToken, userId } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  // If repos already connected, skip onboarding
  const { data: repos } = await listRepos(token);
  if (repos && repos.length > 0) redirect('/dashboard');

  return <OnboardingWizard />;
}
