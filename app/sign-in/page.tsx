'use client';

import { useEffect, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '@/lib/firebase/config';
import { useAuth } from '@/components/providers/AuthProvider';
import { doc, getDoc } from 'firebase/firestore';

export default function SignInPage() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [error, setError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (profile) {
        router.push(profile.role === 'teacher' ? '/teacher' : '/student');
      } else {
        router.push('/onboarding');
      }
    }
  }, [user, profile, loading, router]);

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      
      const userRef = doc(db, 'users', result.user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        router.push('/onboarding');
      } else {
        await refreshProfile();
      }
    } catch (err: any) {
      console.error('[Google Sign-In]', err);
      
      // Provide more detailed error information
      let errorMessage = 'Failed to sign in. Please try again.';
      
      if (err instanceof FirebaseError) {
        
        // Map common Firebase auth errors to user-friendly messages
        const errorMappings: Record<string, string> = {
          'auth/network-request-failed': 'Network error. Please check your internet connection.',
          'auth/popup-blocked': 'Sign-in popup was blocked. Please allow popups for this site.',
          'auth/cancelled-popup-request': 'Sign-in was cancelled.',
          'auth/credential-already-in-use': 'This Google account is already linked to another user.',
          'auth/email-already-in-use': 'This Google account is already registered with a different method.',
          'auth/requires-recent-login': 'Please sign out and sign in again.',
          'auth/user-disabled': 'This account has been disabled.',
          'auth/user-not-found': 'No account found with this email.',
          'auth/wrong-password': 'Incorrect password.',
          'auth/invalid-credential': 'Invalid credentials. Please try again.',
          'auth/invalid-api-key': 'Configuration error. Please refresh the page.',
          'auth/app-deleted': 'Firebase configuration error. Please contact support.',
          'auth/app-not-authorized': 'App not authorized. Please contact support.',
          'auth/argument-error': 'Internal configuration error.',
        };
        
        errorMessage = errorMappings[err.code] || `Authentication failed (${err.code}). Please try again.`;
      } else if (err instanceof Error) {
        errorMessage = err.message || 'An unexpected error occurred.';
      }
      
      setError(errorMessage);
    } finally {
      setIsSigningIn(false);
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 space-y-8 border border-gray-100">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Sign in</h1>
          <p className="mt-2 text-gray-600">Continue to ThinkFirst</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={isSigningIn}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  );
}
