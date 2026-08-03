---
name: verify
description: Build, launch, and drive the WhisperX transcription demo app to verify changes at the UI surface.
---

# Verifying this app

Vite + React 19 SPA. **The SPA is still driven entirely by client-side mocks** — the FastAPI backend under `backend/` exists but nothing in `src/` calls it yet. **StrictMode is on** — state updaters run twice in dev, so keep them pure; impure updaters here have caused real stalls.

## Launch

```bash
npm run dev -- --port 5199 --strictPort   # background it
npx tsc --noEmit && npm run build          # CI-style check only, not verification
```

## Drive (Playwright)

No Playwright in the repo — `npm install playwright-core` in a scratch dir and launch with `chromium.launch({ channel: 'chrome', headless: true })` (Google Chrome is installed on this machine).

Flow gotchas:
- Connect gate: click the **"Transcribe"** card. The **first attempt always fails by design** — wait ~1.8s, then click **"Retry"**.
- Upload: `page.locator('input[type=file]').setInputFiles([...])` with in-memory buffers works (the hidden input accepts any bytes; duration is estimated from size). There is no settings panel — model, language, and diarization are fixed by the backend.
- A file named containing **"fail"** errors during processing (tests the Retry path).
- Seeded external job `Hello-world.wav` (Steven Yi) joins the shared queue automatically after connect.
- Step indicator only navigates **backwards**; to reach the process page use "Start transcription" / "View processing" on the upload page.
- Idle timeout ends the session after ~15 min; clicks reset it.

Useful assertions: count tag texts `In queue`, `✓ Done`, `Uploading`, `Processing` (note: `Processing` also matches the page heading — subtract 1).
