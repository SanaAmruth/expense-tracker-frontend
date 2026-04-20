# Expense Tracker

Mobile-first expense tracker prototype built with Expo and React Native.

## Planned scope

1. Dark UI inspired by the provided design reference.
2. Manual expense entry with amount, merchant, date, time, payment mode, category, and comment.
3. Voice-oriented entry flow with smart parsing into structured fields.
4. Calendar heatmap, monthly/category analytics, history, and budget summaries.
5. Clear hook points for OpenAI-backed parsing and insights.

## Run locally

1. `npm install`
2. `npm run start`

If you’re using the voice backend locally, set `EXPO_PUBLIC_VOICE_API_URL` (see `.env.example`).

## Deploy (Netlify)

This project reads `EXPO_PUBLIC_*` env vars via Expo’s `.env` loading during `expo export`.
If you deploy with Netlify (Git-based deploys), `netlify.toml` generates `.env` from Netlify’s
environment variables at build time and publishes `dist/`.

## OpenAI integration

You do not need an API key to run the current prototype.

An OpenAI key becomes useful for:

- converting raw speech transcripts into structured expenses
- auto-categorizing merchants and comments
- generating spending summaries and unusual-spend alerts

Recommended flow:

1. Capture speech on-device.
2. Convert speech to text.
3. Send the transcript to a backend endpoint with your OpenAI API key.
4. Return parsed JSON for amount, merchant, mode, category, date, and comment.

Keep the API key on a backend service, not inside the mobile app bundle.

For a deployment-ready voice pipeline and API contract, see:

- `docs/VOICE_DEPLOYMENT.md`
