'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Matches the ceiling the security rule enforces on the field. */
export const SCRATCHPAD_MAX_LENGTH = 20000;

const SAVE_DEBOUNCE_MS = 800;

interface ScratchpadProps {
  initialValue: string;
  onSave: (value: string) => Promise<unknown>;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The student's private working notes for a session.
 *
 * Notes persist on the session document so they survive leaving and returning,
 * which is the same durability the transcript has. Writes are debounced because
 * a keystroke-per-write would be one Firestore write per character.
 *
 * The value is intentionally not fed back from the session snapshot after the
 * first load: this is a single-author textarea, and re-syncing it from the
 * server would fight the cursor while the student is typing.
 *
 * Callers must pass a `key` of the session id so a navigation between sessions
 * remounts this component with the right notes.
 */
export function Scratchpad({ initialValue, onSave }: ScratchpadProps) {
  const [value, setValue] = useState(initialValue);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

  const flush = useCallback(
    async (next: string) => {
      setSaveState('saving');
      try {
        await onSave(next);
        pendingRef.current = null;
        setSaveState('saved');
      } catch (error) {
        console.error('Failed to save scratchpad', error, {
          code: (error as any)?.code,
          message: (error as any)?.message,
        });
        setSaveState('error');
      }
    },
    [onSave],
  );

  const handleChange = (next: string) => {
    const clipped = next.slice(0, SCRATCHPAD_MAX_LENGTH);
    setValue(clipped);
    pendingRef.current = clipped;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(clipped), SAVE_DEBOUNCE_MS);
  };

  // A student who closes the tab mid-edit should not lose the last few seconds
  // of notes, so the pending value is written on unmount as well.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const pending = pendingRef.current;
      if (pending !== null) void onSave(pending).catch(() => undefined);
    };
  }, [onSave]);

  const statusText =
    saveState === 'saving'
      ? 'Saving...'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Not saved'
          : '';

  return (
    <section
      aria-labelledby="scratchpad-heading"
      className="bg-white border border-gray-200 rounded-2xl flex flex-col overflow-hidden shadow-sm h-full"
    >
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h2 id="scratchpad-heading" className="font-bold text-gray-800">
          Scratchpad
        </h2>
        <span
          aria-live="polite"
          className={`text-xs ${saveState === 'error' ? 'text-red-600' : 'text-gray-500'}`}
        >
          {statusText}
        </span>
      </div>

      <textarea
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          if (pendingRef.current !== null) void flush(pendingRef.current);
        }}
        placeholder="Work out your steps here. Only you can see this."
        aria-label="Scratchpad for your own working notes"
        className="flex-1 w-full p-4 font-mono text-sm text-gray-900 outline-none resize-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
      />

      {saveState === 'error' && (
        <p role="alert" className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100">
          Your notes could not be saved. They are still here, so you can copy them.
        </p>
      )}
    </section>
  );
}
