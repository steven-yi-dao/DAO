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
├── docker-compose.yml     caddy + api + worker (CPU)
├── docker-compose.gpu.yml GPU overlay for the worker
├── deploy/user-data.sh    first-boot bootstrap
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

The SPA has a matching contract test that runs the real app against this API.
It needs an interpreter with the API's dependencies, which is also what makes
the whole suite above run:

```bash
python3 -m venv .venv
.venv/bin/pip install fastapi uvicorn python-multipart httpx
```

Then, from the repository root, `npm run test:contract`. It starts uvicorn on
port 8123 against a scratch `backend/.contract-data`, drives every route
through `src/lib/api.ts`, and asserts the job JSON matches the client's `ApiJob`
field for field. No GPU and no torch: `app/main.py` never imports `transcribe`.

## Provisioning the instance

One-time manual setup. Everything here is a handful of console or CLI steps;
there is no CloudFormation stack to drift.

**Before anything else: GPU quota.** A new account has a
`Running On-Demand G and VT instances` quota of **0**, and a `g4dn.xlarge`
needs 4 vCPUs of it. The launch fails with `VcpuLimitExceeded` until AWS
approves an increase, and the request is reviewed by a human.

```bash
aws service-quotas request-service-quota-increase \
  --service-code ec2 --quota-code L-DB2E81BA --desired-value 4
aws service-quotas list-requested-service-quota-change-history-by-quota \
  --service-code ec2 --quota-code L-DB2E81BA \
  --query 'RequestedQuotas[0].[Status,DesiredValue]' --output text
```

`CASE_CLOSED` is the terminal state for **both** outcomes. Do not read it as a
denial, and do not read the applied value straight after the case closes: an
approval says the new quota "will take effect in 30 minutes", so the value
still reports the old one for a while. Check the case correspondence for the
verdict, and re-read the applied value later:

```bash
aws service-quotas get-service-quota --service-code ec2 \
  --quota-code L-DB2E81BA --query 'Quota.Value' --output text
```

This account was approved 19 minutes after filing.

The stack also runs fine without a GPU — see [Running without a
GPU](#running-without-a-gpu).

1. **Instance** — launch a `g4dn.xlarge` (one NVIDIA T4, 16 GiB GPU memory)
   from the Deep Learning Base OSS Nvidia Driver AMI (Ubuntu 22.04), which
   carries the driver, Docker, and `nvidia-container-toolkit` already. Resolve
   it rather than hardcoding an ID, since it is rebuilt often:

   ```bash
   aws ssm get-parameter --query Parameter.Value --output text \
     --name /aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id
   ```

   Its snapshot is 75 GiB, so the root volume cannot be smaller than that, but
   **use 150 GiB**. The torch 2.8 base image plus the two built images do not
   fit in 75 GiB: the first attempt filled the disk to 97% mid-pull and killed
   the build.
2. **Data volume** — an encrypted gp3 EBS volume in the *same AZ* as the
   instance, with **DeleteOnTermination = false**. 50 GiB is ample: the only
   real consumer is seven days of retained audio, and one GPU running jobs
   serially cannot accumulate much. gp3 grows online, so start small.
   `deploy/user-data.sh` formats and mounts it at `/data`.
3. **Security group** — inbound `443` (and `80`, which Caddy needs for the ACME
   HTTP challenge and the redirect) from `0.0.0.0/0`. **No SSH rule.**
4. **Elastic IP** — allocate and associate, so the address survives a stop/start.
5. **DNS** — see [TLS without a domain](#tls-without-a-domain). The name must
   resolve *before* the first `docker compose up`, or Caddy's certificate
   request fails.
6. **IAM** — an instance profile with `AmazonSSMManagedInstanceCore` and nothing
   else. Shell access is via Session Manager (`aws ssm start-session`), not SSH.

No S3 bucket, no ECR repository, no Cognito user pool. S3 is worth adding later
for off-instance backup of `/data`, but it is not part of the live job flow.

### TLS without a domain

Caddy provisions a real certificate automatically, but Let's Encrypt needs a
hostname it is willing to sign. The instance's free
`ec2-<ip>.us-east-2.compute.amazonaws.com` name **will not work**: the whole
`compute.amazonaws.com` space is refused by Let's Encrypt policy, and the ACME
order fails.

Where no domain is owned, use [sslip.io](https://sslip.io), a wildcard DNS
service that resolves `3-23-151-46.sslip.io` to `3.23.151.46`. Let's Encrypt
issues for it over the HTTP-01 challenge, so `DOMAIN` is the only thing that
changes:

```
DOMAIN=<elastic-ip-with-dashes>.sslip.io
```

The Let's Encrypt rate limit is shared across every sslip.io user and is
occasionally exhausted. `nip.io` resolves identically and is the fallback.

CloudFront would also supply a free `*.cloudfront.net` name with a valid
managed certificate, but its origin response timeout caps at 60s (180s with a
quota increase) while FastAPI only responds once a full 500 MB upload has
landed. It is the wrong shape for this API.

### Running without a GPU

`docker-compose.yml` has no GPU reservation in it; `docker-compose.gpu.yml`
adds one. So the base stack starts on any host, and the GPU is layered on where
one exists:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

`deploy/user-data.sh` picks between the two by testing `nvidia-smi`, so the same
bootstrap serves a CPU instance and a `g4dn` with no edit. No application change
is involved either way: `app/transcribe.py` sets `DEVICE` from
`torch.cuda.is_available()` and drops from `float16` to `int8` compute on CPU.

The overlay is additive on purpose. Compose merge semantics for *removing* a key
in an override file are murky, while adding one is well defined, so the GPU is
the thing that gets added rather than the thing that gets subtracted.

Transcription on CPU is far slower than on a T4 and is meant for validating the
pipeline, not for serving real load. Stop the instance when it is not in use;
compute billing stops while `/data` and the Elastic IP persist.

### Resources in account 400854831334 (us-east-2)

| Resource | ID |
|---|---|
| Security group | `sg-06edbbd2d98049a7d` (`whisperx-web-sg`) |
| Instance profile | `whisperx-instance-profile` |
| Elastic IP | `eipalloc-00b9257d874c53707` — `3.23.151.46` |
| Data volume | `vol-0ef218b5a0a98f279` — 50 GiB, encrypted, us-east-2a |
| Hostname | `3-23-151-46.sslip.io` |

## First launch

`deploy/user-data.sh` does the whole first boot: it finds the data volume by
its serial (never by device name — the instance store is an NVMe device too,
and guessing could format the wrong disk), makes a filesystem only if the disk
is blank, mounts it at `/data` by UUID, installs Node, checks the repo out,
builds the SPA, writes `.env`, and brings the stack up. Every step is guarded,
so re-running it is safe.

```bash
aws ec2 run-instances \
  --image-id "$(aws ssm get-parameter --query Parameter.Value --output text \
    --name /aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id)" \
  --instance-type g4dn.xlarge \
  --subnet-id subnet-089b011b1aa283a0d \
  --security-group-ids sg-06edbbd2d98049a7d \
  --iam-instance-profile Name=whisperx-instance-profile \
  --metadata-options HttpTokens=required \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=75,VolumeType=gp3,Encrypted=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=whisperx}]' \
  --user-data file://deploy/user-data.sh

# Then attach the data volume and the Elastic IP to the new instance:
aws ec2 attach-volume --volume-id vol-0ef218b5a0a98f279 \
  --instance-id i-xxxxxxxx --device /dev/sdf
aws ec2 modify-instance-attribute --instance-id i-xxxxxxxx \
  --block-device-mappings 'DeviceName=/dev/sdf,Ebs={DeleteOnTermination=false}'
aws ec2 associate-address --instance-id i-xxxxxxxx \
  --allocation-id eipalloc-00b9257d874c53707
```

The bootstrap waits for the volume, so attaching it after launch is fine.
Watch it with `tail -f /var/log/whisperx-bootstrap.log`.

## Redeploying

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
