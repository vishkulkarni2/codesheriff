import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a relative time label from an ISO date string.
 * E.g. "2 minutes ago", "3 days ago"
 */
export function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  const intervals: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];

  if (seconds < 60) return 'just now';

  for (let i = intervals.length - 1; i >= 0; i--) {
    const [threshold, unit] = intervals[i]!;
    if (seconds >= threshold) {
      const count = Math.floor(seconds / threshold);
      return `${count} ${unit}${count !== 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}
