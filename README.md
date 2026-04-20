# Expense Tracker

Mobile-first expense tracker built with Expo + React Native (web + mobile).

## Features

- Manual expense entry
- Voice expense capture (records audio → backend parses into structured fields)
- Supabase persistence (auth + expenses table)

## Environment variables

Create a local `.env` (not committed) using `.env.example` as a template.

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_VOICE_API_URL` (example: `https://YOUR_BACKEND.up.railway.app/voice-expense`)

## Local development

1. Install deps: `npm install`
2. Start Expo: `npm run start`
3. Web: press `w` in the Expo CLI, or run `npm run web`

Voice flow requires the backend running (locally or deployed). For local backend, set
`EXPO_PUBLIC_VOICE_API_URL=http://localhost:8000/voice-expense`.

## Build (static web)

`npx expo export -p web -c`

This outputs `dist/` which Netlify serves.

## Deploy (Netlify)

Recommended (Git-based deploys):

1. Connect this repo in Netlify.
2. Set environment variables in Netlify:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_VOICE_API_URL`
3. Deploy.

This repo includes `netlify.toml` which:
- writes the Netlify env vars into a `.env` at build time
- runs `expo export`
- ensures `/_expo/*` assets are served correctly (no SPA rewrite for JS bundles)

## Notes

- Keep `OPENAI_API_KEY` on the backend only (never in the frontend).
- Voice API contract is documented in `docs/VOICE_DEPLOYMENT.md`.
