/**
 * Landing page — shown to unauthenticated visitors.
 * Authenticated users are redirected to /dashboard via middleware.
 */

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { ShieldCheck, Zap, GitMerge, LineChart } from 'lucide-react';
import { LogoIcon } from '@/components/shared/logo';

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect('/dashboard');

  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold text-lg">
            <LogoIcon size={20} className="text-primary" />
            CodeSheriff
          </div>
          <nav className="flex items-center gap-3">
            <Link href="/sign-in" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-accent">
              Sign in
            </Link>
            <Link href="/sign-up" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-20 text-center">
          <div className="mb-4 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
            AI-generated code security
          </div>
          <h1 className="mb-6 text-5xl font-bold tracking-tight">
            Ship AI code with confidence
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground">
            CodeSheriff automatically reviews every pull request for hallucinated APIs,
            hardcoded secrets, IDOR vulnerabilities, and logic bugs. The patterns
            AI coding assistants commonly introduce.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/sign-up" className="inline-block rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90">
              Start free, no card required
            </Link>
            <a
              href="#features"
              className="rounded-md border px-6 py-3 font-medium hover:bg-accent"
            >
              See how it works
            </a>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-t bg-muted/40 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="mb-10 text-center text-3xl font-bold">
              Catch what AI misses
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-xl border bg-card p-5">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mb-1 font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} CodeSheriff. All rights reserved.
      </footer>
    </div>
  );
}

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Hallucination detection',
    description:
      "Catches calls to APIs, methods, and libraries that don't exist, a common AI mistake.",
  },
  {
    icon: Zap,
    title: 'Secrets scanning',
    description:
      'Finds hardcoded API keys, tokens, and passwords before they reach production.',
  },
  {
    icon: GitMerge,
    title: 'PR gate integration',
    description:
      'Blocks merges automatically when risk score exceeds your configured threshold.',
  },
  {
    icon: LineChart,
    title: 'Risk trends',
    description:
      'Track how code quality evolves over time with per-repository risk history.',
  },
] as const;
