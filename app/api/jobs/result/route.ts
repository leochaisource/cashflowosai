import { supabase, supabaseConfigured } from '@/lib/supabase'
import { logRun } from '@/lib/runs'
import { pushAuthorized } from '@/lib/push-auth'

// 💼 The Sunday routine reports back, one call per job it touched.
//
//   POST /api/jobs/result
//   Authorization: Bearer $INBOX_DIGEST_SECRET
//   { "action_id": 42, "outcome": "applied" | "needs_you" | "failed" | "skipped", "note": "..." }
//
// State lives in agent_actions.result (there's no meta column — same as undoAction).
// Guarded so a job can only leave the queue once: the update only matches a row whose
// result.kind is still 'job_queued'.

export const dynamic = 'force-dynamic'

const OUTCOMES = new Set(['applied', 'needs_you', 'failed', 'skipped'])

export async function POST(req: Request) {
  if (!pushAuthorized(req)) return new Response('forbidden', { status: 401 })
  if (!supabaseConfigured) return Response.json({ ok: false, error: 'db_not_configured' }, { status: 503 })

  const b = await req.json().catch(() => null)
  const id = Number(b?.action_id)
  const outcome = String(b?.outcome ?? '')
  if (!Number.isFinite(id) || !OUTCOMES.has(outcome)) {
    return Response.json({ ok: false, error: 'bad_body' }, { status: 400 })
  }
  const note = String(b?.note ?? '').trim().slice(0, 500)

  const { data: rows, error: readErr } = await supabase
    .from('agent_actions')
    .select('result')
    .eq('id', id)
    .eq('agent_key', 'job_apply')
    .eq('result->>kind', 'job_queued')
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 })
  if (!rows?.length) return Response.json({ ok: false, error: 'not_queued' }, { status: 409 })

  const result = { ...(rows[0].result || {}), kind: `job_${outcome}`, note, reported_at: new Date().toISOString() }
  const { data, error } = await supabase
    .from('agent_actions')
    .update({ result })
    .eq('id', id)
    .eq('result->>kind', 'job_queued') // still queued at write time ⇒ only one report wins
    .select('id')
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  if (!data?.length) return Response.json({ ok: false, error: 'not_queued' }, { status: 409 })

  await logRun('job_apply', outcome === 'applied' ? 'ok' : outcome === 'needs_you' ? 'escalated' : outcome, {
    action_id: id,
    note,
  })
  return Response.json({ ok: true })
}
