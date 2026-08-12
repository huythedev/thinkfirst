'use client';

import { useState } from 'react';
import { ComponentScore, ComponentId, SessionScore } from '@/lib/types/scoring';
import { useTranslation } from '@/lib/i18n/client';
import { SessionBehaviorsModal } from './ExplanationModals';

interface LiveScorePanelProps {
  score: SessionScore | null;
}

/**
 * Order matters: this mirrors the learning loop in section 55, so the student
 * reads it as a sequence of things to do rather than a list of judgements.
 */
const DISPLAY_ORDER: ComponentId[] = [
  'firstAttempt',
  'hintEfficiency',
  'reasoningExplanation',
  'transferPerformance',
  'verificationBehavior',
];

function Dot({ component, label }: { component: ComponentScore | undefined, label: string }) {
  // `value` is already normalized to [0,1] in v2, so no division by weight.
  const measured = Boolean(component && component.value !== null && component.confidence > 0);
  const ratio = measured ? (component!.value ?? 0) : 0;

  const tone = !measured
    ? 'bg-gray-200'
    : ratio >= 0.75
      ? 'bg-green-500'
      : ratio >= 0.45
        ? 'bg-blue-500'
        : 'bg-background0';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full shrink-0 ${tone}`} aria-hidden="true" />
      <span className={`text-xs ${measured ? 'text-foreground-muted' : 'text-gray-400'}`}>
        {label}
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
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const components = score?.components ?? [];
  const byId = new Map(components.map((component) => [component.id, component]));
  const measuredCount = components.filter(
    (component) => component.value !== null && component.confidence > 0,
  ).length;

  // §56.3 decides this, not the component: a session below 0.35 coverage is
  // recorded and must not be shown as a session score. `displaySuppressed`
  // carries that decision so the rule lives in one place.
  const hasEnoughEvidence = score !== null && score.rawScore !== null && !score.displaySuppressed;

  const getLabel = (id: string) => {
    switch (id) {
      case 'firstAttempt': return t('session.firstTry');
      case 'hintEfficiency': return t('session.hintUse');
      case 'reasoningExplanation': return t('session.explaining');
      case 'transferPerformance': return t('session.transfer');
      case 'verificationBehavior': return t('session.checking');
      default: return '';
    }
  };

  return (
    <>
      <section
        className="border-t border-border bg-surface px-4 py-3"
        aria-label="Session progress"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground-muted flex items-center gap-1.5">
              {t('session.thisSession')}
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="text-gray-400 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                aria-label={t('session.infoBtn')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              </button>
            </h3>
            <span className="text-xs text-gray-400">
              {measuredCount === 0
                ? t('session.nothingRecorded')
                : t('session.behaviorsShown', { count: measuredCount })}
            </span>
          </div>

          <div aria-live="polite" aria-atomic="true" className="text-xs text-foreground-muted">
            {score?.excludedForSystemError ? (
              <span className="text-gray-400">{t('session.notScored')}</span>
            ) : !hasEnoughEvidence ? (
              <span className="text-gray-400">{t('session.keepGoing')}</span>
            ) : (
              <span>
                <span className="font-semibold text-foreground tabular-nums">
                  {Math.round(score!.rawScore!)}
                </span>
                <span className="text-gray-400">{t('session.soFar')}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
          {DISPLAY_ORDER.map((id) => (
            <Dot key={id} component={byId.get(id)} label={getLabel(id)} />
          ))}
        </div>
      </section>

      <SessionBehaviorsModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        behaviorsShown={measuredCount} 
        totalBehaviors={5} 
      />
    </>
  );
}

export default LiveScorePanel;
