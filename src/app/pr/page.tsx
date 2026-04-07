import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/layout/AppShell'
import PRClient from './PRClient'
import { getDefaultBusiness } from '@/lib/utils/domain'

export const metadata = { title: 'PR & Media — NorthVault' }

export default async function PRPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: profile }, defaultBusiness] = await Promise.all([
    supabase.schema('northvault').from('profiles').select('email, name, role').eq('id', user.id).single(),
    getDefaultBusiness(),
  ])

  return (
    <AppShell userEmail={profile?.email ?? user.email} userRole={profile?.role}>
      <PRClient defaultBusiness={defaultBusiness} />
    </AppShell>
  )
}
