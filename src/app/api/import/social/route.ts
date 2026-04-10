import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { runSocialImport } from '@/lib/import/social-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const {
    connectionId,
    business = 'both',
    enableAiTagging = true,
  } = (await request.json()) as {
    connectionId: string
    business?: string
    enableAiTagging?: boolean
  }

  if (!connectionId) return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      try {
        const result = await runSocialImport({
          connectionId,
          business,
          enableAiTagging,
          onStatus: (message) => send('status', { message }),
          onProgress: (data) => send('progress', data),
          onCounts: (data) => send('counts', data),
          onFile: (data) => send('file', data),
        })
        send('complete', result)
      } catch (err) {
        send('error', { message: (err as Error).message })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
