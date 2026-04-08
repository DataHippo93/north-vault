import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import PersonDetailClient from './PersonDetailClient'

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role, name')
    .eq('id', user.id)
    .single()

  return (
    <AppShell userEmail={user.email} userRole={profile?.role}>
      <PersonDetailClient personId={id} />
    </AppShell>
  )
}
