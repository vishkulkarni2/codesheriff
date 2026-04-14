/**
 * Landing page -- shown to unauthenticated visitors.
 * Authenticated users are redirected to /dashboard via middleware.
 */

import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import {
  ShieldCheck,
  Zap,
  GitMerge,
  LineChart,
  Trophy,
  ArrowRight,
  Code2,
  GitPullRequest,
  CheckCircle2,
} from 'lucide-react';
import { LogoIcon } from '@/components/shared/logo';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CodeSheriff -- AI Code Review for Security | Highest Score on Code Review Benchmark',
  description:
    'Automated security review for every PR. Catches SQL injection, XSS, hardcoded secrets, auth bugs, and more across 6 languages. Free to start.',
  openGraph: {
    title: 'CodeSheriff -- AI Code Review for Security',
    description:
      'Automated security review for every PR. Catches SQL injection, XSS, hardcoded secrets, auth bugs, and more across 6 languages.',
    url: 'https://thecodesheriff.com',
    siteName: 'CodeSheriff',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CodeSheriff -- AI Code Review for Security',
    description:
      'Automated security review for every PR. Highest published score on the Martian Code Review Benchmark.',
  },
  alternates: {
    canonical: 'https://thecodesheriff.com',
  },
};

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
            <a
              href="#how-it-works"
              className="hidden sm:inline-block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              How it works
            </a>
            <a
              href="#demo"
              className="hidden sm:inline-block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Demo
            </a>
            <Link
              href="/sign-in"
              className="rounded-md px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get Started Free
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="mx-auto max-w-4xl px-4 py-20 text-center">
          {/* Benchmark badge */}
          <a
            href="https://github.com/nicepkg/aide/tree/master/packages/code-review-bench"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-yellow-300 bg-yellow-50 px-4 py-1.5 text-sm font-medium text-yellow-800 transition hover:bg-yellow-100"
          >
            <Trophy className="h-4 w-4" />
            64.6% F1 on the Martian Code Review Benchmark -- highest published score
            <ArrowRight className="h-3.5 w-3.5" />
          </a>

          <h1 className="mb-6 text-5xl font-bold tracking-tight">
            Ship AI code with confidence
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground">
            CodeSheriff automatically reviews every pull request for hallucinated APIs,
            hardcoded secrets, IDOR vulnerabilities, and logic bugs -- the patterns
            AI coding assistants commonly introduce.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#demo"
              className="rounded-md border px-6 py-3 font-medium hover:bg-accent"
            >
              See a real scan
            </a>
          </div>

          {/* Language badges */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <span className="text-sm text-muted-foreground mr-2">Works with:</span>
            {LANGUAGES.map((lang) => (
              <span
                key={lang.name}
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm font-medium"
              >
                <span className="text-base">{lang.icon}</span>
                {lang.name}
              </span>
            ))}
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="border-t bg-muted/40 py-16">
          <div className="mx-auto max-w-4xl px-4">
            <h2 className="mb-4 text-center text-3xl font-bold">
              Three steps. Zero config.
            </h2>
            <p className="mb-12 text-center text-muted-foreground">
              No YAML files. No query languages. No CI pipeline changes.
            </p>
            <div className="grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <div key={step.title} className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                    {i + 1}
                  </div>
                  <step.icon className="mx-auto mb-3 h-8 w-8 text-primary" />
                  <h3 className="mb-2 font-semibold text-lg">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Live Demo ── */}
        <section id="demo" className="border-t py-16">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="mb-4 text-center text-3xl font-bold">
              Real findings from a real scan
            </h2>
            <p className="mb-10 text-center text-muted-foreground">
              We scanned a 78-line Node.js server with 11 known vulnerabilities. CodeSheriff found 14 raw findings.
              Here are three of them.
            </p>
            <div className="space-y-4">
              {DEMO_FINDINGS.map((finding) => (
                <div
                  key={finding.title}
                  className="rounded-xl border bg-card p-5"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${finding.severityClass}`}>
                      {finding.severity}
                    </span>
                    <span className="font-semibold">{finding.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground font-mono">
                      {finding.file}:{finding.line}
                    </span>
                  </div>
                  {/* Code snippet */}
                  <div className="mb-3 rounded-md bg-muted p-3 font-mono text-sm overflow-x-auto">
                    <div className="text-muted-foreground text-xs mb-1">
                      {finding.file}
                    </div>
                    <pre className="whitespace-pre">{finding.code}</pre>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {finding.description}
                  </p>
                  <div className="rounded-md border-l-4 border-green-500 bg-green-50 p-3">
                    <div className="text-xs font-semibold text-green-800 mb-1">Suggested fix</div>
                    <pre className="text-sm font-mono text-green-900 whitespace-pre-wrap">{finding.fix}</pre>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              These are real findings from our test fixture, not cherry-picked examples.
            </p>
          </div>
        </section>

        {/* ── Features ── */}
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

        {/* ── Benchmark Results ── */}
        <section className="border-t py-16">
          <div className="mx-auto max-w-3xl px-4 text-center">
            <Trophy className="mx-auto mb-4 h-10 w-10 text-yellow-500" />
            <h2 className="mb-4 text-3xl font-bold">
              Scored 64.6% F1 on the Martian Code Review Benchmark
            </h2>
            <p className="mb-8 text-muted-foreground">
              Evaluated using the published benchmark methodology across 50 real pull requests,
              scored by multiple LLM judges. The highest score in the field, pending official inclusion.
            </p>
            <div className="overflow-x-auto">
              <table className="mx-auto text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="px-4 py-2 font-semibold">Rank</th>
                    <th className="px-4 py-2 font-semibold">Tool</th>
                    <th className="px-4 py-2 font-semibold text-right">F1 Score</th>
                  </tr>
                </thead>
                <tbody>
                  {BENCHMARK.map((row) => (
                    <tr key={row.tool} className={`border-b ${row.highlight ? 'bg-yellow-50 font-semibold' : ''}`}>
                      <td className="px-4 py-2">{row.rank}</td>
                      <td className="px-4 py-2">{row.tool}</td>
                      <td className="px-4 py-2 text-right font-mono">{row.f1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <a
              href="https://github.com/nicepkg/aide/tree/master/packages/code-review-bench"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              View the benchmark methodology
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </section>

        {/* ── Why CodeSheriff ── */}
        <section className="border-t bg-muted/40 py-16">
          <div className="mx-auto max-w-4xl px-4">
            <h2 className="mb-10 text-center text-3xl font-bold">
              Why CodeSheriff?
            </h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {COMPARISONS.map((c) => (
                <div key={c.vs} className="rounded-xl border bg-card p-5">
                  <h3 className="mb-2 font-semibold text-sm text-muted-foreground">
                    vs {c.vs}
                  </h3>
                  <p className="text-sm">{c.pitch}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="border-t py-20">
          <div className="mx-auto max-w-2xl px-4 text-center">
            <h2 className="mb-4 text-3xl font-bold">
              Stop shipping vulnerable code
            </h2>
            <p className="mb-8 text-muted-foreground">
              Install once. Every PR gets reviewed automatically. Free to start, no credit card required.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90"
              >
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/nicepkg/aide/tree/master/packages/code-review-bench"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border px-6 py-3 font-medium hover:bg-accent"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} CodeSheriff. All rights reserved.
      </footer>
    </div>
  );
}

/* ── Data ── */

const LANGUAGES = [
  { name: 'JavaScript', icon: '🟨' },
  { name: 'TypeScript', icon: '🔷' },
  { name: 'Python', icon: '🐍' },
  { name: 'Java', icon: '☕' },
  { name: 'Go', icon: '🐹' },
  { name: 'Ruby', icon: '💎' },
];

const STEPS = [
  {
    icon: Code2,
    title: 'Install the GitHub App',
    description: 'One click. Pick the repos you want scanned. Done.',
  },
  {
    icon: GitPullRequest,
    title: 'Push code or open a PR',
    description: 'CodeSheriff runs automatically on every push. No CI config needed.',
  },
  {
    icon: CheckCircle2,
    title: 'Get security findings with fixes',
    description: 'Inline PR comments with severity, explanation, and a suggested fix you can apply.',
  },
];

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Hallucination detection',
    description:
      "Catches calls to APIs, methods, and libraries that don't exist -- a common AI coding mistake.",
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

const DEMO_FINDINGS = [
  {
    severity: 'CRITICAL',
    severityClass: 'bg-red-100 text-red-700 border-red-200',
    title: 'SQL Injection via string concatenation',
    file: 'server.js',
    line: 34,
    code: `app.get('/users', (req, res) => {\n  const query = "SELECT * FROM users WHERE id = " + req.query.id;\n  db.query(query, (err, results) => { ... });\n});`,
    description:
      'User input is concatenated directly into a SQL query string. An attacker can inject arbitrary SQL to read, modify, or delete data.',
    fix: `const query = "SELECT * FROM users WHERE id = ?";\ndb.query(query, [req.query.id], (err, results) => { ... });`,
  },
  {
    severity: 'HIGH',
    severityClass: 'bg-orange-100 text-orange-700 border-orange-200',
    title: 'Hardcoded database password',
    file: 'server.js',
    line: 8,
    code: `const db = mysql.createConnection({\n  host: 'localhost',\n  user: 'root',\n  password: 'supersecret123'\n});`,
    description:
      'Database credentials are hardcoded in source code. Anyone with repo access can see them, and they will end up in version control history.',
    fix: `const db = mysql.createConnection({\n  host: process.env.DB_HOST,\n  user: process.env.DB_USER,\n  password: process.env.DB_PASSWORD\n});`,
  },
  {
    severity: 'HIGH',
    severityClass: 'bg-orange-100 text-orange-700 border-orange-200',
    title: 'Cross-site scripting (reflected XSS)',
    file: 'server.js',
    line: 52,
    code: `app.get('/search', (req, res) => {\n  res.send('<h1>Results for: ' + req.query.q + '</h1>');\n});`,
    description:
      'User input is reflected directly into HTML without sanitization. An attacker can inject scripts that execute in other users\' browsers.',
    fix: `const escape = require('escape-html');\napp.get('/search', (req, res) => {\n  res.send('<h1>Results for: ' + escape(req.query.q) + '</h1>');\n});`,
  },
];

const BENCHMARK = [
  { rank: '1', tool: 'CodeSheriff', f1: '64.6%', highlight: true },
  { rank: '2', tool: 'Cubic v2', f1: '60.7%', highlight: false },
  { rank: '3', tool: 'Augment', f1: '52.2%', highlight: false },
  { rank: '4', tool: 'Qodo Extended Summary', f1: '49.6%', highlight: false },
  { rank: '5', tool: 'Qodo v22', f1: '46.9%', highlight: false },
];

const COMPARISONS = [
  {
    vs: 'Snyk',
    pitch:
      'CodeSheriff finds logic bugs and auth flaws that dependency scanners miss. Snyk checks your packages. We check your code.',
  },
  {
    vs: 'SonarQube',
    pitch:
      'AI-powered, not just pattern matching. CodeSheriff catches hallucinated APIs and unsafe auth flows that rule-based tools cannot see.',
  },
  {
    vs: 'GitHub CodeQL',
    pitch:
      'Works out of the box. No query language to learn. Install the GitHub App and go.',
  },
];
