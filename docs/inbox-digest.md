# 📬 Inbox Digest + 💼 Job Shortlist

Your inbox gets ~39 threads a day and only ~1 in 65 is from a real person. This setup:

1. **Filters** the noise out of the inbox the moment it arrives (labels, nothing deleted).
2. **Saturday 08:47 MYT:** a Claude Routine reads the week's mail and posts **one digest** to Telegram, plus a ✅/❌ card for each job worth applying to.
3. **Sunday 10:00 MYT:** a routine on your laptop applies to the jobs you ✅'d, in your own Chrome, then posts what it did. See [`job-apply-runbook.md`](job-apply-runbook.md).

```
Gmail filters (instant)      → noise labelled + archived; people / leads / money stay in Inbox
Sat 08:47 cloud Routine      → reads Gmail (read-only) → POST /api/inbox-digest   (the digest)
                                                       → POST /api/jobs/shortlist (✅/❌ per job)
You tap ✅ on Sat/Sun        → job is QUEUED (nothing is submitted)
Sun 10:00 laptop routine     → GET /api/jobs/approved → applies in your Chrome → POST /api/jobs/result
```

What stays in your inbox after the filters (based on 5 Jul – 3 Oct 2026): **~6 threads a day**, down from ~39.
That's real people, **Leads** (ABC SalesBot hand-offs, Calendly bookings), **Money** (failed payments, bills,
invoices) and **Account alerts** (new GHL admins, Meta ad-account reviews, workflow errors).

---

## 1 · One-time setup (≈10 min)

### a) Gmail filters
1. Gmail → ⚙️ → **See all settings** → **Filters and Blocked Addresses** → **Import filters**.
2. Choose [`docs/gmail/mailFilters.xml`](gmail/mailFilters.xml) → **Open file** → **Create filters**.
3. **Leave "Apply new filters to existing email" UNTICKED.** (Ticking it would also archive the last 30 days.)

Gmail creates the labels for you: `Jobs`, `Jobs/Action`, `Tools`, `Tools/Wordfence`, `Newsletters`, `Promos`,
`Education-MBA`, `Social` (all archived), and `Leads` ⭐, `Money`, `Account alerts` (all **kept in the inbox**).
Job replies that mention interview / assessment / next steps / offer are **not** archived and land in `Jobs/Action` ⭐.

### b) Archive old noise (older than 30 days)
Paste into Gmail search → tick the select-all box → **Select all conversations that match this search** → **Archive**:

```
in:inbox older_than:30d {category:promotions category:social category:updates} -from:(abcsalesbot.com OR calendly.com OR stripe.com OR acct-mgmt.com OR claudemalaysia.com)
```
Nothing is deleted — it's all still under **All Mail** and searchable.

### c) Secrets (so the Routine can post to Telegram)
- **Vercel** → your project → Settings → Environment Variables → add `INBOX_DIGEST_SECRET` (a long random string) → redeploy.
- **Claude Code cloud environment** (the environment menu in a session's title bar → Edit):
  - Environment variables: `INBOX_DIGEST_SECRET` (the same value) and `APP_URL=https://<your-app>.vercel.app`
  - Network access → **Custom** → add `<your-app>.vercel.app` to Allowed domains (keep the default package-manager list).
    Docs: https://code.claude.com/docs/en/cloud-environments#network-access
- Then ask Claude to create the Saturday Routine with the prompt in §3, and fire it once to test.

---

## 2 · The API (all four routes: `Authorization: Bearer $INBOX_DIGEST_SECRET`, fail-closed)

| Route | What it does |
|---|---|
| `POST /api/inbox-digest` | `{ key, title, sections: [{ heading, lines[] }], chatId? }` → posts to `OWNER_CHAT_ID`. HTML-escaped, split into ≤3,800-char parts, deduped on `key` (a failed send can be retried with the same key). |
| `POST /api/jobs/shortlist` | `{ jobs: [{ id, title, company, location, url, source, why }] }` (≤15) → one ✅/❌ card each, valid for 7 days, deduped on `job:<id>`. |
| `GET /api/jobs/approved` | Jobs you ✅'d that haven't been applied to yet. |
| `POST /api/jobs/result` | `{ action_id, outcome: applied \| needs_you \| failed \| skipped, note }` → takes the job off the queue (once). |

Every call is logged in `agent_runs`; digests and job cards show in **Approvals → History**. Tapping ✅ on a job only
**queues** it (`🗓 Queued — Claude applies on Sunday…`). Nothing is submitted until the Sunday run.

Quick test (replace the placeholders):
```bash
curl -s -X POST "$APP_URL/api/inbox-digest" -H "Authorization: Bearer $INBOX_DIGEST_SECRET" \
  -H 'content-type: application/json' \
  -d '{"key":"test-1","title":"Test digest","sections":[{"heading":"Hello","lines":["It works"]}]}'
# → {"ok":true,"deduped":false,"chunks":1,...}  and a Telegram message. Run it again → "deduped":true.
```

---

## 3 · The Saturday Routine prompt (canonical copy)

Schedule: `CRON_TZ=Asia/Kuala_Lumpur 47 8 * * 6` · fresh session each run · connector: **Gmail** only.

```text
You are Leo's weekly inbox assistant. Gmail access is READ-ONLY for this task: never send, reply, forward,
draft, trash, archive, mark as spam or change labels. Never open links inside emails.

Window: the last 7 days (Gmail query `newer_than:7d`). Use search_threads (pageSize 50, follow
nextPageToken). Use get_thread (PLAIN_TEXT) only for: threads in the inbox from real people, label:Leads,
label:Money, label:"Account alerts", label:Jobs/Action, the job-alert emails you shortlist from, and
label:Education-MBA. Everything else: subject + sender is enough.

Build these sections, in this order. One line per item, ≤160 characters, newest first. Never include
phone numbers, full email addresses of third parties, passwords, codes or card numbers.

1. "🔴 Needs you": real people waiting on a reply (who, what they want, how many days); ABC SalesBot
   hand-offs (lead first name + their question); Calendly bookings or cancellations; failed or declined
   payments; invoices or bills due; account and security changes (new admins, disabled ad accounts,
   workflow errors, password resets you didn't expect). If none: "Nothing urgent 🎉".
2. "💼 Jobs": "<N> alerts this week, <M> shortlisted below" plus any label:Jobs/Action replies (interview,
   assessment, next steps), each with its deadline.
3. "🎓 MBA & programmes": programmes, intakes, deadlines, fee waivers and info sessions worth knowing.
   Leo IS looking. Group by school and give the date.
4. "🛠 Tools": counts per tool, plus anything that is NOT marketing (an error, an expiry, a price change).
   One line saying "GHL marketing: N emails, nothing to act on" is fine.
5. "📰 Newsletters": the 3 most useful ideas across all newsletters this week, one line each, with source.
6. "🛍 Promos & social": counts only, plus a genuinely good deal if there is one.
7. "🧹 New noisy senders": automated senders that hit the INBOX this week with ≥2 emails and no label.
   Suggest a label for each (so the filter file can be updated).

Job shortlist: from this week's job-alert emails (LinkedIn, JobStreet, Indeed, Glassdoor, JobLeads, company
career sites), de-duplicate the same role across sites, and pick at most 10 that match ALL of:
  • senior marketing / growth leadership (manager, head, lead, director: marketing, growth, brand,
    performance, digital, GTM), or an AI / automation / martech role where his Claude, GHL and automation
    work is the selling point;
  • based in Malaysia (KL / Selangor) or Singapore;
  • posted within the last 14 days.
For each give: a stable id (e.g. "linkedin:<job id from the URL>"), the title, the company, the location,
the https URL of the job posting itself (not a tracking redirect if you can avoid it), the source, and a
one-line "why" saying which criteria it matches.

Then call (env vars APP_URL and INBOX_DIGEST_SECRET are set):
  curl -sS -X POST "$APP_URL/api/inbox-digest" -H "Authorization: Bearer $INBOX_DIGEST_SECRET" \
       -H 'content-type: application/json' --data @digest.json
     where digest.json = {"key":"<ISO year>-W<ISO week>","title":"Inbox · week of <date>","sections":[...]}
  curl -sS -X POST "$APP_URL/api/jobs/shortlist" -H "Authorization: Bearer $INBOX_DIGEST_SECRET" \
       -H 'content-type: application/json' --data @jobs.json     where jobs.json = {"jobs":[...]}
Write the JSON files with a quoted heredoc. Report both HTTP responses. If either is not 2xx, say exactly
which one failed and what the response body said. Do not retry more than once.
```

## 4 · Changing it later
- **A noisy sender slipped through?** Add it to the right group in the filter file, or just make a Gmail filter
  ("Filter messages like these" → skip inbox + label). The digest's 🧹 section lists candidates every week.
- **Job criteria:** edit the bullet list in the prompt above (and in the Routine).
- **Graduating jobs to autopilot:** only after 3 clean weekends, and only if you say so (see the runbook).
