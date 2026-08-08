'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * Shows the image a session's problem came from, inside the workspace.
 *
 * Section 34 requires the original image to stay visible alongside the extracted
 * question, so a student who spots a misread character can see both at once.
 *
 * The image is fetched through `GET /api/problem-images/[imageId]` with an ID
 * token rather than through a Storage download URL. A URL that works without a
 * token is a URL that works for anyone who ends up holding it, and section 34
 * requires signed or authenticated access. The object URL created here lives
 * only in this tab's memory and is revoked on unmount.
 */
export function SessionProblemImage({ imageId }: { imageId: string }) {
  const { user } = useAuth();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user || !imageId) return;

    let cancelled = false;
    let created: string | null = null;

    const load = async () => {
      try {
        const response = await fetch(`/api/problem-images/${imageId}`);
        if (!response.ok) throw new Error(`status ${response.status}`);

        const blob = await response.blob();
        if (cancelled) return;

        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch (error) {
        console.error('Could not load the problem image', error);
        if (!cancelled) setFailed(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [user, imageId]);

  if (failed) {
    return (
      <p className="px-6 pb-4 text-xs text-foreground-muted">
        The original image could not be loaded. The problem text above is what the tutor is
        working from.
      </p>
    );
  }

  if (!objectUrl) return null;

  return (
    <div className="border-t border-border p-4">
      <p className="mb-2 text-xs font-medium text-foreground-muted">Original image</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={objectUrl}
        alt="The problem image you uploaded for this session"
        className="max-h-56 w-auto rounded-lg border border-border"
      />
    </div>
  );
}
