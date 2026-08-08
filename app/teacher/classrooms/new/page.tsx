'use client';

import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewClassroom() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    grade: 6,
    subject: 'Mathematics',
    defaultStrictness: 'balanced',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/teacher/classrooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({
          name: formData.name,
          grade: Number(formData.grade),
          subject: formData.subject,
          defaultStrictness: formData.defaultStrictness,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Failed to create classroom');

      router.push('/teacher/classrooms');
    } catch (err: any) {
      console.error('Error creating classroom:', err);
      setError(err.message || 'Failed to create classroom');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/teacher/classrooms" className="text-gray-500 hover:text-gray-900">
          &larr; Back
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Create New Classroom</h1>
      </div>

      <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Classroom Name
            </label>
            <input
              type="text"
              id="name"
              required
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Grade 8 Algebra - Section A"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="grade" className="block text-sm font-medium text-gray-700 mb-1">
                Grade Level
              </label>
              <select
                id="grade"
                value={formData.grade}
                onChange={(e) => setFormData({...formData, grade: Number(e.target.value)})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={6}>Grade 6</option>
                <option value={7}>Grade 7</option>
                <option value={8}>Grade 8</option>
                <option value={9}>Grade 9</option>
                <option value={10}>Grade 10</option>
                <option value={11}>Grade 11</option>
                <option value={12}>Grade 12</option>
              </select>
            </div>

            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
                Subject
              </label>
              <select
                id="subject"
                value={formData.subject}
                onChange={(e) => setFormData({...formData, subject: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="Mathematics">Mathematics</option>
                <option value="Science">Science</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="defaultStrictness" className="block text-sm font-medium text-gray-700 mb-1">
              Default Assistance Strictness
            </label>
            <select
              id="defaultStrictness"
              value={formData.defaultStrictness}
              onChange={(e) => setFormData({...formData, defaultStrictness: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="supportive">Supportive (Fewer barriers, earlier explanations)</option>
              <option value="balanced">Balanced (Default, requires attempt before substantial help)</option>
              <option value="independence">Independence-focused (Requires more explanation)</option>
              <option value="assessment_safe">Assessment-safe (No final answers allowed)</option>
            </select>
            <p className="mt-2 text-xs text-gray-500">
              This policy determines how the AI responds to students in this classroom.
            </p>
          </div>

          <div className="pt-4 border-t border-gray-100 flex justify-end gap-4">
            <Link 
              href="/teacher/classrooms"
              className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-50 rounded-lg transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Classroom'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
