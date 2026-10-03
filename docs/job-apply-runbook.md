# 💼 Sunday job-apply runbook (runs on YOUR laptop, in YOUR Chrome)

Cloud routines can't use your logged-in browser, so the applying happens on your laptop:

**Claude Desktop → Routines → New routine → Local**
- Name: `Apply to approved jobs` · Schedule: **weekly, Sunday 10:00**
- Working folder: your local clone of this repo · turn on **Chrome** for this task
- Settings → General → **Keep computer awake**. Leave the laptop open and plugged in 10:00–11:00 on Sundays.
  (If it's asleep, the run is skipped. Nothing breaks; approved jobs wait for the next Sunday or a manual run.)
- Before the first run:
  - Copy [`profile/job-profile.example.md`](../profile/job-profile.example.md) to `profile/job-profile.md` and fill it
    in. It's gitignored and never committed.
  - Put `APP_URL` and `INBOX_DIGEST_SECRET` in your local `.env` (also gitignored).
  - Make sure you're logged in to LinkedIn, JobStreet, Indeed and Glassdoor in that Chrome profile.

**Be aware:** LinkedIn, Indeed and JobStreet restrict automated applying in their terms. This setup keeps it to the
jobs **you** approved, at most 10 a week, at human pace, in your real browser session. That lowers the risk of an
account restriction but doesn't remove it. Your first run should be supervised: watch the Chrome window.

## The prompt for the Local routine

```text
Apply to the jobs Leo approved this week, in his own Chrome. Rules, in priority order:

1. Read APP_URL and INBOX_DIGEST_SECRET from the .env file in this folder. Read profile/job-profile.md. If
   either is missing, stop and say what's missing.
2. GET "$APP_URL/api/jobs/approved" with header "Authorization: Bearer $INBOX_DIGEST_SECRET".
   Apply ONLY to jobs in that list. At most 10 per run, oldest first.
3. For each job: open the URL in Chrome and use the site's own apply flow (LinkedIn Easy Apply, or the
   employer's careers portal: Workday, iCIMS, Greenhouse…). Wait at least 60–90 seconds between submissions.
   Do one site at a time. Never open more than one application at once.
4. Answer ONLY from profile/job-profile.md. Never invent or stretch experience, titles, dates, salary, notice
   period, work authorisation, degrees or references. If a required question isn't covered by the profile,
   or needs an account/password you don't have, or asks for a test, video or cover letter beyond the
   profile's template: do NOT submit. Report outcome "needs_you" with the exact question, and move on.
5. Upload the CV at the path in the profile. A short "why me" may be tailored to the role, truthfully, using
   only facts in the profile.
6. Never pay for anything, never accept new terms beyond the standard apply flow, never message recruiters,
   never change Leo's profile on any site.
7. After each job, POST "$APP_URL/api/jobs/result" with
   {"action_id": <id>, "outcome": "applied"|"needs_you"|"failed"|"skipped", "note": "<one line>"}.
8. When done, POST "$APP_URL/api/inbox-digest" with key "job-apply-<YYYY-MM-DD>" and title
   "Jobs applied · <date>". Sections: "✅ Applied", "🙋 Needs you" (the exact questions), "⚠️ Failed / skipped",
   one line per job: title — company — note.
```

## Graduating to autopilot (later, only if you say so)
After **3 clean weekends** (no wrong answers, no account warnings), the Saturday shortlist can send jobs that
score highly as `auto: true`, so they skip your ✅. Keep the 10-a-week cap and the needs-you rule. Undo is not
possible for a submitted application, so stay on approve-first if in doubt.
