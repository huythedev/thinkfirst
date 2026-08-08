'use client';

import { useAuth } from '@/components/providers/AuthProvider';

export default function TeacherSettings() {
  const { user, profile } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-2">Manage your account preferences.</p>
      </div>

      <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm max-w-2xl">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Profile Information</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <p className="mt-1 text-gray-900 bg-gray-50 p-2 rounded border border-gray-200">
              {profile?.displayName || 'Not provided'}
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <p className="mt-1 text-gray-900 bg-gray-50 p-2 rounded border border-gray-200">
              {user?.email || 'Not provided'}
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <p className="mt-1 text-gray-900 bg-gray-50 p-2 rounded border border-gray-200 capitalize">
              {profile?.role || 'Unknown'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
