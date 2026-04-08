import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import SocialImportClient from './SocialImportClient'

export default async function SocialImportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role, email')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/library')

  return (
    <AppShell userEmail={profile.email ?? undefined} userRole={profile.role}>
      <SocialImportClient />
    </AppShell>
  )
}
