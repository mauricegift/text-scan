# TextScan — AI Image to Text Extractor

A free, open-source web app that extracts text from images using **Google Gemini Vision AI**. Upload up to 20 images, crop to the exact region you need, and get clean extracted text instantly. No sign-up, no login required.

**Live demo:** [ocr.giftedtech.co.ke](https://ocr.giftedtech.co.ke)
**GitHub:** [github.com/mauricegift/text-scan](https://github.com/mauricegift/text-scan)

---

## Features

- Upload 1–20 images at once (drag & drop or file picker)
- Per-image cropping before extraction
- Supports JPG, PNG, BMP, WEBP, GIF, TIFF (up to 20 MB each)
- Extracts handwriting, printed text, screenshots, and scanned documents
- Per-image copy buttons and a global "Copy All" button
- Scan history page — past sessions saved privately in the browser (up to 50)
- Light / dark theme with system preference detection
- Smooth scroll animations (AOS)
- Scraping protection (origin validation + user-agent filtering)
- Rate limiting: 60 requests per 15 minutes burst + 20 extractions per IP per day (UTC reset)
- Zero authentication — fully public

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| Server | Express.js |
| OCR | Google Gemini 2.5 Flash (via `@google/genai`) |
| Image processing | Sharp |
| File uploads | Multer |
| Security | Helmet, express-rate-limit, custom IP daily limiter |
| Frontend | Vanilla HTML / CSS / JS, AOS animations, Font Awesome |

---

## Project Structure

```
textscan/
├── config.js              # Central config — loads .env, exports origins/rate limits
├── server.js              # Express entry point
├── render.yaml            # Render.com deployment config
├── .env.example           # Environment variable reference
├── lib/
│   ├── ipLimit.js         # IP-based daily rate limiter (20 req/day, persists to ips.json)
│   ├── ips.json           # Daily usage store — auto-purged each UTC day
│   ├── ocr.js             # Gemini API calls + key rotation
│   ├── routes.js          # API routes + origin guard middleware
│   └── upload.js          # Multer file upload handler
├── public/
│   ├── assets/
│   │   ├── favicon.svg    # App favicon
│   │   └── og.svg         # Social share card (1200×630)
│   ├── history/
│   │   └── index.html     # Scan history page (served at /history)
│   └── index.html         # Main app (single-page)
└── uploads/               # Temp directory — files deleted after OCR
```

---

## Quick Start

1. Fork /import/clone this repo.
2. Open the **Secrets** panel and add:

   | Secret | Value |
   |---|---|
   | `API_KEYS` | Your Gemini API key (or `key1,key2` for multiple) |

3. Click **Run**. The app starts on port 7432 and is accessible via the preview URL.

---

## Self-Hosted / VPS Setup

### 1. Clone the repository

```bash
git clone https://github.com/mauricegift/text-scan.git
cd text-scan
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a `.env` file

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# One or more Gemini API keys, comma-separated.
# Keys are tried in order — if one hits its quota, the next is used automatically.
API_KEYS=AIzaSy...key1,AIzaSy...key2

# Additional allowed origins for the /extract endpoint (optional).
# ALLOWED_ORIGINS=https://yourdomain.com

# Port the server listens on.
PORT=7432
```

### 4. Run the app

```bash
node server.js
# or with PM2 for production:
pm2 start server.js --name textscan
```

---

## Deploy to Render.com

A `render.yaml` is included for one-click deploy:

1. Push the repo to GitHub.
2. Go to [render.com](https://render.com) → **New Web Service** → connect the repo.
3. Render auto-detects `render.yaml` and configures everything.
4. In the Render dashboard, set these environment variables:
   - `API_KEYS` — your Gemini key(s)
   - `SESSION_SECRET` — any random string
5. Deploy. Health check is at `/health`.

> **Note:** The free plan uses an ephemeral filesystem, so `lib/ips.json` (daily usage counts) resets on each redeploy. Upgrade to a paid plan with persistent disk if you need usage to survive restarts.

---

## Getting a Gemini API Key

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API key** and copy the key.
3. Add it to `API_KEYS` in your `.env` file.

The free tier is generous — for higher throughput, add multiple keys(use different google accounts):

```env
API_KEYS=key1,key2,key3
```

Keys are rotated automatically when one hits its quota.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `API_KEYS` | Yes | Comma-separated Gemini API keys |
| `ALLOWED_ORIGINS` | No | Extra origins allowed to call `/extract` |
| `PORT` | No | Server port (default: `7432`) |
| `SESSION_SECRET` | No | Used on Render.com deployment |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Main app |
| `GET` | `/history` | Scan history page |
| `POST` | `/extract` | OCR endpoint — accepts `multipart/form-data` with `images[]` |
| `GET` | `/health` | Health check — returns `{ status, keys, uptime }` |
| `GET` | `/ready` | Readiness probe — returns `{ ready, keys }` |

---

## Rate Limiting

Two layers protect the `/extract` endpoint:

1. **Burst limiter** — `express-rate-limit`: 60 requests per IP per 15-minute window.
2. **Daily limiter** — custom `ipDailyLimit` middleware: 20 extractions per IP per UTC calendar day.
   - Counts persist in `lib/ips.json` so server restarts don't reset usage.
   - Automatically resets at UTC midnight — each new calendar day starts fresh.
   - Stale entries from previous days are purged on every write.
   - On limit hit, returns `429` with countdown: *"Resets in 4h 22m."*

---

## Scraping Protection

The `/extract` endpoint is protected by two layers:

1. **User-agent filtering** — requests from curl, wget, Python-requests, axios, node-fetch, and other known scripting tools are rejected with `403 Access denied`.
2. **Origin validation** — if an `Origin` or `Referer` header is present, it must match one of:
   - Hardcoded: `localhost:7432`, `ocr.giftedtech.co.ke`
   - Pattern: any `*.giftedtech.co.ke` subdomain,
   - Custom: anything in `ALLOWED_ORIGINS` env var

Same-origin browser requests (no `Origin` header) always pass through.

---

## Scan History

The `/history` page stores past extraction sessions in the browser's `localStorage` (key: `ts-history`):

- Max 50 sessions retained (oldest auto-removed)
- Each session shows: date, relative time, file count, character count
- Expandable cards with per-image text and copy buttons
- Copy-all, delete individual session, clear-all (with confirmation)
- No server-side storage — fully private to the user's browser

---

## Contributing

Pull requests are welcome. For major changes please open an issue first.

---

## License

MIT — © 2025 [GiftedTech](https://me.giftedtech.co.ke)
