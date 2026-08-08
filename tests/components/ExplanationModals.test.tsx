/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { SessionBehaviorsModal, IndependenceScoreModal } from '@/components/ExplanationModals';

afterEach(() => {
  cleanup();
});

// Mock translation hook
vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const texts: Record<string, string> = {
        'modals.sessionBehaviors.title': 'How this session is measured',
        'modals.sessionBehaviors.desc1': 'ThinkFirst looks for five learning behaviors while you work.',
        'modals.sessionBehaviors.desc2': 'They help show how independently you worked through the problem.',
        'session.behaviorsShown': '2 of 5 behaviors shown',
        'progress.whatMakesUpScoreDesc': 'Each part is measured only when a session gives evidence for it.',
        'modals.sessionBehaviors.firstTryTitle': '1. First try',
        'modals.sessionBehaviors.hintUseTitle': '2. Hint use',
        'modals.sessionBehaviors.explainingTitle': '3. Explaining',
        'modals.sessionBehaviors.transferTitle': '4. Transfer',
        'modals.sessionBehaviors.checkingTitle': '5. Checking',
        'modals.sessionBehaviors.gotIt': 'Got it',
        'modals.independenceScore.title': 'About the Independence Score',
        'modals.independenceScore.desc': 'The Independence Score represents your ability to solve problems on your own.',
        'modals.independenceScore.notGrade': 'This is not an official grade, an intelligence score, or a ranking against other students.',
        'modals.independenceScore.evidence': 'A score only appears when there is enough evidence.',
      };
      return texts[key] || key;
    }
  })
}));

// We must mock HTMLDialogElement for jsdom
beforeAll(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  }
});

describe('SessionBehaviorsModal', () => {
  it('renders all five behaviors when open', () => {
    const onClose = vi.fn();
    render(
      <SessionBehaviorsModal 
        isOpen={true} 
        onClose={onClose} 
        behaviorsShown={2} 
        totalBehaviors={5} 
      />
    );

    expect(screen.getByText('How this session is measured')).toBeTruthy();
    expect(screen.getByText('1. First try')).toBeTruthy();
    expect(screen.getByText('2. Hint use')).toBeTruthy();
    expect(screen.getByText('3. Explaining')).toBeTruthy();
    expect(screen.getByText('4. Transfer')).toBeTruthy();
    expect(screen.getByText('5. Checking')).toBeTruthy();
  });

  it('calls onClose when Got it button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SessionBehaviorsModal 
        isOpen={true} 
        onClose={onClose} 
        behaviorsShown={2} 
        totalBehaviors={5} 
      />
    );

    const gotItBtn = screen.getByText('Got it');
    fireEvent.click(gotItBtn);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('IndependenceScoreModal', () => {
  it('renders correctly and mentions it is not a grade', () => {
    const onClose = vi.fn();
    render(<IndependenceScoreModal isOpen={true} onClose={onClose} />);

    expect(screen.getByText('About the Independence Score')).toBeTruthy();
    expect(screen.getByText('This is not an official grade, an intelligence score, or a ranking against other students.')).toBeTruthy();
  });
});
