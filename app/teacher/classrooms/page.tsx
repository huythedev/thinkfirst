'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { db } from '@/lib/firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import Link from 'next/link';

interface Classroom {
  id: string;
  name: string;
  grade: number;
  subject: string;
  defaultStrictness: string;
}

export default function ClassroomsPage() {
  const { user } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClassrooms = async () => {
      if (!user) return;
      try {
        const classroomsRef = collection(db, 'classrooms');
        const q = query(classroomsRef, where('teacherId', '==', user.uid));
        const snapshot = await getDocs(q);
        
        const fetchedClassrooms = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Classroom[];
        
        setClassrooms(fetchedClassrooms);
      } catch (error) {
        console.error('Error fetching classrooms:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchClassrooms();
  }, [user]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Classrooms</h1>
          <p className="text-foreground-muted mt-2">Manage your classes and students.</p>
        </div>
        <Link 
          href="/teacher/classrooms/new" 
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Create Classroom
        </Link>
      </div>

      {classrooms.length === 0 ? (
        <div className="bg-surface p-12 rounded-xl border border-border shadow-sm text-center">
          <p className="text-foreground-muted mb-4">You haven&apos;t created any classrooms yet.</p>
          <Link href="/teacher/classrooms/new" className="text-blue-600 hover:text-blue-800 font-medium">
            Create your first classroom
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {classrooms.map((classroom) => (
            <Link key={classroom.id} href={`/teacher/classrooms/${classroom.id}`}>
              <div className="bg-surface p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-foreground">{classroom.name}</h3>
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-foreground-muted">Grade {classroom.grade}</p>
                    <p className="text-sm text-foreground-muted">{classroom.subject}</p>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                  <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    Open classroom to view its join code
                  </span>
                  <span className="text-sm text-blue-600 font-medium">View &rarr;</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
