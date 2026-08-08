import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-4 text-center">
      <h2 className="text-4xl font-bold tracking-tight text-foreground mb-2">404 - Not Found</h2>
      <p className="text-foreground-muted mb-6">Could not find requested resource</p>
      <Link
        href="/"
        className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        Return Home
      </Link>
    </div>
  );
}
