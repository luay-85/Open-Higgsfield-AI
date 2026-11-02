# Open Higgsfield AI (MATAI fork): Setup and Production Guide

This guide covers your fork (`luay-85/Open-Higgsfield-AI`, derived from Autom8AI). It differs a lot from the upstream README, which describes the Muapi.ai and Next.js version. Use this guide, not the upstream README.

| | Upstream README says | Your fork actually uses |
|---|---|---|
| Frontend | Next.js app in `app/` | **Vite + vanilla JS app in `src/`** (the Next.js files are leftovers) |
| AI provider | Muapi.ai (shared key) | **kie.ai** (main provider) plus **fal.ai** (LoRA avatars, Flux Kontext). Each user brings their own key |
| Backend | none | **Netlify Functions** in `netlify/functions/` |
| Storage | browser localStorage | **Airtable**, accessed through **Composio** |
| Access | open | **Sign-in gate** (first name + PIN) stored in an Airtable "App Auth" table |

Verified in this session: `npm install` and `npx vite build` both succeed (Node 22), and the dev server starts and serves the UI.

---

## ⭐ Simple setup (recommended): no Composio, automatic tables

In this mode the app talks to Airtable directly with a personal access token, finds your base by name, and creates every table and field it needs. It turns on when `AIRTABLE_PAT` is set and `COMPOSIO_API_KEY` is **not** set.

1. Create an Airtable base named **MATAI Studio** (it can be empty).
2. Create a personal access token at airtable.com/create/tokens with these scopes: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`. Give it access to that base.
3. In Netlify, set the environment variable **`AIRTABLE_PAT`** = your token. This is the only variable you need.
4. Deploy, then open **`https://<your-site>.netlify.app/setup`**. It checks everything, creates the tables, and lets you create your first sign-in account (name + PIN). The page switches itself off once an account exists.
5. Sign in on the home page and paste your kie.ai API key when asked.

Optional variables: `AIRTABLE_BASE_ID` (use a specific base instead of finding it by name), `AIRTABLE_BASE_NAME` (a different base name), `SESSION_SECRET` (otherwise login sessions are signed with a secret derived from your token).

The sections below describe the original Composio setup and all the details.

---

## 1. Accounts you need

| Service | Why | Where |
|---|---|---|
| **GitHub** | Holds your fork | already set up |
| **Netlify** | Hosts the site and runs the backend functions | netlify.com, free tier is enough to start |
| **Composio** | Server-side proxy to Airtable (one API key) | composio.dev, then connect the **Airtable** toolkit |
| **Airtable** | User accounts, generation library, avatars | airtable.com |
| **kie.ai** | Image, video, lip-sync, TTS and the prompt builder | kie.ai, then API key and credits |
| **fal.ai** (optional) | AI Influencer LoRA training and Flux Kontext | fal.ai, then API key |
| **Resend** (optional) | Email alerts when an account gets locked out | resend.com |

---

## 2. Airtable structure (important)

The base and table IDs are **hard-coded**, not read from environment variables:

| File | Constant | Value | Purpose |
|---|---|---|---|
| `netlify/functions/_auth.js` | `PRIMARY_BASE_ID` | `applP85ZQYvmFGSxa` | Auth base ("Autom8 Me CRM") |
| `netlify/functions/_auth.js` | `FALLBACK_BASE_ID` | `appxWa7YNYpMjIVAz` | Auth fallback base |
| `netlify/functions/_auth.js` | `AIRTABLE_TABLE_ID` | `tbloKNK7pmGiaEB1K` | **App Auth** table |
| `netlify/functions/_airtable.js` | `BASE_ID` | `appSYUhlcApc5k3PO` | Media base |
| `netlify/functions/_airtable.js` | `GENERATIONS` | `tbleSsBerfkEtTFTk` | **Generations** table (library) |
| `netlify/functions/_airtable.js` | `AVATARS` | `tblsT27uHkU21Csq0` | **Avatars** table |

- **If these are your own bases**, leave the code as it is. The Airtable account connected in Composio must be able to access them.
- **If you're starting fresh with your own Airtable**, create the bases and tables, then replace these six IDs. The IDs are in each Airtable URL: `airtable.com/appXXXX/tblYYYY/...`.

**App Auth table fields** that the code reads and writes:
`First Name`, `PIN Hash`, `Kie API Key`, `fal API Key`, `Has Kie`, `Has fal`, `Failed Login Attempts`, `Failed Window Started`, `Locked Until`.

There's also an optional `Status` field: `Active` (the default), `Enabled` or `Approved` allow sign-in, and anything else blocks it.

**Create a user:** add a row with `First Name`, then set `PIN Hash` in one of two ways:
- the plain PIN (for example `4821`), which works but isn't recommended, or
- a salted hash in the form `salt:hash`, generated with:
```bash
node -e 'const c=require("crypto");const s=c.randomBytes(16);console.log(s.toString("hex")+":"+c.scryptSync(process.argv[1],s,32).toString("hex"))' 4821
```

Users are created as App Auth rows. A user signs in with their **first name + PIN**. After the first sign-in, the app asks them to connect their kie.ai and/or fal.ai key, and the key is validated live and saved to their row.

---

## 3. Deploy to Netlify (recommended)

1. Netlify, then **Add new site**, then **Import from Git**, then pick `luay-85/Open-Higgsfield-AI`.
2. The build settings come from `netlify.toml` automatically:
   - Build command: `npm install && npx vite build`
   - Publish directory: `dist`
   - Functions: `netlify/functions`, plus the edge functions (`/download-media`)
   - Node 22
3. **Site configuration, then Environment variables.** Add:

| Variable | Required | Notes |
|---|---|---|
| `COMPOSIO_API_KEY` | **Yes** | `ak_…` (org key) or `uak_…` (user key) |
| `COMPOSIO_ORG_ID` | if using a `uak_` key | Defaults to the original author's org. **Set your own** |
| `COMPOSIO_PROJECT_ID` | if using a `uak_` key | Defaults to the original author's project. **Set your own** |
| `COMPOSIO_USER_ID` | optional | Picks the Composio user or entity |
| `AIRTABLE_PAT` (or `AIRTABLE_API_KEY` / `AIRTABLE_TOKEN` / `AIRTABLE_AUTH`) | recommended | Direct Airtable token. The auth and avatar routes use it |
| `KIE_API_KEY` | optional | Site-wide fallback. Normally each user's own key is used |
| `FAL_KEY` | optional | Site-wide fallback for fal.ai |
| `RESEND_API_KEY`, `RESEND_FROM` | optional | Lockout alert emails |
| `NOTIFY_EMAIL` (or `ADMIN_EMAIL` / `OWNER_EMAIL`) | optional | Who receives lockout alerts |

4. Click **Deploy**. Then open the site, sign in with an App Auth user, and paste your kie.ai key when prompted.

> Security tip: `COMPOSIO_ORG_ID` and `COMPOSIO_PROJECT_ID` fall back to IDs hard-coded in `_composio.js`. Always set your own values so you never depend on someone else's project.

---

## 4. Run locally

### Option A: UI only, using your deployed backend (fastest)
```bash
git clone https://github.com/luay-85/Open-Higgsfield-AI.git
cd Open-Higgsfield-AI
npm install
npm run vite:dev          # opens at http://localhost:5173
```
`vite.config.mjs` proxies `/.netlify/functions` and `/download-media` to **`https://higgsfield-matu.netlify.app`**. **Change both `target` values to your own Netlify URL** once you've deployed. Otherwise local dev talks to that site.

### Option B: full stack locally (frontend + functions)
```bash
npm install -g netlify-cli
netlify login
netlify link                # pick your site; this pulls env vars
netlify dev                 # runs Vite + functions + edge functions together
```

### Production build check
```bash
npx vite build              # output in dist/
```

### Desktop app (Electron): not recommended for this fork
`npm run electron:build` packages `dist/` and loads it from `file://`. This fork depends on `/.netlify/functions/*` for sign-in and generation, and those relative calls don't resolve inside the desktop app. Use the web deployment instead, or ask and I can make the API base URL configurable for Electron.

---

## 5. What each studio does

| Tab | Purpose | Key options |
|---|---|---|
| **Image** | Text-to-image and reference-based editing | Model, aspect ratio, resolution 1K/2K/4K, up to 14 reference images, prompt builder |
| **Video** | Text-to-video and image-to-video | Model, aspect, duration, start/end frame (Kling 3.0), reference video (HappyHorse Ref) |
| **Cinema** | Directed "film look" shots | Camera body, lens, focal length 8–85 mm, aperture f/1.4–f/11. These translate into prompt modifiers |
| **Lip Sync / Talk** | Portrait + dialogue to talking video | Write dialogue, pick one of 67 ElevenLabs voices, pick a talking model. Runs in two stages: voice, then video |
| **AI Influencer (Avatars)** | Reusable characters | Upload portraits, store them in Airtable, train a Flux LoRA on fal.ai, then generate consistent images/videos of that character |
| **Library** | Everything you generated | Preview, download (via `/download-media`), delete. Unfinished jobs are recovered here even if you closed the tab |

**Prompt builder** (`prompt-builder.js`) turns a plain-language idea into a production prompt, using the kie.ai chat endpoint and your kie key.

---

## 6. Model cheat sheet (from `data/models.json`)

**Image**
| Model | Best for |
|---|---|
| Nano Banana Pro | Highest fidelity. Up to 14 references. Character and style consistency |
| Nano Banana 2 | Best all-rounder for text-to-image and edits |
| Nano Banana 2 Lite | Cheap, fast drafts and storyboards |
| GPT Image 2 / GPT Image 2 Edit | Legible text (titles, signs, posters), strong prompt adherence |
| Nano Banana / Nano Banana Edit | Cheapest options |
| Ideogram v3 | The only model with a real **style** parameter (typography, graphic looks) |
| fal Flux LoRA / Flux Pro Kontext | Your trained character (LoRA), and precise in-context edits |

**Video**
| Model | Best for |
|---|---|
| Seedance 2.0 | Flagship quality, billed per second |
| Seedance 2.0 Fast | Quicker, cheaper drafts of the same look |
| Seedance 1.5 Pro | Cinematic shots **with audio** |
| Kling 3.0 | **First/last frame control**: exact transitions and loops |
| Kling 3 Turbo | Fast Kling drafts |
| Wan 2.5 | Open-source, budget-friendly |
| HappyHorse 1.1 / Reference | The only **4:5** video (Instagram feed). Reference-driven motion |

**Talking / lip-sync**
| Model | Best for |
|---|---|
| Kling AI Avatar Pro | Most realistic face. Audio up to 5 min |
| Kling AI Avatar Standard | Cheaper, stable lip-sync |
| OmniHuman 1.5 | Natural upper-body motion. Audio under 60 s |
| Wan 2.2 Speech-to-Video Turbo | The only one with a real motion knob (guidance) and a negative prompt |
| InfiniteTalk | Long-form talking from one portrait |
| ElevenLabs Multilingual v2 | Text-to-speech that feeds the models above |

---

## 7. Workflows for animation projects

**A. Animated short with a consistent character**
1. **Avatars**: upload 10–20 varied images of your character, then train a LoRA (fal.ai).
2. **Image**: make keyframes per shot with Flux LoRA or Nano Banana Pro (use the character sheet as a reference image).
3. **Video**: animate each keyframe with **Kling 3.0** (start frame + end frame = controlled motion) or **Seedance 2.0**.
4. Draft with *Seedance 2.0 Fast* or *Kling 3 Turbo*, then re-render the approved shots on the flagship models.
5. Download from **Library** and assemble in your editor (CapCut, Premiere, DaVinci).

**B. Talking character or explainer**
1. Make a clean front-facing portrait (Nano Banana Pro, 1:1 or 9:16).
2. **Lip Sync**: write the script, pick a voice, pick *Kling Avatar Pro* (long) or *OmniHuman 1.5* (expressive, under 60 s).
3. For stylised or cartoon characters, try *Wan 2.2 S2V* and add a negative prompt such as "realistic skin, photo".

**C. Seamless loop or transition**
Kling 3.0 with the **same image as first and last frame** gives a perfect loop. Use two different keyframes for a morph or transition.

**D. Social formats**
- 9:16 for Reels, TikTok and Shorts (most models)
- 4:5 for the Instagram feed (HappyHorse only)
- 16:9 for YouTube
- 21:9 for cinematic stills (image models)

**Prompt pattern for animation:**
`[subject + style] , [action/motion verb] , [camera move: slow dolly-in / orbit / handheld] , [lighting] , [mood] , [style tags: 2D cel-shaded / Pixar-style 3D / anime / claymation]`
In **Cinema**, the camera, lens and aperture choices add the lens language for you.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Stuck on "Loading…" or the sign-in screen won't accept you | No App Auth row for that name/PIN, Composio/Airtable not connected, or the account is locked for 30 min after 5 failed attempts |
| `500` mentioning `COMPOSIO_API_KEY` | Env var missing on Netlify. Redeploy after adding it |
| `KIE_KEY_REQUIRED` / `403` | The user hasn't connected a kie.ai key. Reconnect it via provider setup |
| Generation fails with credits error | Top up kie.ai or fal.ai credits. The header shows balances |
| Avatars return `401` | Stale `AIRTABLE_AUTH`. Set a valid `AIRTABLE_PAT` |
| Local dev calls the wrong backend | Update the proxy `target`s in `vite.config.mjs` |
| Downloads fail | The `media-download` edge function must be deployed (it is, via `netlify.toml`) |
| Media disappears after a few days | kie.ai CDN links expire. The Airtable attachment is the durable copy, so keep the library synced |

---

## 9. Checklist

- [ ] Netlify site created from the fork
- [ ] Composio account with the Airtable toolkit connected; `COMPOSIO_API_KEY`, `COMPOSIO_ORG_ID` and `COMPOSIO_PROJECT_ID` set
- [ ] Airtable bases and tables exist (or the IDs in `_auth.js` / `_airtable.js` are updated)
- [ ] At least one App Auth user (First Name + PIN Hash)
- [ ] kie.ai key with credits (and fal.ai if you want LoRA avatars)
- [ ] Proxy targets in `vite.config.mjs` point to your own Netlify URL
- [ ] First test: Image, Nano Banana 2 Lite, 1:1 (cheapest end-to-end check)
