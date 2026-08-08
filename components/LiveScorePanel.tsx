'use client';

import { COMPONENT_WEIGHTS } from '@/lib/scoring/independence';
import { ComponentScore, SessionScore } from '@/lib/types/scoring';

interface LiveScorePanelProps {
  score: SessionScore | null;
}

/**
 * Order matters: this mirrors the learning loop in section 55, so the student
 * reads it as a sequence of things to do rather than a list of judgements.
 */
const DISPLAY_ORDER: (keyof typeof COMPONENT_WEIGHTS)[] = [
  'firstAttempt',
  'hintEfficiency',
  'reasoningExplanation',
  'transferPerformance',
  'verificationBehavior',
];

const SHORT_LABELS: Record<string, string> = {
  firstAttempt: 'First try',
  hintEfficiency: 'Hint use',
  reasoningExplanation: 'Explaining',
  transferPerformance: 'Transfer',
  verificationBehavior: 'Checking',
};

function Dot({ component }: { component: ComponentScore | undefined }) {
  // `value` is already normalized to [0,1] in v2, so no division by weight.
  const measured = Boolean(component && component.value !== null && component.confidence > 0);
  const ratio = measured ? (component!.value ?? 0) : 0;

  const tone = !measured
    ? 'bg-gray-200'
    : ratio >= 0.75
      ? 'bg-green-500'
      : ratio >= 0.45
        ? 'bg-blue-500'
        : 'bg-amber-500';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full shrink-0 ${tone}`} aria-hidden="true" />
      <span className={`text-xs ${measured ? 'text-gray-700' : 'text-gray-400'}`}>
        {SHORT_LABELS[component?.id ?? ''] ?? ''}
      </span>
    </div>
  );
}

/**
 * A quiet, live view of what this session has shown so far.
 *
 * Deliberately shows *which behaviors have registered* rather than leading with
 * a number. Section 13 forbids treating the score as a grade, and a large
 * prominent number during a session invites exactly that reading. The number is
 * present but secondary.
 */
export function LiveScorePanel({ score }: LiveScorePanelProps) {
  const components = score?.components ?? [];
  const byId = new Map(components.map((component) => [component.id, component]));
  const measuredCount = components.filter(
    (component) => component.value !== null && component.confidence > 0,
  ).length;

  // §56.3 decides this, not the component: a session below 0.35 coverage is
  // recorded and must not be shown as a session score. `displaySuppressed`
  // carries that decision so the rule lives in one place.
  const hasEnoughEvidence = score !== null && score.rawScore !== null && !score.displaySuppressed;

  return (
    <section
      className="border-t border-gray-200 bg-white px-4 py-3"
      aria-label="Session progress"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-700">This session</h3>
          <span className="text-xs text-gray-400">
            {measuredCount === 0
              ? 'nothing recorded yet'
              : `${measuredCount} of 5 behaviors shown`}
          </span>
        </div>

        <div aria-live="polite" aria-atomic="true" className="text-xs text-gray-600">
          {score?.excludedForSystemError ? (
            <span className="text-gray-400">Not scored: something went wrong on our side</span>
          ) : !hasEnoughEvidence ? (
            <span className="text-gray-400">Keep going to see your score</span>
          ) : (
            <span>
              <span className="font-semibold text-gray-900 tabular-nums">
                {Math.round(score!.rawScore!)}
              </span>
              <span className="text-gray-400"> / 100 so far</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
        {DISPLAY_ORDER.map((id) => (
          <Dot key={id} component={byId.get(id)} />
        ))}
      </div>
    </section>
  );
}

export default LiveScorePanel;
