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

export default async function OnboardingPage() {
  const { getToken, userId } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  // If repos already connected, skip onboarding
  const { data: repos } = await listRepos(token);
  if (repos && repos.length > 0) redirect('/dashboard');

  return <OnboardingWizard />;
}
