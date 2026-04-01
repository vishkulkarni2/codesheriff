'use client';

/**
 * RiskTrendChart — stacked area chart showing daily findings over time.
 *
 * Data: DailyFindingCount[] from the dashboard API.
 * Rendered with Recharts ResponsiveContainer + AreaChart.
 *
 * Stacks critical (red) and high (orange) on top of the total (blue/muted)
 * so the most dangerous findings are visually prominent.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { DailyFindingCount } from '@codesheriff/shared';

interface RiskTrendChartProps {
  data: DailyFindingCount[];
}

// Format "2026-03-14" → "Mar 14"
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RiskTrendChart({ data }: RiskTrendChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    date: fmtDate(d.date),
    // "other" = total minus critical and high (to avoid double-counting)
    other: Math.max(0, d.count - d.critical - d.high),
  }));

  return (
    <div className="rounded-xl border bg-card p-4">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={formatted} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="gradCritical" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradHigh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f97316" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradOther" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />

          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />

          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: 12,
            }}
            labelStyle={{ fontWeight: 600, marginBottom: 4 }}
          />

          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />

          {/* Render "other" first (bottom of stack) */}
          <Area
            type="monotone"
            dataKey="other"
            name="Other"
            stackId="1"
            stroke="#94a3b8"
            fill="url(#gradOther)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="high"
            name="High"
            stackId="1"
            stroke="#f97316"
            fill="url(#gradHigh)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="critical"
            name="Critical"
            stackId="1"
            stroke="#ef4444"
            fill="url(#gradCritical)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
