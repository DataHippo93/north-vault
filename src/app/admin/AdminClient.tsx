'use client'

import { useState } from 'react'

interface Profile {
  id: string
  email: string | null
  name: string | null
  role: string
  business: string | null
  created_at: string
}

interface Props {
  currentUserId: string
  users: Profile[]
}

export default function AdminClient({ currentUserId, users: initialUsers }: Props) {
  const [users, setUsers] = useState(initialUsers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ success?: string; error?: string } | null>(null)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteResult(null)

    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })

    const data = await res.json()
    if (res.ok) {
      setInviteResult({ success: `Invite sent to ${inviteEmail}` })
      setInviteEmail('')
    } else {
      setInviteResult({ error: data.error || 'Failed to send invite' })
    }
    setInviting(false)
  }

  async function handleRoleChange(userId: string, newRole: string) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole }),
    })

    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-sage-950">Admin</h1>

      {/* Invite user */}
      <div className="bg-white rounded-xl border border-sage-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-sage-900 mb-4">Invite user</h2>
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            placeholder="user@example.com"
            className="flex-1 px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500 bg-white"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={inviting}
            className="px-6 py-2 bg-vault-600 text-white rounded-lg text-sm font-medium hover:bg-vault-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {inviting ? 'Sending...' : 'Send invite'}
          </button>
        </form>
        {inviteResult?.success && (
          <p className="mt-3 text-sm text-vault-700 bg-vault-50 border border-vault-200 rounded-lg px-3 py-2">
            {inviteResult.success}
          </p>
        )}
        {inviteResult?.error && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {inviteResult.error}
          </p>
        )}
      </div>

      {/* User list */}
      <div className="bg-white rounded-xl border border-sage-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-sage-200 bg-wood-50">
          <h2 className="text-base font-semibold text-sage-900">Users ({users.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sage-200 bg-sage-50">
              <th className="text-left px-6 py-3 font-medium text-sage-600">Email</th>
              <th className="text-left px-6 py-3 font-medium text-sage-600 hidden sm:table-cell">Joined</th>
              <th className="text-left px-6 py-3 font-medium text-sage-600">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className="border-b border-sage-100 last:border-0">
                <td className="px-6 py-4">
                  <div>
                    <div className="font-medium text-sage-900">{user.email ?? 'No email'}</div>
                    {user.name && <div className="text-xs text-sage-500">{user.name}</div>}
                    {user.id === currentUserId && (
                      <span className="text-xs text-vault-600">(you)</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 hidden sm:table-cell text-sage-500">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  {user.id === currentUserId ? (
                    <span className="px-2 py-1 bg-vault-100 text-vault-700 rounded text-xs font-medium capitalize">
                      {user.role}
                    </span>
                  ) : (
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      className="px-2 py-1 border border-sage-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-vault-500 bg-white"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
