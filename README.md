# Lumora Server

The Node.js + Express + MongoDB backend for **Lumora** (`lumoradating.com`).

Built on the same pattern as Glide: Procfile-driven, deployed to DigitalOcean App Platform, GitHub-auto-deployed on push to `main`.

---

## Architecture

```
Cloudflare Pages          DigitalOcean App Platform        MongoDB Atlas
─────────────────         ─────────────────────────         ──────────────
lumoradating.com    ────► api.lumoradating.com    ────►    Cluster0
(static site, this        (this server, Node.js +          database: lumora
 lumora-server's          Express + Mongoose)              (separate from glide)
 frontend)
```

## Tech stack

- **Node.js 20** + **Express 4**
- **Mongoose 8** (Cinderwell — connects to Atlas Cluster0, database `lumora`)
- **Argon2id** for password hashing
- **jsonwebtoken** for Veilkey (JWT) sessions, tracked in `veilkey_sessions`
- **Zod** for input validation
- **Helmet** + **CORS** for security headers
- **express-rate-limit** for Hailstone throttling

---

## Folder layout

```
lumora-server/
├── server.js                 entry point
├── package.json
├── Procfile                  web: node server.js
├── .env.example              copy to .env for local dev
├── .gitignore
│
├── config/
│   ├── db.js                 Mongoose connection
│   └── secrets.js            boot-time secret guard
│
├── middleware/
│   ├── auth.js               Veilkey JWT verification
│   ├── rateLimit.js          Hailstone limiters
│   └── errorHandler.js
│
├── models/                   Cinderwell schemas (12 collections)
│   ├── Pilgrim.js
│   ├── Tessera.js
│   ├── SigilImage.js
│   ├── SwipeEvents.js        Lantern, Wisp, Beacon
│   ├── ResonancePair.js
│   ├── HearthEmber.js        Hearth + Ember
│   ├── WraithlistEntry.js
│   ├── VeilkeySession.js
│   ├── WaitlistEntry.js
│   └── CairnLog.js
│
├── routes/
│   ├── health.js             GET  /api/health
│   ├── waitlist.js           POST /api/waitlist
│   └── auth.js               POST /api/auth/signup, login, logout, etc.
│
├── scripts/
│   └── lumora_audit.js       pre-deploy sanity check
│
├── LUMORA_DEPLOY.bat         Windows deploy
└── lumora_deploy.sh          Mac/Linux deploy
```

---

## API endpoints (this build)

| Method | Path                     | Purpose                              |
|--------|--------------------------|--------------------------------------|
| GET    | `/api/health`            | Liveness + DB ping (App Platform)    |
| POST   | `/api/waitlist`          | Submit waitlist entry from website   |
| GET    | `/api/waitlist/count`    | Public waitlist count                |
| POST   | `/api/auth/signup`       | Create Pilgrim + Tessera + Veilkey   |
| POST   | `/api/auth/login`        | Sign in, get Veilkey                 |
| GET    | `/api/auth/me`           | Get current pilgrim (requires Veilkey) |
| POST   | `/api/auth/logout`       | Revoke current session               |
| POST   | `/api/auth/logout-all`   | Cresset — revoke all sessions        |

Everything else from the 300-requirement spec (Lantern dispatch, Hearth chat, Stargazer feed, billing, Wraithguard moderation) builds out from this foundation.

---

## Local development

### Prerequisites

- Node.js 20+
- A MongoDB Atlas connection string for Cluster0

### Setup

```bash
# 1. Install
npm install

# 2. Create your local .env
cp .env.example .env
# Edit .env and fill in MONGO_URI and VEILKEY_SECRET

# Generate a Veilkey secret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Audit
npm run audit

# 4. Run in dev mode (auto-reload)
npm run dev

# 5. Sanity check
curl http://localhost:8080/api/health
```

---

## Deploying to DigitalOcean App Platform

### One-time setup

#### Step 1 — Create the GitHub repo

```bash
cd lumora-server
git init
git add -A
git commit -m "Initial commit: lumora-server"
gh repo create lumora-server --private --source=. --push
# OR manually: create the repo on github.com, then:
# git remote add origin git@github.com:YOUR-USER/lumora-server.git
# git branch -M main
# git push -u origin main
```

#### Step 2 — Create the App Platform app

1. DigitalOcean dashboard → **Apps** → **Create App**
2. Source: **GitHub** → authorize → pick `lumora-server` repo → branch `main`
3. Cloudflare auto-detect: should pick up the Node buildpack and the Procfile
4. Plan: **Basic — $5/month** (512 MB RAM is plenty for early stage)
5. Region: same as your Glide app (NYC1)
6. App name: `lumora-server`

#### Step 3 — Set environment variables in App Platform

Under **App settings → Environment variables**, add (all as Encrypted):

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `MONGO_URI` | your Atlas connection string with `/lumora` as the database |
| `VEILKEY_SECRET` | a fresh 64-char hex string (generate with the node one-liner above) |
| `VEILKEY_TTL` | `7d` |
| `ALLOWED_ORIGINS` | `https://lumoradating.com,https://www.lumoradating.com` |
| `APP_BASE_URL` | `https://lumoradating.com` |
| `API_BASE_URL` | `https://api.lumoradating.com` |
| `OBSIDIAN_ADMIN_PIN` | a strong 8-12 char PIN (your choice) |

Click **Save**. App Platform will redeploy automatically.

#### Step 4 — Health-check verification

Visit `https://YOUR-APP-NAME.ondigitalocean.app/api/health` — you should see:

```json
{ "ok": true, "service": "lumora-server", "db": { "state": "connected", "name": "lumora" } }
```

#### Step 5 — Wire up `api.lumoradating.com`

1. App Platform → your `lumora-server` app → **Settings** → **Domains** → **Add domain**
2. Domain: `api.lumoradating.com` → **Add domain**
3. DigitalOcean will tell you to add a CNAME record. In Cloudflare DNS:
   - Type: **CNAME**
   - Name: `api`
   - Target: the `ondigitalocean.app` hostname DigitalOcean gave you
   - Proxy status: **DNS only** (grey cloud, not orange) — App Platform handles SSL itself
4. Back in App Platform, wait for the green checkmark
5. Test: `https://api.lumoradating.com/api/health` should return the same JSON

#### Step 6 — Point the live site's form at the API

In your `lumora-site/index.html` and `signup.html`, change:

```js
var API_ENDPOINT = '/api/waitlist';
```

to:

```js
var API_ENDPOINT = 'https://api.lumoradating.com/api/waitlist';
```

(Same change for `/api/auth/signup` in `signup.html`.)

Push the site update to Cloudflare Pages. Done — waitlist signups now save to MongoDB.

---

## Ongoing deploys

```bash
# Windows
LUMORA_DEPLOY.bat

# macOS / Linux
./lumora_deploy.sh
```

These run the audit, prompt for a commit message, commit, and push to GitHub. App Platform builds + deploys within ~2 minutes. Watch progress in the DO dashboard.

---

## What's NOT in this build (yet — coming next sessions)

- Stargazer feed endpoints (daily card decks)
- Lantern/Wisp/Beacon swipe endpoints
- Hearth chat (REST + WebSocket via Socket.IO)
- Nebulizer recommendation engine
- Coracle media upload (Spaces / S3 pre-signed URLs)
- Sigil verification (Halo) pipeline
- Almsmaster billing (Stripe integration)
- Obsidian admin console UI
- Push/email/SMS notifications

---

## Conventions

- **Lumora vocabulary** in routes, models, and audit logs. Pilgrim, Tessera, Lantern, Hearth, Ember, Veilkey, Cairn — all per the spec.
- **No raw passwords ever logged.** Argon2id only, `select: false` on the hash field, no `console.log(req.body)`.
- **Every privileged action emits a Cairn** (audit log entry). See `models/CairnLog.js` and the `CairnLog.write(...)` calls in routes.
- **Boot fails closed.** If `VEILKEY_SECRET` or `MONGO_URI` is unset in production, the server throws on boot instead of running with auth silently disabled.
