---
name: verify
description: Build, launch, and drive the WhisperX transcription app against a real backend to verify changes at the UI surface.
---

# Verifying this app

Vite + React 19 SPA talking to the FastAPI backend in `backend/` through
`src/lib/api.ts`. **The mocks are gone** — nothing moves without a running API.
**StrictMode is on** — state updaters run twice in dev, so keep them pure;
impure updaters here have caused real stalls.

## Launch

Two processes. The API needs no GPU and no torch (`app/main.py` never imports
`transcribe`), so a small venv is enough:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install fastapi uvicorn python-multipart httpx

# terminal 1 — API on :8000, scratch /data
cd backend && DATA_DIR=./.devdata ./.venv/bin/python -m uvicorn app.main:app --port 8000

# terminal 2 — SPA on :5199, proxying /api to :8000
npm run dev -- --port 5199 --strictPort
```

Vite binds `localhost`, not `127.0.0.1`; use `http://localhost:5199/`.
`npx tsc -b && npm run build` is a CI-style check, not verification.

**No worker runs in this setup**, so uploads sit at `QUEUED` forever. Drive the
transitions by hand against the same `DATA_DIR`:

```bash
# QUEUED -> DONE, with a transcript, using the backend's own code
tests/contract/finish_job.py <jobId>       # via backend/.venv/bin/python,
                                           # cwd=backend, PYTHONPATH=backend
# QUEUED -> RUNNING
python -c 'from app import db; c=db.connect(); db.claim_next(c)'   # torch/whisperx stubbed
```

## Drive (Playwright)

No Playwright in the repo — `npm install playwright-core` in a scratch dir and
launch with `chromium.launch({ channel: 'chrome', headless: true })` (Google
Chrome is installed on this machine).

Flow gotchas:
- Connect gate: click the **"Transcribe"** card. It is a `GET /api/health` check
  and **succeeds on the first attempt** when the API is up; if the API is down
  you get the real error and a Retry button.
- Step headings carry an sr-only prefix, so the accessible name is
  `Step 2 of 3: Processing`. Match unanchored: `{ name: /Processing/ }`.
- `Completed · N` renders through `text-transform: uppercase`, so `innerText`
  returns `COMPLETED · 1`. Match case-insensitively.
- Upload: `page.locator('input[type=file]').setInputFiles([...])` with in-memory
  buffers works. Anything not in `mp3/wav/m4a/flac/ogg/mp4/aac` is rejected
  client-side before any request. There is no settings panel — model, language,
  and diarization are fixed by the backend.
- Progress bars: `uploading` is determinate with a real `aria-valuenow`;
  `processing` is `.progress-bar--indeterminate` with **no** `aria-valuenow`.
  A percentage on a RUNNING job is a bug — the backend has no progress field.
- Deleting a RUNNING job is refused by the API; the row stays and the message
  lands in `.app-alert`.
- Step indicator only navigates **backwards**. "Continue to review" enables once
  every job uploaded this session is `done` or `error`.
- The transcript is a second request (`/api/jobs/{id}/transcript`) made when the
  editor opens; expect a brief "Loading transcript…" before `.segment__text`.
- Idle timeout ends the session after ~15 min; clicks reset it. Ending a session
  clears only the local view — jobs come back from the server on reconnect.

Useful assertions: `.queue-row .file-name`, `.history__row .file-name`,
`.segment__text`, `.word--low`, `.app-alert`, and tag texts `In queue`,
`Processing`, `Done` (note: `Processing` also matches the page heading).

## Tests before the browser

- `npm test` — 24 client unit tests, stubbed fetch/XHR.
- `npm run test:contract` — 16 cases driving the real client against a real
  uvicorn. This is what catches contract drift; run it after any change to
  `src/lib/api.ts` or `backend/app/db.py`.
