'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onIdTokenChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import { User, Role } from '@/lib/types/user';

interface AuthContextType {
  user: FirebaseUser | null;
  profile: User | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/**
 * Trades the in-memory ID token for an HttpOnly session cookie.
 *
 * Server components cannot read the client SDK's token, so without this the
 * server-side role guards in the student and teacher layouts would see no
 * session and redirect every visitor to sign-in.
 */
async function establishServerSession(firebaseUser: FirebaseUser): Promise<void> {
  try {
    const idToken = await firebaseUser.getIdToken();
    await fetch(window.location.origin + '/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  } catch (error) {
    console.error('Could not establish the server session.', error);
  }
}

async function clearServerSession(): Promise<void> {
  try {
    await fetch(window.location.origin + '/api/auth/session', { method: 'DELETE' });
  } catch (error) {
    console.error('Could not clear the server session.', error);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (uid: string) => {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile({ id: docSnap.id, ...docSnap.data() } as User);
      } else {
        setProfile(null);
      }
    } catch (error) {
      console.error("Error fetching user profile", error);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.uid);
    }
  };

  const logout = async () => {
    try {
      await clearServerSession();
      await firebaseSignOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // The cookie must exist before any server-guarded route is requested.
        await establishServerSession(firebaseUser);
        await fetchProfile(firebaseUser.uid);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, refreshProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
