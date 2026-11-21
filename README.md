# KontrakKu — Understand any contract before you sign

**Built for #BuildHybridAI 2026** (Google + Firebase). Web / Chrome track.

KontrakKu reads a rental or loan contract in two hybrid steps, all through
**Firebase AI Logic**:

1. **On-device (Gemini Nano, `InferenceMode.PREFER_ON_DEVICE`)** — the contract's
   key facts (parties, amounts, term, interest/fees, late penalties,
   termination) are extracted privately on the user's device. Sensitive text
   does not leave the device in this stage.
2. **Cloud (Gemini `gemini-3.8-flash` via Firebase AI Logic)** — the extracted
   facts are explained in plain language, with red flags and a 0–100 risk
   score.

Every result shows which backend actually answered, using the official
`response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`). If the device has no
on-device model, Stage 1 falls back to the cloud automatically and says so.

No sign-up, no wallet, no fees. Text inference only, on the Firebase free
tier (Spark plan, Gemini Developer API backend — no billing, no card).

> ⚠️ KontrakKu is not a lawyer and this is not legal advice. Always read the
> full contract and consult a qualified professional before signing.

## Live demo

https://kontrakku.vercel.app (URL final setelah deploy — lihat HANDOFF.md)

## How to run locally

```bash
npm install
cp .env.example .env.local   # fill in your Firebase web config (see below)
npm run dev                  # http://localhost:5173
npm run build                # production build into dist/
```

## Firebase setup (one-time, ~10 minutes)

1. **Create a project** at https://console.firebase.google.com (Google Analytics
   optional). Keep it on the **Spark (free)** plan.
2. **AI Services → AI Logic → Get started.** Choose the **Gemini Developer API**
   provider (free, no billing) — NOT Agent Platform / Vertex (requires Blaze).
   The wizard enables the needed APIs and enforces App Check for AI Logic.
3. **Register the web app:** Project settings → Your apps → `</>` Web. Copy the
   `firebaseConfig` values into `.env.local` (or Vercel env vars, see below).
4. **App Check (required):** register a reCAPTCHA v3 site at
   https://www.google.com/recaptcha/admin (free), then in the Firebase console
   go to Security → App Check → Apps, register this app with the reCAPTCHA v3
   **secret key** (secret key goes ONLY in the console — never in code or the
   repo). Put the public **site key** in `VITE_RECAPTCHA_SITE_KEY`.
5. For local development only, a debug token can be used (see Firebase docs for
   the App Check debug provider). **Never commit a debug token, a service
   account key, or any `.env` file to this repo.**

### Vercel deploy

```bash
vercel --prod
```

Set the same `VITE_*` variables in Vercel → Project Settings → Environment
Variables (Production), then redeploy. The Firebase web config values are
public client config, not secrets.

## Architecture

- `index.html` + `src/main.js` — single-page UI (vanilla JS + Vite).
- `src/ai.js` — all AI calls. `firebase/ai` (`getAI`, `getGenerativeModel`,
  `GoogleAIBackend`, `InferenceMode`), `firebase/app-check`
  (`ReCaptchaV3Provider`). Stage 1 uses `PREFER_ON_DEVICE` with cloud
  fallback `gemini-3.8-flash`; Stage 2 uses `ONLY_IN_CLOUD` with
  `gemini-3.8-flash`. No other model API is called, ever.
- `src/samples.js` — two built-in sample contracts (rental, personal loan).
- `src/style.css` — dark UI.

## License

Apache License 2.0 — see `LICENSE`.
