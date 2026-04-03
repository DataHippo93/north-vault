import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import AdminClient from './AdminClient'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/library')

  const { data: users } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <AppShell userEmail={user.email} userRole="admin">
      <AdminClient currentUserId={user.id} users={users ?? []} />
    </AppShell>
  )
}
