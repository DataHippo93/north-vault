'use client'

import { useState } from 'react'
import Link from 'next/link'

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
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  async function handleDeleteUser(userId: string, email: string | null) {
    if (!confirm(`Delete ${email ?? 'this user'}? This cannot be undone.`)) return
    setDeletingId(userId)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId))
      } else {
        const data = await res.json()
        alert(data.error ?? 'Failed to delete user')
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole }),
    })

    if (res.ok) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className="text-sage-950 text-2xl font-bold">Admin</h1>

      {/* Invite user */}
      <div className="border-sage-200 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-sage-900 mb-4 text-base font-semibold">Invite user</h2>
        <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            placeholder="user@example.com"
            className="border-sage-300 focus:ring-vault-500 flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="border-sage-300 focus:ring-vault-500 rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={inviting}
            className="bg-vault-600 hover:bg-vault-700 rounded-lg px-6 py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-50"
          >
            {inviting ? 'Sending...' : 'Send invite'}
          </button>
        </form>
        {inviteResult?.success && (
          <p className="text-vault-700 bg-vault-50 border-vault-200 mt-3 rounded-lg border px-3 py-2 text-sm">
            {inviteResult.success}
          </p>
        )}
        {inviteResult?.error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {inviteResult.error}
          </p>
        )}
      </div>

      {/* Tools */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/social"
          className="border-sage-200 hover:border-vault-300 flex items-center gap-4 rounded-xl border bg-white p-5 shadow-sm transition-colors"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
            <svg
              className="h-5 w-5 text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <div className="text-sage-900 text-sm font-semibold">Social Media</div>
            <div className="text-sage-500 text-xs">Import creatives &amp; track performance</div>
          </div>
        </Link>
        <Link
          href="/admin/import"
          className="border-sage-200 hover:border-vault-300 flex items-center gap-4 rounded-xl border bg-white p-5 shadow-sm transition-colors"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
            <svg
              className="h-5 w-5 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </div>
          <div>
            <div className="text-sage-900 text-sm font-semibold">SharePoint Import</div>
            <div className="text-sage-500 text-xs">Import files from SharePoint</div>
          </div>
        </Link>
      </div>

      {/* User list */}
      <div className="border-sage-200 overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="border-sage-200 bg-wood-50 border-b px-6 py-4">
          <h2 className="text-sage-900 text-base font-semibold">Users ({users.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-sage-200 bg-sage-50 border-b">
              <th className="text-sage-600 px-6 py-3 text-left font-medium">Email</th>
              <th className="text-sage-600 hidden px-6 py-3 text-left font-medium sm:table-cell">Joined</th>
              <th className="text-sage-600 px-6 py-3 text-left font-medium">Role</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-sage-100 border-b last:border-0">
                <td className="px-6 py-4">
                  <div>
                    <div className="text-sage-900 font-medium">{user.email ?? 'No email'}</div>
                    {user.name && <div className="text-sage-500 text-xs">{user.name}</div>}
                    {user.id === currentUserId && <span className="text-vault-600 text-xs">(you)</span>}
                  </div>
                </td>
                <td className="text-sage-500 hidden px-6 py-4 sm:table-cell">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  {user.id === currentUserId ? (
                    <span className="bg-vault-100 text-vault-700 rounded px-2 py-1 text-xs font-medium capitalize">
                      {user.role}
                    </span>
                  ) : (
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      className="border-sage-300 focus:ring-vault-500 rounded border bg-white px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  {user.id !== currentUserId && (
                    <button
                      onClick={() => handleDeleteUser(user.id, user.email)}
                      disabled={deletingId === user.id}
                      className="text-xs text-red-400 transition-colors hover:text-red-600 disabled:opacity-40"
                    >
                      {deletingId === user.id ? 'Deleting…' : 'Delete'}
                    </button>
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
