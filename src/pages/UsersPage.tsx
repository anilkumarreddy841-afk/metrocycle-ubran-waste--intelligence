import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { PageHeader } from '../components/StatusText.tsx';
import type { AuthUser, UserRole } from '../types.ts';

interface UserRow {
  id: number;
  full_name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export function UsersPage({
  user,
  onProfileUpdated,
}: {
  user: AuthUser;
  onProfileUpdated: (u: AuthUser) => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [profileForm, setProfileForm] = useState({ fullName: user.fullName, email: user.email });
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [newUser, setNewUser] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'Collection Staff' as UserRole,
  });

  const isAdmin = user.role === 'Administrator';

  const loadUsers = async () => {
    if (!isAdmin) return;
    const res = await apiRequest<{ users: UserRow[] }>('/users');
    setUsers(res.users);
  };

  useEffect(() => {
    loadUsers().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      const updated = await apiRequest<AuthUser>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(profileForm),
      });
      onProfileUpdated(updated);
      setNotice({ type: 'ok', text: 'Profile updated successfully.' });
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Update failed' });
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(pwForm),
      });
      setPwForm({ currentPassword: '', newPassword: '' });
      setNotice({ type: 'ok', text: 'Password updated with new salted scrypt hash.' });
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Password change failed' });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      await apiRequest('/users', { method: 'POST', body: JSON.stringify(newUser) });
      setNewUser({ fullName: '', email: '', password: '', role: 'Collection Staff' });
      setNotice({ type: 'ok', text: 'Created new user account.' });
      await loadUsers();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Create user failed' });
    }
  };

  const handleRoleChange = async (id: number, role: UserRole) => {
    await apiRequest(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ role }) });
    await loadUsers();
  };

  const handleDeleteUser = async (id: number) => {
    try {
      await apiRequest(`/users/${id}`, { method: 'DELETE' });
      await loadUsers();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Delete failed' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management & Account Security"
        subtitle="Manage your operator profile, rotate salted password credentials, and administer role-based access control."
      />

      {notice && (
        <div
          className={`p-3 rounded-md border text-sm ${
            notice.type === 'ok'
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
              : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form
          onSubmit={handleProfileSave}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold">My Operator Profile ({user.role})</h2>
          <div>
            <label className="block text-xs font-medium mb-1">Full Name</label>
            <input
              required
              value={profileForm.fullName}
              onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Email</label>
            <input
              type="email"
              required
              value={profileForm.email}
              onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm rounded-md bg-teal-700 hover:bg-teal-800 text-white font-medium"
          >
            Update Profile
          </button>
        </form>

        <form
          onSubmit={handlePasswordChange}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold">Change Password</h2>
          <div>
            <label className="block text-xs font-medium mb-1">Current Password</label>
            <input
              type="password"
              required
              value={pwForm.currentPassword}
              onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">New Password (min 6 chars)</label>
            <input
              type="password"
              minLength={6}
              required
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
          >
            Update Password
          </button>
        </form>
      </div>

      {isAdmin ? (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateUser}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5"
          >
            <h2 className="text-sm font-semibold mb-3">Provision New Municipal User</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input
                required
                placeholder="Full name"
                value={newUser.fullName}
                onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                type="email"
                required
                placeholder="Email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <input
                type="password"
                minLength={6}
                required
                placeholder="Initial password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
              <div className="flex gap-2">
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                  className="flex-1 px-2.5 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="Administrator">Administrator</option>
                  <option value="Waste Management Officer">Waste Management Officer</option>
                  <option value="Collection Staff">Collection Staff</option>
                </select>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add</span>
                </button>
              </div>
            </div>
          </form>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50 dark:bg-slate-950/40">
                  <th className="py-2.5 px-3 text-left font-medium">Name</th>
                  <th className="py-2.5 px-3 text-left font-medium">Email</th>
                  <th className="py-2.5 px-3 text-left font-medium">Role</th>
                  <th className="py-2.5 px-3 text-left font-medium">Created</th>
                  <th className="py-2.5 px-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 px-3 font-medium">{u.full_name}</td>
                    <td className="py-2.5 px-3 font-mono text-xs">{u.email}</td>
                    <td className="py-2.5 px-3">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                        className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="Administrator">Administrator</option>
                        <option value="Waste Management Officer">Waste Management Officer</option>
                        <option value="Collection Staff">Collection Staff</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-slate-500">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {u.id !== user.id && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1 text-slate-400 hover:text-red-600"
                          title="Delete user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-600 dark:text-slate-400">
          Administrator role is required to create or manage other municipal user accounts.
        </div>
      )}
    </div>
  );
}
