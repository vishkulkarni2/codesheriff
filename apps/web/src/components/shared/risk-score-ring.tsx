/**
 * RiskScoreRing — SVG donut chart showing a 0-100 risk score.
 * Colour transitions: green (0-40), amber (41-70), red (71-100).
 */

import { cn } from '@/lib/utils';

interface RiskScoreRingProps {
  score: number;
  size?: number;
  className?: string;
}

function getScoreColour(score: number): string {
  if (score <= 40) return '#16a34a'; // green-600
  if (score <= 70) return '#d97706'; // amber-600
  return '#dc2626';                  // red-600
}

export function RiskScoreRing({ score, size = 80, className }: RiskScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const colour = getScoreColour(clamped);

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={6}
          className="text-muted"
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span
        className="absolute text-sm font-bold"
        style={{ color: colour }}
        aria-label={`Risk score: ${clamped}`}
      >
        {clamped}
      </span>
    </div>
  );
}
