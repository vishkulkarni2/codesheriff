/**
 * FindingsTable — interactive client component.
 * Allows suppressing findings and marking false positives inline
 * without a full page reload.
 */

'use client';

import { useState, useTransition } from 'react';
import { useAuth } from '@clerk/nextjs';
import { SeverityBadge } from './severity-badge';
import { suppressFinding, markFalsePositive } from '@/lib/api';
import { Severity, FindingCategory } from '@codesheriff/shared';
import { EyeOff, XCircle, ChevronDown, ChevronUp, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Finding {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  category: FindingCategory;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string | null;
  suppressed: boolean;
  falsePositive: boolean;
}

interface FindingsTableProps {
  findings: Finding[];
  scanId: string;
}

export function FindingsTable({ findings: initialFindings }: FindingsTableProps) {
  const { getToken } = useAuth();
  const [findings, setFindings] = useState(initialFindings);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function suppress(findingId: string) {
    const token = await getToken();
    if (!token) return;

    startTransition(async () => {
      const res = await suppressFinding(token, findingId, 'Suppressed via dashboard');
      if (!res.success) {
        setError('Failed to suppress finding. Please try again.');
        return;
      }
      setFindings((prev) =>
        prev.map((f) => (f.id === findingId ? { ...f, suppressed: true } : f))
      );
    });
  }

  async function markFP(findingId: string) {
    const token = await getToken();
    if (!token) return;

    startTransition(async () => {
      const res = await markFalsePositive(token, findingId);
      if (!res.success) {
        setError('Failed to mark false positive. Please try again.');
        return;
      }
      setFindings((prev) =>
        prev.map((f) => (f.id === findingId ? { ...f, falsePositive: true } : f))
      );
    });
  }

  if (findings.length === 0) {
    return (
      <div className="rounded-xl border py-12 text-center text-muted-foreground">
        No findings match the current filter.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      {error && (
        <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="divide-y">
        {findings.map((finding) => {
          const isExpanded = expandedId === finding.id;
          const isDimmed = finding.suppressed || finding.falsePositive;

          return (
            <div
              key={finding.id}
              className={cn('group', isDimmed && 'opacity-50')}
            >
              {/* Summary row */}
              <div className="flex items-start gap-3 px-4 py-3">
                <SeverityBadge severity={finding.severity} className="mt-0.5 shrink-0" />

                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : finding.id)}
                    className="flex w-full items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{finding.title}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {finding.filePath}:{finding.lineStart}
                      </p>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </div>

                {/* Actions */}
                {!isDimmed && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => suppress(finding.id)}
                      disabled={isPending}
                      title="Suppress finding"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <EyeOff className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => markFP(finding.id)}
                      disabled={isPending}
                      title="Mark as false positive"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {isDimmed && (
                  <span className="text-xs text-muted-foreground">
                    {finding.suppressed ? 'Suppressed' : 'False positive'}
                  </span>
                )}
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t bg-muted/30 px-4 pb-4 pt-3">
                  <p className="mb-3 text-sm text-foreground">{finding.description}</p>
                  {finding.codeSnippet && (
                    <div className="flex items-start gap-2">
                      <Code2 className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <pre className="overflow-x-auto rounded bg-background p-3 font-mono text-xs leading-relaxed">
                        {finding.codeSnippet}
                      </pre>
                    </div>
                  )}
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span>Category: {finding.category}</span>
                    <span>Lines: {finding.lineStart}-{finding.lineEnd}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
