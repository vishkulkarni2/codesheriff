/**
 * SeverityBadge — colour-coded pill for finding severity.
 * Uses explicit CSS classes (not dynamic class names) so Tailwind includes them.
 */

import { cn } from '@/lib/utils';
import { Severity } from '@codesheriff/shared';

const SEVERITY_STYLES: Record<Severity, string> = {
  [Severity.CRITICAL]: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400',
  [Severity.HIGH]:     'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400',
  [Severity.MEDIUM]:   'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400',
  [Severity.LOW]:      'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400',
  [Severity.INFO]:     'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400',
};

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        SEVERITY_STYLES[severity],
        className
      )}
    >
      {severity}
    </span>
  );
}
