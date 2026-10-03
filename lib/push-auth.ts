import 'server-only'

// The guard for the EXTERNAL push routes (/api/inbox-digest, /api/jobs/*). These are
// called by a Claude Routine that reads your Gmail, not by Vercel Cron — a different
// trust domain — so they get their OWN secret instead of reusing CRON_SECRET.
// The worst a leaked INBOX_DIGEST_SECRET can do is post text / job cards to YOUR chat.
//
// FAILS CLOSED: no INBOX_DIGEST_SECRET set ⇒ every call is refused.
export function pushAuthorized(req: Request): boolean {
  const secret = process.env.INBOX_DIGEST_SECRET?.trim()
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

// Where a push lands. Default = OWNER_CHAT_ID. An explicit chatId is only honoured
// if it's the owner, an allowed user, or a team chat — never an arbitrary chat.
export function pushRecipient(requested?: string): string | null {
  const owner = process.env.OWNER_CHAT_ID?.trim() || ''
  if (!requested) return owner || null
  const ok = new Set(
    [
      owner,
      ...(process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(','),
      ...(process.env.TELEGRAM_TEAM_CHAT_IDS || '').split(','),
    ]
      .map((s) => s.trim())
      .filter(Boolean),
  )
  return ok.has(requested) ? requested : null
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
