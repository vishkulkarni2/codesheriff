/**
 * RulesManager — client component for CRUD on custom semgrep rules.
 */

'use client';

import { useState, useTransition } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createRule, deleteRule } from '@/lib/api';
import type { Rule } from '@codesheriff/shared';
import { Plus, Trash2, Code2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const LANGUAGES = ['typescript', 'javascript', 'python', 'go', 'java', 'ruby'] as const;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

interface RulesManagerProps {
  initialRules: Rule[];
}

export function RulesManager({ initialRules }: RulesManagerProps) {
  const { getToken } = useAuth();
  const [rules, setRules] = useState(initialRules);
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    pattern: '',
    language: 'typescript' as (typeof LANGUAGES)[number],
    severity: 'HIGH' as (typeof SEVERITIES)[number],
  });

  function updateForm(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate() {
    if (!form.name || !form.pattern) {
      setError('Name and pattern are required.');
      return;
    }
    const token = await getToken();
    if (!token) return;

    startTransition(async () => {
      setError(null);
      const res = await createRule(token, form);
      if (!res.success || !res.data) {
        setError(res.error ?? 'Failed to create rule.');
        return;
      }
      setRules((prev) => [...prev, res.data!]);
      setShowForm(false);
      setForm({ name: '', description: '', pattern: '', language: 'typescript', severity: 'HIGH' });
    });
  }

  async function handleDelete(ruleId: string) {
    const token = await getToken();
    if (!token) return;

    startTransition(async () => {
      const res = await deleteRule(token, ruleId);
      if (!res.success) {
        setError('Failed to delete rule. You may not have permission.');
        return;
      }
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Rule list */}
      <div className="overflow-hidden rounded-xl border">
        {rules.length === 0 && !showForm ? (
          <div className="py-12 text-center text-muted-foreground">
            No custom rules yet. Create one to extend the default ruleset.
          </div>
        ) : (
          <div className="divide-y">
            {rules.map((rule) => (
              <div key={rule.id} className="group flex items-start gap-3 px-4 py-3">
                <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{rule.name}</p>
                  <p className="text-sm text-muted-foreground">{rule.description}</p>
                  <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                    <span>{rule.category}</span>
                    <span>·</span>
                    <span>{rule.severity}</span>
                    {rule.organizationId === null && (
                      <>
                        <span>·</span>
                        <span className="text-primary">Global</span>
                      </>
                    )}
                  </div>
                </div>
                {rule.organizationId !== null && (
                  <button
                    onClick={() => handleDelete(rule.id)}
                    disabled={isPending}
                    title="Delete rule"
                    className="rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create form */}
      {showForm ? (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-4 font-semibold">New rule</h3>
          <div className="grid gap-3">
            <FormField label="Name" required>
              <input
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                placeholder="e.g. Dangerous eval usage"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormField>
            <FormField label="Description">
              <input
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                placeholder="What does this rule detect?"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormField>
            <FormField label="Semgrep pattern" required>
              <textarea
                value={form.pattern}
                onChange={(e) => updateForm('pattern', e.target.value)}
                rows={4}
                placeholder="eval($X)"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Language">
                <select
                  value={form.language}
                  onChange={(e) => updateForm('language', e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Severity">
                <select
                  value={form.severity}
                  onChange={(e) => updateForm('severity', e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </FormField>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? 'Creating…' : 'Create rule'}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(null); }}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 self-start rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <Plus className="h-4 w-4" />
          Add rule
        </button>
      )}
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
