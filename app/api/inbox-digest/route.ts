import { supabase, supabaseConfigured } from '@/lib/supabase'
import { sendWithButtons } from '@/lib/telegram'
import { markExecuted, markFailed } from '@/lib/actions'
import { logRun } from '@/lib/runs'
import { escapeHtml, chunkMessage } from '@/lib/telegram-format'
import { pushAuthorized, pushRecipient, sleep } from '@/lib/push-auth'

// 📬 The Inbox Digest drop-box.
// A Claude Routine reads your Gmail every Saturday morning, writes the summary, and
// POSTs it here. This route only formats it and posts it to YOUR Telegram — it never
// touches email, never replies to anyone, never acts. (🟢 "internal brief" zone.)
//
//   POST /api/inbox-digest
//   Authorization: Bearer $INBOX_DIGEST_SECRET
//   { "key": "2026-W40", "title": "Week of 28 Sep", "sections": [{ "heading": "...", "lines": ["..."] }] }
//
// Dedupe: `key` becomes an agent_actions idempotency_key, so a retried Routine never
// double-posts the same week. A FAILED send can be retried with the same key.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_CHUNKS = 10

type Section = { heading: string; lines: string[] }
type Digest = { key: string; title: string; sections: Section[]; chatId?: string }

export async function POST(req: Request) {
  if (!pushAuthorized(req)) return new Response('forbidden', { status: 401 })
  if (!supabaseConfigured) return Response.json({ ok: false, error: 'db_not_configured' }, { status: 503 })

  const body = parseBody(await req.json().catch(() => null))
  if (!body) return Response.json({ ok: false, error: 'bad_body' }, { status: 400 })
  const chatId = pushRecipient(body.chatId)
  if (!chatId) return Response.json({ ok: false, error: 'chat_not_allowed' }, { status: 403 })

  const chunks = renderDigest(body)
  if (chunks.length > MAX_CHUNKS) {
    return Response.json({ ok: false, error: 'too_long', chunks: chunks.length }, { status: 413 })
  }

  const row = await reserveKey(body.key, {
    text: `📬 ${body.title}`,
    chat_id: chatId,
    sections: body.sections.map((s) => s.heading),
  })
  if (row === 'error') return Response.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!row) {
    await logRun('inbox-digest', 'noop', { key: body.key, deduped: true })
    return Response.json({ ok: true, deduped: true, chunks: 0 })
  }

  let sent = 0
  for (const c of chunks) {
    // sendWithButtons is the one sender that reports success (message_id | null).
    if ((await sendWithButtons(chatId, c, [])) == null) break
    sent++
    if (sent < chunks.length) await sleep(350)
  }

  if (sent < chunks.length) {
    await markFailed(row.id, `sent ${sent}/${chunks.length} chunks`)
    await logRun('inbox-digest', 'failed', { key: body.key, sent, of: chunks.length })
    return Response.json({ ok: false, error: 'telegram_send_failed', chunks: sent }, { status: 502 })
  }
  await markExecuted(row.id, { kind: 'digest', chunks: sent, chat_id: chatId })
  await logRun('inbox-digest', 'ok', { key: body.key, title: body.title, chunks: sent })
  return Response.json({ ok: true, deduped: false, chunks: sent, action_id: row.id })
}

// Hand-rolled validation with caps so one POST stays bounded (20 × 60 × 600 chars).
function parseBody(b: any): Digest | null {
  const rawKey = typeof b?.key === 'string' ? b.key.trim() : ''
  if (!/^[\w:.-]{1,80}$/.test(rawKey)) return null
  const title = typeof b?.title === 'string' ? b.title.trim().slice(0, 200) : ''
  if (!title || !Array.isArray(b?.sections)) return null
  const sections: Section[] = b.sections.slice(0, 20).map((s: any) => ({
    heading: String(s?.heading ?? '').trim().slice(0, 120) || 'Untitled',
    lines: (Array.isArray(s?.lines) ? s.lines : [])
      .slice(0, 60)
      .map((l: any) => String(l ?? '').trim().slice(0, 600))
      .filter(Boolean),
  }))
  const chatId = b?.chatId != null ? String(b.chatId).trim() : undefined
  const key = rawKey.startsWith('inbox-digest:') ? rawKey : `inbox-digest:${rawKey}`
  return { key, title, sections, chatId }
}

// Title block + one block per section, so a section is never cut in half.
function renderDigest(d: Digest): string[] {
  const blocks = [`📬 <b>${escapeHtml(d.title)}</b>`]
  for (const s of d.sections) {
    const lines = s.lines.map((l) => `• ${escapeHtml(l)}`).join('\n')
    blocks.push(`<b>${escapeHtml(s.heading)}</b>\n${lines || '<i>nothing new</i>'}`)
  }
  const chunks = chunkMessage(blocks)
  if (chunks.length === 1) return chunks
  return chunks.map((c, i) =>
    i === 0 ? c : `<i>${escapeHtml(d.title)} — part ${i + 1}/${chunks.length}</i>\n\n${c}`,
  )
}

// Atomic dedupe on agent_actions.idempotency_key (same upsert shape as propose()).
// The row lands straight in 'executing' — it's a brief, not a wish, so it never shows
// up as "needs your YES". approver_chat_id stays null = the robot decided.
async function reserveKey(idem: string, payload: any) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('agent_actions')
    .upsert(
      {
        agent_key: 'inbox-digest',
        idempotency_key: idem,
        payload,
        status: 'executing',
        proposed_at: now,
        decided_at: now,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    .select()
  if (error) {
    console.error('[CFO] inbox-digest reserve failed:', error.message)
    return 'error' as const
  }
  if (data?.length) return data[0] as { id: number }

  // Already there. Only a previously FAILED send may be re-claimed (one CAS statement).
  const retry = await supabase
    .from('agent_actions')
    .update({ status: 'executing', decided_at: now, error: null })
    .eq('idempotency_key', idem)
    .eq('status', 'failed')
    .select()
  return (retry.data?.[0] as { id: number } | undefined) ?? null
}
