'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { useTranslation } from '@/lib/i18n/client';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose();
    };

    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) {
        onClose();
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleBackdropClick);

    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/50 p-0 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border-none open:flex flex-col m-auto bg-surface"
      aria-labelledby="modal-title"
    >
      <div className="flex items-center justify-between p-4 border-b border-border bg-surface sticky top-0 z-10">
        <h2 id="modal-title" className="text-lg font-bold text-foreground">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-foreground-muted p-2 rounded-full hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="p-6 overflow-y-auto max-h-[70vh]">
        {children}
      </div>
      <div className="p-4 border-t border-border bg-background flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {t('modals.sessionBehaviors.gotIt')}
        </button>
      </div>
    </dialog>
  );
}
