import { createHash } from 'crypto'
import { supabaseConfigured } from '@/lib/supabase'
import { proposeAndNotify } from '@/lib/actions'
import { logRun } from '@/lib/runs'
import { escapeHtml } from '@/lib/telegram-format'
import { pushAuthorized, pushRecipient, sleep } from '@/lib/push-auth'

// 💼 Job shortlist → one ✅/❌ card per job in Telegram.
// The Saturday Routine reads the week's job alerts, picks the few worth applying to,
// and POSTs them here. Each becomes a 🟡 proposal (agent_key 'job_apply'). Approving
// does NOT apply — it only QUEUES the job; the Sunday routine on your laptop applies
// in your own browser and reports back via /api/jobs/result.
//
//   POST /api/jobs/shortlist
//   Authorization: Bearer $INBOX_DIGEST_SECRET
//   { "jobs": [{ "id": "linkedin:4012345678", "title": "...", "company": "...",
//                "location": "Kuala Lumpur", "url": "https://...", "source": "LinkedIn",
//                "why": "Head of Growth, AI tooling, KL — matches all three targets" }] }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_JOBS = 15
const EXPIRES_IN_H = 7 * 24 // a week to decide; the Sunday run only takes approved ones

export async function POST(req: Request) {
  if (!pushAuthorized(req)) return new Response('forbidden', { status: 401 })
  if (!supabaseConfigured) return Response.json({ ok: false, error: 'db_not_configured' }, { status: 503 })

  const b = await req.json().catch(() => null)
  const chatId = pushRecipient(b?.chatId != null ? String(b.chatId) : undefined)
  if (!chatId) return Response.json({ ok: false, error: 'chat_not_allowed' }, { status: 403 })
  const jobs = (Array.isArray(b?.jobs) ? b.jobs : []).map(cleanJob).filter(Boolean).slice(0, MAX_JOBS) as Job[]
  if (!jobs.length) return Response.json({ ok: false, error: 'no_valid_jobs' }, { status: 400 })

  let proposed = 0
  let duplicates = 0
  for (const job of jobs) {
    const row = await proposeAndNotify({
      agentKey: 'job_apply',
      idempotencyKey: `job:${job.id}`,
      payload: { ...job, note: `${job.title} — ${job.company}` },
      chatId,
      text: renderCard(job),
      expiresInH: EXPIRES_IN_H,
    })
    if (row) {
      proposed++
      await sleep(350)
    } else duplicates++
  }

  await logRun('job_apply', proposed ? 'escalated' : 'noop', { proposed, duplicates })
  return Response.json({ ok: true, proposed, duplicates })
}

type Job = { id: string; title: string; company: string; location: string; url: string; source: string; why: string }

function cleanJob(j: any): Job | null {
  const url = typeof j?.url === 'string' ? j.url.trim() : ''
  const title = String(j?.title ?? '').trim().slice(0, 160)
  const company = String(j?.company ?? '').trim().slice(0, 120)
  if (!/^https:\/\/\S+$/.test(url) || !title || !company) return null
  // A stable id dedupes the same posting across weeks. Fall back to a hash of the URL.
  const given = String(j?.id ?? '').trim()
  const id = /^[\w:.-]{1,100}$/.test(given) ? given : createHash('sha1').update(url).digest('hex').slice(0, 16)
  return {
    id,
    title,
    company,
    url: url.slice(0, 500),
    location: String(j?.location ?? '').trim().slice(0, 80),
    source: String(j?.source ?? '').trim().slice(0, 40),
    why: String(j?.why ?? '').trim().slice(0, 300),
  }
}

function renderCard(j: Job): string {
  const lines = [`💼 <b>${escapeHtml(j.title)}</b> — ${escapeHtml(j.company)}`]
  const where = [j.location, j.source].filter(Boolean).map(escapeHtml).join(' · ')
  if (where) lines.push(where)
  if (j.why) lines.push(`<i>${escapeHtml(j.why)}</i>`)
  lines.push(escapeHtml(j.url), '', 'Approve = Claude applies on Sunday in your browser (nothing is sent before then).')
  return lines.join('\n')
}
