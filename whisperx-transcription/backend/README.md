# WhisperX backend

One always-running EC2 GPU instance holding the entire application: Caddy for
TLS and the SPA, FastAPI for uploads and the job API, a single WhisperX worker,
and SQLite for job state. No Lambda, no SageMaker, no DynamoDB, no queue
service.

This is deliberately a single-server product. See [Accepted
limitations](#accepted-limitations).

## Layout

```
backend/
├── docker-compose.yml     caddy + api + worker
├── Caddyfile              TLS, SPA, /api reverse proxy
├── Dockerfile             one image for both Python services
├── requirements.txt
├── app/
│   ├── config.py          settings and the /data layout
│   ├── db.py              SQLite schema; the table *is* the queue
│   ├── storage.py         upload staging, atomic placement, cleanup
│   ├── transcribe.py      WhisperX pipeline
│   ├── worker.py          claim loop, startup recovery, retention sweep
│   └── main.py            FastAPI
└── tests/
```

## API

All routes are under `/api`. Errors return `{"message": "..."}`.

| Verb | Path | Notes |
|---|---|---|
| `POST` | `/api/jobs` | multipart upload; one request replaces create → presigned PUT → submit. `201` with the job |
| `GET` | `/api/jobs?limit=` | newest first, 1–200, default 100 |
| `GET` | `/api/jobs/{id}` | one job |
| `GET` | `/api/jobs/{id}/transcript` | `409` until `DONE` |
| `GET` | `/api/jobs/{id}/log` | per-job pipeline log |
| `POST` | `/api/jobs/{id}/retry` | `ERROR` → `QUEUED` under a new attempt |
| `DELETE` | `/api/jobs/{id}` | row + audio + transcript + log |
| `GET` | `/api/health` | probe |

Job states are exactly `QUEUED`, `RUNNING`, `DONE`, `ERROR`.

## Product configuration

Fixed, not per-job: Whisper **medium**, automatic language detection, word
alignment on, **diarization off**, one job at a time, seven-day deletion of
source audio, an `attempt` counter for explicit retries.

Dropping diarization is what removes pyannote, the Hugging Face token, Secrets
Manager, and a large amount of GPU memory pressure.

## Data on `/data`

```
/data/jobs.db                        SQLite (WAL)
/data/uploads/tmp/<uuid>.part        streaming target
/data/uploads/<job_id>/<name>        after atomic rename
/data/transcripts/<job_id>.json
/data/logs/<job_id>.log
/data/models/                        model cache — survives restarts
```

`/data` must be the separate encrypted EBS volume. Never put it on the
instance's local NVMe: [instance-store data is lost when the instance stops or
terminates](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-store-lifetime.html).

## Local development

Runs on CPU — no GPU needed to exercise the whole pipeline, just slower.

```bash
cp .env.example .env          # set DOMAIN=localhost, DATA_DIR=./data
# comment out the worker's deploy.resources block in docker-compose.yml
docker compose up --build
```

Then:

```bash
curl -F "file=@sample.wav" localhost:8000/api/jobs
curl localhost:8000/api/jobs
curl localhost:8000/api/jobs/<id>/transcript
```

## Tests

```bash
python3 -m unittest discover -s . -p 'test_*.py' -t .
```

Stdlib `unittest`, no pytest. `torch`/`whisperx` are stubbed and FastAPI is
optional — the db, storage, and worker suites run against a bare interpreter,
and the API suite skips itself if `fastapi`/`httpx` aren't installed.

## Provisioning the instance

One-time manual setup. Everything here is a handful of console or CLI steps;
there is no CloudFormation stack to drift.

1. **Instance** — launch a `g4dn.xlarge` (one NVIDIA T4, 16 GiB GPU memory)
   with a GPU-ready AMI (Deep Learning AMI, or Ubuntu plus the NVIDIA driver
   and `nvidia-container-toolkit`). Root volume 50 GiB gp3.
2. **Data volume** — create an encrypted gp3 EBS volume (start at 200 GiB),
   attach it, and set **DeleteOnTermination = false**. Format once
   (`mkfs.ext4`), then add it to `/etc/fstab` by UUID mounted at `/data` so it
   survives reboots.
3. **Security group** — inbound `443` (and `80`, which Caddy needs for the ACME
   HTTP challenge and the redirect) from `0.0.0.0/0`. **No SSH rule.**
4. **Elastic IP** — allocate and associate, so the address survives a stop/start.
5. **DNS** — a Route 53 A record pointing at the Elastic IP. It must resolve
   *before* the first `docker compose up`, or Caddy's certificate request fails.
6. **IAM** — an instance profile with `AmazonSSMManagedInstanceCore` and nothing
   else. Shell access is via Session Manager (`aws ssm start-session`), not SSH.

No S3 bucket, no ECR repository, no Cognito user pool. S3 is worth adding later
for off-instance backup of `/data`, but it is not part of the live job flow.

## Deploying

```bash
aws ssm start-session --target i-xxxxxxxx

cd /opt/whisperx                    # wherever the repo is checked out
git pull

cd whisperx-transcription
npm ci && npm run build             # Caddy serves ../dist

cd backend
cp .env.example .env                # set DOMAIN to the Route 53 name
docker compose up -d --build
```

The image is built on the host, so there is no registry and no image tag to
version. Verify:

```bash
docker compose ps
docker compose exec worker nvidia-smi
docker compose logs -f worker       # "worker ready" once the model is loaded
curl -s https://$DOMAIN/api/health
```

The first start downloads the Whisper medium weights into `/data/models`, which
takes a few minutes. Subsequent restarts reuse the cache.

## Operations

```bash
docker compose logs -f worker                       # pipeline
sqlite3 /data/jobs.db 'select id,status,attempt,duration_sec from jobs'
cat /data/logs/<job_id>.log                         # one job's timings
docker compose restart worker                       # requeues anything RUNNING
```

**Backup** is `/data` — take periodic EBS snapshots. The SQLite file is in WAL
mode, so use `sqlite3 /data/jobs.db ".backup /data/backup.db"` rather than
copying the file directly while the stack is running.

**Recovery** is automatic: a row left `RUNNING` by a crashed or restarted worker
is moved back to `QUEUED` on the next startup, with `attempt` incremented so a
job that reliably kills the process is visible rather than looping silently.

## Accepted limitations

- Maintenance or instance failure makes the service unavailable.
- Jobs run serially — one GPU, one at a time.
- Deployment causes brief downtime.
- The instance costs money continuously, idle or not.

For a small user population where idle cost and high availability are not
concerns, these are the intended tradeoffs.
