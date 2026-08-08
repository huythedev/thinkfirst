'use client';

import { Modal } from './Modal';
import { useTranslation } from '@/lib/i18n/client';

export function SessionBehaviorsModal({ isOpen, onClose, behaviorsShown, totalBehaviors }: { isOpen: boolean, onClose: () => void, behaviorsShown: number, totalBehaviors: number }) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('modals.sessionBehaviors.title')}>
      <div className="space-y-6 text-foreground leading-relaxed text-sm">
        <div>
          <p>{t('modals.sessionBehaviors.desc1')}</p>
          <p className="mt-1">{t('modals.sessionBehaviors.desc2')}</p>
        </div>

        <div className="bg-surface-muted p-3 rounded-lg border border-border">
          <p className="font-semibold">{t('session.behaviorsShown', { count: behaviorsShown })}</p>
          <p className="text-foreground-muted mt-1">{t('progress.whatMakesUpScoreDesc')}</p>
        </div>

        <div className="space-y-5">
          <section>
            <h3 className="font-bold text-foreground mb-1">{t('modals.sessionBehaviors.firstTryTitle')}</h3>
            <p className="text-foreground-muted">{t('modals.sessionBehaviors.firstTryDesc')}</p>
          </section>
          
          <section>
            <h3 className="font-bold text-foreground mb-1">{t('modals.sessionBehaviors.hintUseTitle')}</h3>
            <p className="text-foreground-muted">{t('modals.sessionBehaviors.hintUseDesc')}</p>
          </section>

          <section>
            <h3 className="font-bold text-foreground mb-1">{t('modals.sessionBehaviors.explainingTitle')}</h3>
            <p className="text-foreground-muted">{t('modals.sessionBehaviors.explainingDesc')}</p>
          </section>

          <section>
            <h3 className="font-bold text-foreground mb-1">{t('modals.sessionBehaviors.transferTitle')}</h3>
            <p className="text-foreground-muted">{t('modals.sessionBehaviors.transferDesc')}</p>
          </section>

          <section>
            <h3 className="font-bold text-foreground mb-1">{t('modals.sessionBehaviors.checkingTitle')}</h3>
            <p className="text-foreground-muted">{t('modals.sessionBehaviors.checkingDesc')}</p>
          </section>
        </div>
      </div>
    </Modal>
  );
}

export function IndependenceScoreModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('modals.independenceScore.title')}>
      <div className="space-y-4 text-foreground leading-relaxed text-sm">
        <p>{t('modals.independenceScore.desc')}</p>
        
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <p className="font-semibold text-blue-900">{t('modals.independenceScore.notGrade')}</p>
        </div>
        
        <p>{t('modals.independenceScore.evidence')}</p>
      </div>
    </Modal>
  );
}
