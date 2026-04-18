# Voice Expense Deployment Guide

This app can support **quick expense addition** with a simple two-step architecture:

1. **Mobile app (React Native/Expo)** records voice and uploads audio.
2. **Backend API** calls OpenAI transcription + extraction and returns structured expense fields.

---

## 1) Recommended production architecture

### Why not call OpenAI directly from the app?
- API keys must stay secret.
- You need centralized logging, retries, and rate limits.
- You can evolve prompts/models without shipping a new app build.

### Production flow
1. User taps **Add expense using → Voice**.
2. App records up to ~15 seconds of speech.
3. App sends audio file to backend endpoint (authenticated).
4. Backend:
   - Transcribes audio (`gpt-4o-mini-transcribe`).
   - Extracts entities (`responses.create` with JSON schema).
   - Normalizes values (`NA`, category/payment_mode validation).
5. Backend returns:
   - transcript
   - extracted fields (`amount`, `merchant`, `payment_mode`, `payment_source`, `category`, `comment`)
6. App auto-fills form and user confirms save.

---

## 2) Minimal backend API contract

### Endpoint
`POST /api/expenses/voice-extract`

### Request
- `multipart/form-data`
- field: `audio` (wav/m4a)

### Response (example)
```json
{
  "transcript": "Paid 250 to Rapido using UPI",
  "entities": {
    "amount": "250",
    "merchant": "Rapido",
    "payment_mode": "UPI",
    "payment_source": "NA",
    "category": "Transport",
    "comment": "Paid 250 to Rapido"
  }
}
```

---

## 3) Deployment checklist

1. Create backend service (Node/Python) with secure secret storage.
2. Store `OPENAI_API_KEY` in server environment (never in client app).
3. Add authentication (JWT/session) to endpoint.
4. Add request limits:
   - max file size (e.g., 10 MB)
   - timeout (e.g., 20s)
   - per-user rate limit
5. Log failures with request IDs (without storing raw sensitive audio long-term unless policy allows).
6. Add monitoring for:
   - transcription latency
   - extraction failures
   - parse confidence fallback rates

---

## 4) UX pattern in this app

The app uses:
- **Add expense using**
  - **Voice**
  - **Manual**

Voice mode supports:
- **Convert and save** (one tap flow)
- **Fill fields only** (user review flow)

Manual mode keeps only amount required and avoids prefilled defaults.

---

## 5) Suggested reliability fallbacks

- If transcription fails: show transcript error and keep user in Voice mode.
- If extraction misses amount: switch to Manual with partial fields filled.
- Keep original transcript in comment only when user confirms.

---

## 6) Data/privacy notes

- Ask for mic permission at runtime.
- Show clear disclosure that speech is processed on secure servers.
- Redact account numbers in logs where possible.
- Define retention policy for audio/transcripts.
