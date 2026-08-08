'use client';

import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';
import { useTranslation } from '@/lib/i18n/client';

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
  const { t } = useTranslation();
  const level = Math.min(Math.max(currentHintLevel, 0), MAX_HINT_LEVEL);
  const rung = t(`domain.hintLevels.${level}`) || t(`domain.hintLevels.0`);

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-medium capitalize">
          {t(`domain.subjects.${subject}`) || subject}
        </span>
        <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded font-medium">
          {t(`domain.modes.${mode}`) || mode}
        </span>
        <span className="text-xs bg-surface-muted text-foreground-muted px-2 py-1 rounded font-medium">
          {t(`domain.strictness.${strictness}`) || strictness}
        </span>
        {status !== 'active' && (
          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-medium capitalize">
            {t(`domain.sessionStatus.${status}`) || status}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-[16rem]">
        <span className="text-xs font-medium text-foreground-muted whitespace-nowrap">{t('activeSession.hintLevel')}</span>
        <div
          className="flex gap-1 flex-1"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={MAX_HINT_LEVEL}
          aria-valuenow={level}
          aria-valuetext={t('activeSession.hintLevelDisplay', { current: level, max: MAX_HINT_LEVEL, rung })}
        >
          {Array.from({ length: MAX_HINT_LEVEL + 1 }).map((_, index) => (
            <span
              key={index}
              title={`Level ${index}: ${t(`domain.hintLevels.${index}`)}`}
              className={`h-2 flex-1 rounded-full ${
                index <= level
                  ? index >= 6
                    ? 'bg-background0'
                    : 'bg-blue-500'
                  : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-foreground-muted whitespace-nowrap">
          {level} / {MAX_HINT_LEVEL} &middot; {rung}
        </span>
      </div>

      <div className="text-xs text-foreground-muted whitespace-nowrap">
        {t(turnCount === 1 ? 'activeSession.messages_one' : 'activeSession.messages_other', { count: turnCount })}
      </div>
    </div>
  );
}

