import 'server-only'

// Pure helpers for Telegram HTML messages. No env, no network — safe to reuse anywhere.
// Kept out of lib/telegram.ts (🔒) on purpose: that file owns the token + API calls.

// Telegram's HTML parse mode only needs these three escaped. Anything that came from
// outside (an email subject, a sender name, a job title) MUST go through this, or a
// stray "<" makes Telegram reject the whole message.
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Pack pre-rendered blocks into messages of at most `max` characters. A block is never
// split unless it alone is longer than `max` (then it's split at line breaks).
// Telegram's hard cap is 4096; the default leaves room for a "part 2/3" prefix.
export function chunkMessage(blocks: string[], max = 3800): string[] {
  const out: string[] = []
  let cur = ''
  const flush = () => {
    if (cur) out.push(cur)
    cur = ''
  }
  for (const b of blocks) {
    if (b.length > max) {
      flush()
      for (const line of b.split('\n')) {
        const piece = line.length > max ? line.slice(0, max - 1) + '…' : line
        if (cur && cur.length + 1 + piece.length > max) flush()
        cur = cur ? `${cur}\n${piece}` : piece
      }
      flush()
      continue
    }
    if (cur && cur.length + 2 + b.length > max) flush()
    cur = cur ? `${cur}\n\n${b}` : b
  }
  flush()
  return out
}
