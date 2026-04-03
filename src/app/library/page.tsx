import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import LibraryClient from './LibraryClient'

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role, name')
    .eq('id', user.id)
    .single()

  return (
    <AppShell userEmail={user.email} userRole={profile?.role}>
      <LibraryClient userId={user.id} userRole={profile?.role ?? 'viewer'} />
    </AppShell>
  )
}
