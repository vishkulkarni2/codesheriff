/**
 * Rules manager — view and manage custom semgrep rules.
 * Create, test, and delete org-specific detection rules.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { listRules } from '@/lib/api';
import { RulesManager } from '@/components/shared/rules-manager';

export const metadata = { title: 'Rules' };

export default async function RulesPage() {
  const { getToken, userId } = auth();
  if (!userId) redirect('/sign-in');

  const token = await getToken();
  if (!token) redirect('/sign-in');

  const { data: rules, error } = await listRules(token);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
        Failed to load rules. Please refresh.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Rules</h1>
        <p className="text-sm text-muted-foreground">
          Manage custom semgrep patterns applied to every scan.
        </p>
      </div>
      <RulesManager initialRules={rules ?? []} />
    </div>
  );
}
