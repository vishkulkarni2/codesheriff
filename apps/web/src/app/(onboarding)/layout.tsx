/**
 * Onboarding layout — clean, centred, no sidebar.
 * Used only during the first-run setup flow.
 */

import { ShieldCheck } from 'lucide-react';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-background to-muted/30">
      {/* Minimal header */}
      <header className="flex h-14 items-center gap-2 border-b bg-background/80 px-6 backdrop-blur">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <span className="font-semibold">CodeSheriff</span>
      </header>

      {/* Centred content */}
      <main className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
