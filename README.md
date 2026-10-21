# Doctor Tracker API

This is the REST API for **Doctor Tracker**, a secure admin workspace for managing doctors and their patients and viewing clinic analytics. It is a standalone Express 5 service on MongoDB (Mongoose). It handles authentication, validation, indexed search, filtering and pagination, and the dashboard aggregations. The Next.js client lives in the frontend repository, whose README has the full architecture and the screenshots.

## Setup Guide

Requirements: Node.js 20+, npm, and MongoDB (local, Docker or Atlas).

```bash
cp .env.example .env     # fill in the values below
npm install
npm run seed             # optional: 10 demo doctors + 140 patients spread over 12 months (idempotent)
npm run dev              # http://localhost:4000 — GET /api/health
```

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/doctor_tracker` or an Atlas `mongodb+srv://…` URI |
| `JWT_SECRET` | Random string of at least 32 characters |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The admin login (password at least 12 characters) |
| `FRONTEND_URL` | Frontend origin (CORS) |
| `PORT`, `NODE_ENV` | Defaults: `4000`, `development` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional: AI dashboard insights (free key from aistudio.google.com/apikey) |

Production: run `npm run build && npm start`. `render.yaml` is a ready-made Render Blueprint (build, start command, health check, env vars).

## System Architecture

```text
Browser ──fetch /api/*──▶ Next.js rewrite ──HTTPS──▶ Express
                                                   ├─ helmet · JSON limit · login rate limit
                                                   ├─ requireAuth (JWT in HTTP-only cookie)
                                                   ├─ Zod validation → routes
                                                   └─ Mongoose ──▶ MongoDB (indexed)
```

```text
src/
  config/env.ts        Zod-validated environment (fails fast on bad config)
  middleware/auth.ts   JWT cookie verification
  models/              Doctor, Patient: schemas, indexes, keyword hooks
  routes/              auth, doctors, patients, dashboard
  services/insights.ts Gemini insights (aggregates only, cached, model fallback)
  utils/query.ts       pagination, date range, keyword search, HttpError
  db.ts                connection + one-time keyword backfill
  seed.ts              deterministic, idempotent demo data
```

Errors use one shape, `{ error, details? }`, with these status codes:

- `400` for validation failures, including per-field `details`
- `401` when the session is missing or expired
- `404` for unknown records
- `409` for a duplicate email, or deleting a doctor who still has patients
- `500` for anything else, which is logged on the server

## Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` · `/api/auth/logout` | Start or end the session (8 h HTTP-only cookie) |
| GET | `/api/auth/me` | Current admin |
| GET | `/api/doctors?search&specialization&hospital&from&to&sort&page&limit` | Paginated doctors with patient counts |
| GET | `/api/doctors/filters` | Distinct specialties and hospitals |
| POST | `/api/doctors` | Create a doctor |
| GET · PATCH · DELETE | `/api/doctors/:id` | Detail with status breakdown, update, delete (refused while patients are assigned) |
| GET · POST | `/api/doctors/:id/patients?search&status&page&limit` | A doctor's patients; add a patient under the doctor |
| DELETE | `/api/doctors/:id/patients/:patientId` | Remove a patient from that doctor's list |
| GET | `/api/patients?search&condition&status&doctor&from&to&page&limit` | Paginated patient register |
| GET | `/api/patients/filters` | Distinct conditions and the doctor list |
| POST | `/api/patients` | Create a patient |
| PATCH · DELETE | `/api/patients/:id` | Edit or delete a patient |
| GET | `/api/dashboard/overview?months=3\|6\|12` | All dashboard aggregates in one request |
| GET | `/api/dashboard/insights?months=3\|6\|12` | Gemini-generated insights from those aggregates; cached 10 min, falls back to a second model, 503 without a key |
| GET | `/api/health` | Liveness probe |

Every route except login, logout and health requires a valid session.

## Technical Decisions

### 1. Indexed keyword-prefix search

A case-insensitive regex across several fields (`$or: [{ name: /^x/i }, …]`) can't use tight index bounds, so MongoDB scans every key. Instead, each document stores a hidden (`select: false`) `keywords` array of lowercased tokens. A `pre("validate")` hook keeps the array current, and older records are backfilled at startup. The array has a multikey index.

Search splits the input into terms and requires each one to match `{ keywords: /^term/ }`. That is a case-sensitive anchored regex, which becomes a bounded index range scan. Partial words ("rah" finds "Amara Rahman") and multiple words ("card nor") both work.

We ruled out `$text`, because it has no prefix matching, and Atlas Search, because it would lock the app into Atlas for no gain at this scale.

### 2. Stateless JWT in an HTTP-only cookie, behind a same-origin rewrite

The browser never holds a readable token. The cookie is `httpOnly`, `sameSite=lax`, and `secure` in production. The frontend calls `/api/*` on its own origin, and Next.js rewrites those calls to this service, so the cookie stays first-party and no cross-site cookie or CORS setup is needed.

Because everything arrives through the frontend host, the login rate limiter keys on the submitted email rather than the IP. It allows 10 failed attempts per 15 minutes, and successful logins don't count. The API keeps no session store, so it can scale horizontally.

### Other query optimizations

- **Compound indexes** cover every list sort and filter path:
  - `{createdAt,_id}`
  - `{specialization,createdAt}` and `{hospital,createdAt}`
  - `{doctor,createdAt}`
  - `{condition,createdAt}` and `{status,createdAt}`
  - unique `{email}` on doctors
- **Parallel queries.** Page queries and `countDocuments` run in parallel.
- **Batched counts.** Patient counts for a page of doctors come from one `$group` over just those IDs, not a query per row.
- **Single dashboard request.** It runs its bounded aggregations in parallel. The time series start with an indexed `$match` on `createdAt`, and the doctor total uses `estimatedDocumentCount`.
