'use client';

import type { ObservedMetricValue } from '@/hooks/use-teacher-api';

/**
 * The one component that renders an aggregate number on a teacher surface.
 *
 * Two section requirements are enforced here rather than at each call site,
 * because a display rule written out five times drifts in four of them and no
 * test catches it -- the same reasoning that produced `mayDisplayScore` in
 * Phase 5.
 *
 * 1. **A metric with no observations is not zero.** `value === null` renders
 *    "Not yet measured" and never a number. Showing 0% for an unobserved rate is
 *    §56.1's "confidently wrong" defect wearing a percent sign, and Phase 6's
 *    exit criterion separately forbids a placeholder dash standing in for a real
 *    query result. The distinction is that this dash is a *queried* absence: the
 *    denominator was computed and came back zero.
 * 2. **Section 32 requires explanatory tooltips**, including its worked example
 *    that transfer success "is not an official grade".
 */

export type MetricFormat = 'percent' | 'number' | 'count' | 'level';

interface MetricCardProps {
  label: string;
  metric: ObservedMetricValue | number | null;
  format?: MetricFormat;
  /** Section 32: explain what the number means, in plain language. */
  help: string;
  caption?: string;
}

function formatValue(value: number, format: MetricFormat): string {
  switch (format) {
    case 'percent':
      return `${Math.round(value * 100)}%`;
    case 'level':
      return value.toFixed(1);
    case 'count':
      return String(Math.round(value));
    case 'number':
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
}

export function MetricCard({ label, metric, format = 'number', help, caption }: MetricCardProps) {
  const isObserved = typeof metric === 'object' && metric !== null;
  const value = isObserved ? metric.value : (metric as number | null);
  const observed = isObserved ? metric.observed : null;

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-500">{label}</h3>
        <span
          className="text-gray-400 cursor-help text-xs border border-gray-300 rounded-full w-4 h-4 flex items-center justify-center shrink-0"
          title={help}
          aria-label={`About ${label}: ${help}`}
          role="img"
        >
          ?
        </span>
      </div>

      {value === null ? (
        <>
          <p className="text-2xl font-semibold text-gray-400 mt-2">Not yet measured</p>
          <p className="text-sm text-gray-500 mt-1">
            No sessions have produced this evidence yet.
          </p>
        </>
      ) : (
        <>
          <p className="text-3xl font-bold text-gray-900 mt-2">{formatValue(value, format)}</p>
          <p className="text-sm text-gray-500 mt-1">
            {caption ??
              (observed !== null
                ? `Based on ${observed} observed ${observed === 1 ? 'session' : 'sessions'}`
                : '\u00a0')}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Coverage disclosure. §35's amendment asks for the rate of observations marked
 * `unavailable` to be visible, and a teacher reading a dashboard deserves to
 * know how much of it rests on measured evidence.
 */
export function CoverageNote({ coverage }: { coverage: number }) {
  const percent = Math.round(coverage * 100);
  return (
    <p className="text-sm text-gray-500">
      These figures rest on {percent}% evidence coverage. Behavior that was never
      instrumented is excluded from the numbers rather than counted as absent.
    </p>
  );
}
