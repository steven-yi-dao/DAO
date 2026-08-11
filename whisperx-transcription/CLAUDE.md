# Project guidance

Two halves:

- **`src/`** — Vite + React 19 SPA. Talks to the backend through
  `src/lib/api.ts`. See `.claude/skills/verify/SKILL.md`.
- **`backend/`** — FastAPI + SQLite + WhisperX, run as three containers on one
  EC2 GPU instance. See `backend/README.md` and `BACKEND_PLAN.md`.

## Working on the frontend

- All network access goes through `src/lib/api.ts`. `ApiJob` mirrors the
  backend's `db.to_api` field for field, and the contract test asserts that —
  change one and you must change the other.
- Job state arrives by polling `GET /api/jobs`; there is no push channel and no
  per-job progress. Upload percentage is real (XHR); transcription progress does
  not exist, so its bar is indeterminate. Don't invent a number for it.
- The backend has no auth and no owner column. Jobs are anonymous; a job's
  membership in the current flow is tracked client-side only.
- Two suites: `npm test` (client unit tests, stubbed transport) and
  `npm run test:contract` (real client against a real uvicorn — this is the one
  that catches contract drift).

## Architecture

One always-running `g4dn.xlarge` holds the whole application. Idle cost,
scaling, and high availability are explicitly not concerns — do not reintroduce
Lambda, SageMaker, DynamoDB, SQS, Celery, or Redis to solve a problem the
single-server design already accepts.

The job queue is a SQLite table claimed transactionally by one worker. That is
the whole queue. Durability lives in the row: a `RUNNING` row on startup means
the worker died, and gets requeued.

## Working on the backend

- Keep `whisperx`, `faster-whisper`, and `ctranslate2` pinned together. They are
  tightly coupled and the most common source of breakage — do not bump one
  without re-testing the set on the exact base image.
- Model weights load once and stay warm. Any cache keyed by model or language
  must be bounded to the *active* entry and free the previous one; unbounded
  caches are what exhausted the T4 in the previous implementation.
- Everything durable goes under `/data` (the encrypted EBS volume). Never write
  application data to the instance's local NVMe — it is lost on stop/terminate.
- Tests are stdlib `unittest`, no pytest. `torch`/`whisperx` are stubbed and
  FastAPI is optional, so the suite runs on a bare interpreter:
  `python3 -m unittest discover -s . -p 'test_*.py' -t .` from `backend/`.

## AWS

- Infrastructure is provisioned by hand and documented as a runbook in
  `backend/README.md`. There is no CloudFormation stack; don't add one without
  agreeing to maintain it.
- Shell access is Systems Manager Session Manager, not SSH.
- When uncertain about AWS details (API parameters, permissions, limits, error
  codes), verify against documentation rather than guessing, and state
  uncertainty explicitly.
- Do not use em dashes in AWS resource names or descriptions; use hyphens.
