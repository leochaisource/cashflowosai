import { supabase, supabaseConfigured } from '@/lib/supabase'
import { pushAuthorized } from '@/lib/push-auth'

// 💼 The Sunday to-do list: every job you tapped ✅ on that hasn't been applied to yet.
// Read by the local Sunday routine (Claude Desktop + Chrome) before it applies.
//
//   GET /api/jobs/approved
//   Authorization: Bearer $INBOX_DIGEST_SECRET

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!pushAuthorized(req)) return new Response('forbidden', { status: 401 })
  if (!supabaseConfigured) return Response.json({ ok: false, error: 'db_not_configured' }, { status: 503 })

  const { data, error } = await supabase
    .from('agent_actions')
    .select('id, payload, decided_at')
    .eq('agent_key', 'job_apply')
    .eq('status', 'executed')
    .eq('result->>kind', 'job_queued')
    .order('decided_at', { ascending: true })
    .limit(25)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  const jobs = (data || []).map((r: any) => ({ action_id: r.id, approved_at: r.decided_at, ...r.payload }))
  return Response.json({ ok: true, jobs })
}
