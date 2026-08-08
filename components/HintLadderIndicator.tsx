'use client';

import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';

/**
 * Section 8 of module 02. The rungs are named so the indicator says what the
 * student has actually received, not just a number out of seven.
 */
const LADDER_LABELS = [
  'Clarify',
  'Recall',
  'Strategy choice',
  'Guiding question',
  'Partial setup',
  'Worked next step',
  'Partial solution',
  'Full solution',
] as const;

const MODE_LABELS: Record<string, string> = {
  learn: 'Learn',
  practice: 'Practice',
  assignment: 'Assignment',
  verify: 'Verify',
};

const STRICTNESS_LABELS: Record<string, string> = {
  supportive: 'Supportive',
  balanced: 'Balanced',
  independence: 'Independence',
  assessment_safe: 'Assessment safe',
};

interface HintLadderIndicatorProps {
  mode: string;
  subject: string;
  strictness: string;
  currentHintLevel: number;
  status: string;
  turnCount: number;
}

/**
 * The workspace header.
 *
 * Every value displayed here comes from the `learningSessions` document. The
 * hint level in particular is written by the tutoring endpoint with Admin
 * credentials, so what a student sees is the server's position on the ladder.
 * Nothing in this component derives or advances state on its own.
 */
export function HintLadderIndicator({
  mode,
  subject,
  strictness,
  currentHintLevel,
  status,
  turnCount,
}: HintLadderIndicatorProps) {
  const level = Math.min(Math.max(currentHintLevel, 0), MAX_HINT_LEVEL);
  const rung = LADDER_LABELS[level] ?? LADDER_LABELS[0];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-medium capitalize">
          {subject}
        </span>
        <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded font-medium">
          {MODE_LABELS[mode] ?? mode}
        </span>
        <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-medium">
          {STRICTNESS_LABELS[strictness] ?? strictness}
        </span>
        {status !== 'active' && (
          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-medium capitalize">
            {status}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-[16rem]">
        <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Hint level</span>
        <div
          className="flex gap-1 flex-1"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={MAX_HINT_LEVEL}
          aria-valuenow={level}
          aria-valuetext={`Hint level ${level} of ${MAX_HINT_LEVEL}: ${rung}`}
        >
          {LADDER_LABELS.map((label, index) => (
            <span
              key={label}
              title={`Level ${index}: ${label}`}
              className={`h-2 flex-1 rounded-full ${
                index <= level
                  ? index >= 6
                    ? 'bg-amber-500'
                    : 'bg-blue-500'
                  : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">
          {level} / {MAX_HINT_LEVEL} &middot; {rung}
        </span>
      </div>

      <div className="text-xs text-gray-500 whitespace-nowrap">
        {turnCount} {turnCount === 1 ? 'message' : 'messages'}
      </div>
    </div>
  );
}
