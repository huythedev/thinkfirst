'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        // Stay on landing or redirect to sign-in
        // For MVP we just show a landing with login button
      } else if (!profile) {
        router.push('/onboarding');
      } else if (profile.role === 'student') {
        router.push('/student');
      } else if (profile.role === 'teacher') {
        router.push('/teacher');
      } else if (profile.role === 'admin') {
        router.push('/admin');
      }
    }
  }, [user, profile, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-12 w-12 bg-blue-500 rounded-full mb-4"></div>
          <p className="text-foreground-muted font-medium">Loading ThinkFirst...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 bg-surface">
      <main className="max-w-3xl text-center space-y-8">
        <h1 className="text-5xl font-extrabold tracking-tight text-foreground">
          Think<span className="text-blue-600">First</span>
        </h1>
        <p className="text-xl text-foreground-muted max-w-2xl mx-auto leading-relaxed">
          An adaptive AI learning assistant that changes how AI responds based on your age, ability, and task. 
          Instead of just giving answers, we help you think, explain, and verify.
        </p>
        
        <div className="pt-8">
          <button 
            onClick={() => router.push('/sign-in')}
            className="px-8 py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Sign in to start learning
          </button>
        </div>
      </main>
    </div>
  );
}
