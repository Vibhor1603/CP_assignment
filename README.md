# Deadline Agent

A CLI agent that turns scattered student messages into a single deadline list in Supabase — extracts tasks, updates corrections (no duplicates), flags unknown dates and contradictions, and answers questions from the database.

**Product overview:** [OVERVIEW.md](OVERVIEW.md) — what was built, why, and how it works.

## Setup

1. Create a free [Groq](https://console.groq.com) API key and a free [Supabase](https://supabase.com) project.
2. In Supabase → **SQL Editor**, paste and run [`sql/schema.sql`](sql/schema.sql).
3. Configure env and start:

```bash
cp .env.example .env.local
# fill GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
npm install
npm start
```

## Use

- Type any message (announcement, chat, email snippet) or ask something like `what's due this week?`
- Type `s` or `sources` to expand evidence for the last task
- Type `exit` to quit

```bash
npm run reset   # clear all tasks (clean demo)
npm test        # run the fake-message eval suite
```

## Requirements

- Node.js 18+
- Groq API key
- Supabase project (URL + service role key)

## More

- [OVERVIEW.md](OVERVIEW.md) — product / design overview for reviewers
