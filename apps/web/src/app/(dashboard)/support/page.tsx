'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { SupportChat } from '@/components/shared/support-chat';

const QUICK_QUESTIONS = [
  'How do I install the GitHub App?',
  'Why are my scans stuck?',
  'What languages are supported?',
  'How do I upgrade to Pro?',
  'How do I suppress a false positive?',
];

export default function SupportPage() {
  const [activeQuestion, setActiveQuestion] = useState<string | undefined>();

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold text-foreground">Support</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Get instant answers from our AI support assistant, or reach out to the
        team.
      </p>

      {/* Quick-start cards */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => setActiveQuestion(q)}
            className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Embedded chat */}
      <div className="mt-6">
        <SupportChat
          embedded
          key={activeQuestion}
          initialMessage={activeQuestion}
        />
      </div>

      {/* Email fallback */}
      <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Mail className="h-4 w-4 shrink-0" />
        <span>
          Need more help?{' '}
          <a
            href="mailto:support@thecodesheriff.com"
            className="font-medium text-primary hover:underline"
          >
            Email support@thecodesheriff.com
          </a>
        </span>
      </div>
    </div>
  );
}
