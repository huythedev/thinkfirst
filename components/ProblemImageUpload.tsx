'use client';

import { useId, useRef, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  ALLOWED_IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
} from '@/lib/images/validation';

/**
 * Problem image upload and extraction confirmation, per section 34 of
 * `instructions/07_FRONTEND_UX_ACCESSIBILITY.md`.
 *
 * Section 34's display list is the specification for what this renders: the
 * original image, the extracted question, an "edit extracted text" affordance,
 * and a confidence warning when one is needed.
 *
 * The client-side size and type checks below are a courtesy, not a control. They
 * exist so a student who picks a 40 MB photo learns that instantly instead of
 * after an upload. Every one of them is repeated server-side in
 * `lib/images/validation.ts` against the actual bytes, because anything checked
 * only here is not checked at all.
 */

export interface ExtractionOutcome {
  imageId: string;
  text: string;
  confidence: number;
  requiresConfirmation: boolean;
  confirmed: boolean;
  subject: string;
}

interface UploadState {
  imageId: string;
  previewUrl: string;
  extractedText: string;
  confidence: number;
  requiresConfirmation: boolean;
  warnings: string[];
  containsProblem: boolean;
  containsStudentWork: boolean;
  containsPersonalInformation: boolean;
  subject: string;
  extractionAvailable: boolean;
}

interface ProblemImageUploadProps {
  /** Called whenever the usable problem text changes, including after correction. */
  onExtraction: (outcome: ExtractionOutcome | null) => void;
  /**
   * Called when an image is attached or removed, separately from whether its
   * text is usable yet.
   *
   * The two are genuinely different states and collapsing them is a bug: an
   * image awaiting confirmation reports no usable extraction, so a caller
   * watching only `onExtraction` would see "no image" and let the student start
   * a session on an empty textarea instead of telling them to confirm the text.
   */
  onAttachedChange?: (attached: boolean) => void;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

const ACCEPT = ALLOWED_IMAGE_FORMATS.join(',');

export function ProblemImageUpload({ onExtraction, onAttachedChange }: ProblemImageUploadProps) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  const [upload, setUpload] = useState<UploadState | null>(null);
  const [editedText, setEditedText] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const reset = () => {
    if (upload) URL.revokeObjectURL(upload.previewUrl);
    setUpload(null);
    setEditedText('');
    setEditing(false);
    setConfirmed(false);
    setError(null);
    setStatus('');
    if (inputRef.current) inputRef.current.value = '';
    onExtraction(null);
    onAttachedChange?.(false);
  };

  const handleFile = async (file: File) => {
    setError(null);

    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Images must be ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller.`);
      return;
    }
    if (file.type && !(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(file.type)) {
      setError('Upload a PNG, JPEG, WebP or GIF image.');
      return;
    }
    if (!user) {
      setError('Sign in again to upload an image.');
      return;
    }

    setBusy(true);
    setStatus('Reading your image. This can take a few seconds.');

    try {
      const body = new FormData();
      body.append('image', file);

      const response = await fetch('/api/problem-images', {
        method: 'POST',
        body,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? 'Could not process that image.');
        setStatus('');
        return;
      }

      const next: UploadState = {
        imageId: payload.imageId,
        previewUrl: URL.createObjectURL(file),
        extractedText: payload.extractedText ?? '',
        confidence: payload.confidence ?? 0,
        requiresConfirmation: Boolean(payload.requiresConfirmation),
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        containsProblem: Boolean(payload.containsProblem),
        containsStudentWork: Boolean(payload.containsStudentWork),
        containsPersonalInformation: Boolean(payload.containsPersonalInformation),
        subject: typeof payload.subject === 'string' ? payload.subject : 'other',
        extractionAvailable: payload.extractionAvailable !== false,
      };

      setUpload(next);
      setEditedText(next.extractedText);
      setConfirmed(false);
      onAttachedChange?.(true);
      // A low-confidence extraction opens in edit mode. The student is being
      // asked to check it, and an editable field says that more clearly than a
      // button they have to find first.
      setEditing(next.requiresConfirmation);
      setStatus(
        next.requiresConfirmation
          ? 'Check the extracted text before starting. Some of it may be wrong.'
          : 'Text extracted. Check it looks right, then start.',
      );

      // Nothing is usable until confirmation happens, so the parent is told
      // there is no problem text yet whenever confirmation is required.
      onExtraction(
        next.requiresConfirmation
          ? null
          : {
              imageId: next.imageId,
              text: next.extractedText,
              confidence: next.confidence,
              requiresConfirmation: false,
              confirmed: false,
              subject: next.subject,
            },
      );
    } catch (uploadError) {
      console.error('Image upload failed', uploadError);
      setError('Could not upload that image. Check your connection and try again.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!upload || !user) return;
    const text = editedText.trim();
    if (text.length === 0) {
      setError('The problem text cannot be empty.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/problem-images/${upload.imageId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmedText: text }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? 'Could not confirm that text.');
        return;
      }

      setConfirmed(true);
      setEditing(false);
      setStatus('Text confirmed. You can start the session.');
      onExtraction({
        imageId: upload.imageId,
        text,
        confidence: upload.confidence,
        requiresConfirmation: upload.requiresConfirmation,
        confirmed: true,
        subject: upload.subject,
      });
    } catch (confirmError) {
      console.error('Confirmation failed', confirmError);
      setError('Could not confirm that text. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${fieldId}-file`} className="block text-sm font-medium text-foreground-muted mb-2">
          Or upload a photo of the problem
        </label>
        <input
          ref={inputRef}
          id={`${fieldId}-file`}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
          className="block w-full text-sm text-foreground-muted file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
          aria-describedby={`${fieldId}-privacy ${fieldId}-limits`}
        />
        <p id={`${fieldId}-limits`} className="mt-2 text-xs text-foreground-muted">
          PNG, JPEG, WebP or GIF, up to {Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB and{' '}
          {MAX_IMAGE_DIMENSION} pixels a side.
        </p>
        {/* Section 34: warn students not to upload personal documents. */}
        <p id={`${fieldId}-privacy`} className="mt-1 text-xs text-foreground-muted">
          Upload only the problem. Do not upload ID cards, letters, medical or financial documents,
          or photos showing other people.
        </p>
      </div>

      {/* Screen-reader announcement for a step that can take several seconds. */}
      <p role="status" aria-live="polite" className="sr-only">
        {busy ? 'Reading your image.' : status}
      </p>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {busy && !upload && (
        <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
          Reading your image. This can take a few seconds.
        </div>
      )}

      {upload && (
        <div className="rounded-xl border border-border p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-sm font-semibold text-foreground">From your image</h3>
            <button
              type="button"
              onClick={reset}
              className="text-xs font-medium text-foreground-muted underline hover:text-foreground-muted"
            >
              Remove image
            </button>
          </div>

          {/* Section 34: show the original image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={upload.previewUrl}
            alt="The problem image you uploaded"
            className="max-h-64 w-auto rounded-lg border border-border"
          />

          {upload.containsPersonalInformation && (
            <div role="alert" className="rounded-lg bg-background p-3 text-sm text-amber-900">
              This image looks like it contains personal information. Only the problem text was
              kept, but consider removing the image and uploading a closer photo of just the
              question.
            </div>
          )}

          {/* Section 34: extraction-confidence warning when needed. Not colour
              alone, per section 40: the heading states the condition in words. */}
          {upload.requiresConfirmation && !confirmed && (
            <div className="rounded-lg bg-background p-3 text-sm text-amber-900">
              <p className="font-semibold">Check this text before you start</p>
              <p className="mt-1">
                {upload.extractionAvailable
                  ? `Some of this image was hard to read (confidence ${formatConfidence(upload.confidence)}). Fix anything that is wrong, then confirm it.`
                  : 'The text in this image could not be read automatically. Type the problem below, then confirm it.'}
              </p>
              {upload.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5">
                  {upload.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {upload.containsStudentWork && (
            <p className="text-xs text-foreground-muted">
              Your own working was left out, so the tutor starts from the question itself.
            </p>
          )}

          <div>
            <label
              htmlFor={`${fieldId}-text`}
              className="block text-sm font-medium text-foreground-muted mb-2"
            >
              Extracted question
            </label>
            {editing ? (
              <textarea
                id={`${fieldId}-text`}
                value={editedText}
                onChange={(event) => {
                  setEditedText(event.target.value);
                  // Editing after confirming invalidates the confirmation:
                  // otherwise the confirmed text and the shown text diverge.
                  if (confirmed) {
                    setConfirmed(false);
                    onExtraction(null);
                  }
                }}
                rows={5}
                className="w-full rounded-xl border border-border p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <div
                id={`${fieldId}-text`}
                className="whitespace-pre-wrap rounded-xl bg-background p-3 font-mono text-sm text-foreground"
              >
                {editedText || 'No text was found in this image.'}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-background"
              >
                Edit extracted text
              </button>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || confirmed}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {confirmed ? 'Text confirmed' : 'Confirm this text'}
            </button>
            {confirmed && (
              <span className="text-sm text-green-700">Ready to start.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
