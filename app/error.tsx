'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-4 text-center">
      <h2 className="text-3xl font-bold tracking-tight text-foreground mb-2">Something went wrong!</h2>
      {/* The raw message can carry configuration or query detail, so it stays in
          the console and the user gets a stable, non-revealing string. */}
      <p className="text-foreground-muted mb-6">
        An unexpected error occurred. You can try again, or go back and start over.
      </p>
      {error.digest && (
        <p className="text-xs text-gray-400 mb-6">Reference: {error.digest}</p>
      )}
      <div className="flex space-x-4">
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="px-4 py-2 bg-surface text-foreground-muted border border-border font-medium rounded-lg hover:bg-background transition-colors"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
