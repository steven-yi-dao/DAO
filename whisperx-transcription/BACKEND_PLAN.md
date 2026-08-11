# WhisperX Transcription — Backend Plan

> Living design doc for the backend behind the React frontend.
> Last updated: 2026-08-03

Supersedes the SageMaker/Lambda plan. That architecture — API Gateway, five
Lambdas, DynamoDB with a GSI, S3 presigned uploads, a SageMaker async endpoint,
SNS success/error topics, Application Auto Scaling, ECR, Secrets Manager,
Cognito — was removed in favour of one server.

---

## 1. Decisions

| Area | Decision |
|---|---|
| **Compute** | One always-running `g4dn.xlarge` (1× NVIDIA T4, 16 GiB GPU memory) |
| **Processes** | Docker Compose: `caddy`, `api`, `worker` |
| **Queue** | A SQLite table, claimed transactionally by one worker |
| **State** | SQLite on an encrypted EBS volume |
| **Auth** | None. Single shared queue; Caddy terminates TLS only |
| **Model** | Whisper `medium`, fixed — no tiers |
| **Language** | Automatic detection |
| **Alignment** | On (word-level) |
| **Diarization** | Off |
| **Concurrency** | One job at a time |
| **States** | `QUEUED`, `RUNNING`, `DONE`, `ERROR` |
| **Retention** | Source audio deleted after 7 days; rows and transcripts kept |
| **Retries** | Explicit, tracked by an `attempt` counter |
| **Edits** | Backend stores the original WhisperX output only; review-step edits stay client-side |
| **Job updates** | Polling. The frontend polls `GET /api/jobs` every 2s |
| **Max upload** | 500 MB, enforced while streaming |

Explicitly **not** concerns, per the stated requirements: idle cost, scaling,
high availability.

---

## 2. Architecture

```
Browser
   │ HTTPS
   ▼
EC2 g4dn.xlarge
├── Caddy      TLS, React SPA, reverse proxy to /api
├── FastAPI    upload and job API
├── Worker     WhisperX, one job at a time, model kept warm
├── SQLite     jobs, status
└── Encrypted EBS at /data   uploads, transcripts, logs, model cache
```

Both Python containers mount `/data`; only the worker gets the GPU.

---

## 3. API flow

1. `POST /api/jobs` takes a multipart file upload.
2. The API streams it to a temporary file on EBS, counting bytes against the
   500 MB limit as it writes — `Content-Length` is client-supplied, so the only
   honest limit is against the bytes actually stored.
3. On success it atomically renames the file into place, **then** inserts a
   `QUEUED` row. A row can therefore never point at a partial file, and the
   worker needs no existence check.
4. The worker claims the oldest `QUEUED` row and marks it `RUNNING`.
5. WhisperX writes the transcript JSON; the worker marks the job `DONE` — with
   the measured duration, detected language, and segment count — or `ERROR`.
6. The browser polls `GET /api/jobs`.
7. `GET /api/jobs/{id}/transcript` returns the finished transcript.

One upload request replaces the old create → presigned PUT → submit sequence.

---

## 4. Routes

Full table in [backend/README.md](backend/README.md#api). Errors return
`{"message": "..."}`, the shape the frontend's error handling already expects.

---

## 5. Data layout

```
/data/jobs.db                        SQLite (WAL)
/data/uploads/tmp/<uuid>.part        streaming target
/data/uploads/<job_id>/<name>        after atomic rename
/data/transcripts/<job_id>.json
/data/logs/<job_id>.log
/data/models/                        model cache — survives restarts
```

`/data` is the separate encrypted EBS volume with `DeleteOnTermination = false`,
never the instance's local NVMe, because [instance-store data is lost when the
instance stops or terminates](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html).

The transcript JSON is `{jobId, language, segments}`, with segments shaped
exactly as `src/types.ts` expects (`start`, `end`, `speaker`, `text`, and
`words[]` of `{display, low}`). `speaker` is always `null` now that diarization
is off.

---

## 6. AWS resources

- One `g4dn.xlarge`
- One encrypted data EBS volume, `DeleteOnTermination = false`
- One security group allowing 443 (and 80 for the ACME challenge)
- One Elastic IP and Route 53 A record
- One instance profile with `AmazonSSMManagedInstanceCore`

Access is via Systems Manager Session Manager; SSH is not exposed. S3 is
optional and only for backups, not the live job flow. Cognito would only be
added if individual accounts become a requirement.

---

## 7. Why the queue needs no service

The "queue" is a SQLite table read inside a `BEGIN IMMEDIATE` transaction by a
single worker. Redis, SQS, or Celery would each add a process, a failure mode,
and a state that can disagree with the database.

Durability comes from the row, not from process memory: if the worker dies
mid-job the row is left `RUNNING`, and the next startup moves it back to
`QUEUED` with `attempt` incremented — so a job that reliably kills the process
becomes visible instead of looping silently.

---

## 8. What this removed, and the bugs that went with it

| Removed | Bug class it took with it |
|---|---|
| SageMaker model, endpoint, endpoint config, autoscaling | Endpoint replacement blocked by a fixed physical name; unversioned image URIs not triggering updates |
| SNS success/error topics + the callback Lambda | Completions unattributable to a retry attempt; transient failures acked and silently dropped |
| DynamoDB + `inferenceId-index` | Callbacks arriving before the eventually-consistent GSI entry was queryable; job lookup capped by the 1 MB query page |
| S3 presigned PUT | A validated upload being overwritten after the size check and before inference |
| Three model tiers | Unbounded per-tier GPU model caches exhausting the T4 |
| Per-job language selection | UI locales (`en-US`, `en-GB`, `auto`) reaching `whisperx.load_model`, which wants `en` or `None` |
| API Gateway + five Lambdas | Distributed state-transition races; two-phase deployments |
| Pyannote, HF token, Secrets Manager | GPU memory pressure and a secret to manage |

Two fixes had to be carried into the new code rather than deleted with the old:

- **Bounded GPU caches.** `app/transcribe.py` holds one ASR model and the
  alignment model for exactly one language, dropping the previous one and
  calling `torch.cuda.empty_cache()` before loading the next.
- **Measured duration.** The worker persists `durationSec` on the `DONE`
  transition; the old completion handler computed it and discarded it.

---

## 9. Status

**Done**

- FastAPI app, SQLite store, worker loop, WhisperX pipeline
- Compose stack (Caddy + api + worker), Dockerfile, Caddyfile
- 50 unit tests: claim/recovery/retry/retention, upload validation and
  placement, and the worker's DONE/ERROR transitions
- Provisioning and deployment runbook
- **The SPA calls the API.** `src/lib/api.ts` is the typed client;
  `useJobPolling` replaces the old `setInterval` drivers; the connect gate is a
  `GET /api/health` check; `vite.config.ts` proxies `/api` to `localhost:8000`.
  The mock fixtures are gone.
- 24 client unit tests plus a 16-case contract test that drives the real client
  against a real uvicorn (`npm run test:contract`).

**Not done**

- Nothing has been deployed to EC2. Verified locally and by the test suites only.
- Root `amplify.yml` still hosts the SPA on Amplify. Once Caddy serves `dist/`
  from the instance, Amplify becomes redundant and should be retired.
- The idle-timeout UX still assumes a per-session instance. It now only clears
  the local view — jobs live on the server and come back on reconnect — but on
  an always-running server it remains cosmetic.
- Transcript retention and PII policy — audio and transcripts may be sensitive.
  Source audio is deleted after 7 days; transcripts are currently kept forever.

---

## 10. Risks

- **Version coupling.** `whisperx` / `faster-whisper` / `ctranslate2` are pinned
  together and are the most common source of breakage. Do not bump one without
  re-testing the set on the exact base image.
- **Single point of failure.** Instance failure or maintenance means downtime.
  Accepted.
- **GPU headroom.** Whisper medium plus one alignment model fits a T4
  comfortably; moving to `large-v3` later would need re-measuring.
- **Upload duration.** A 500 MB upload over a slow link holds a connection for a
  long time; Caddy's `/api` proxy timeouts are set to 30 minutes to match.
