---
name: korus-automations
description: Schedule explicitly requested recurring prompts in Korus.
---

# Recurring prompts

- Use create-automation only for an explicit scheduling request. Clarify recurrence, timezone and destination.
- Calendar time: RRULE without DTSTART + IANA timeZone; intervalMinutes is elapsed time, not a calendar substitute. Daily 8 AM Chicago:

      schedule={rrule:"FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0",timeZone:"America/Chicago"}

- Calendar schedules start at the next occurrence and preserve local time across DST.
- Default: new Quick Chat per run, in your team, using your backend and saved model defaults. Existing conversations retain backend/model/effort/approvals; overrides affect new Quick Chats only.
- Retry with the same requestId and settings. The owning daemon must run; missed occurrences coalesce into one catch-up.
- Report the saved schedule, timezone, destination and next run—not completed work.
