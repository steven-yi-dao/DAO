# WhisperX Transcription — Backend Implementation Plan

> Living design doc for the AWS backend behind the existing React frontend.
> Last updated: 2026-07-14

---

## 1. Decisions locked (from planning session)

| Area | Decision |
|---|---|
| **GPU serving** | SageMaker **Async Inference endpoint**, autoscaling **min 0 / max 2** instances (scale-to-zero when idle → pay nothing between jobs). |
| **Instance / models** | `ml.g4dn.xlarge` (1× NVIDIA T4, 16 GB). Tiers: `fast=small`, `balanced=medium`, `accurate=large-v3` (fp16). |
| **Diarization** | **On.** WhisperX `--diarize` via pyannote. Requires a Hugging Face token (gated models) stored in **Secrets Manager**. |
| **The log** | **Per-job processing log**, one object per job at `s3://…/logs/jobs/<jobId>.log`. |
| **Auth** | **Amazon Cognito** user pool, small invite-only internal team. JWT-protected API. History keyed by user `sub`. |
| **Edits** | Backend stores the **original** WhisperX output only. Review-step edits are **client-side / download-only**. |
| **Job updates** | **Polling.** Frontend polls `GET /jobs` every ~3s. SNS→Lambda keeps DynamoDB fresh. |
| **Region** | `us-east-2` (matches mock). |
| **Starting point** | Greenfield — plan builds everything. |

**Assumed defaults (change if wrong):** single S3 bucket with prefixes; max upload 500 MB (matches UI); uploads auto-expire after 7 days; transcripts/logs retained indefinitely; max 2 concurrent GPU instances.

---

## 2. Architecture at a glance

```
                         ┌─────────────────────────────────────────────┐
   Browser (React SPA)   │                   AWS                        │
   ───────────────────   │                                             │
   │ Cognito login  │────┼──► Cognito User Pool (JWT)                   │
   │                │    │                                             │
   │ 1. POST /jobs  │────┼──► API Gateway (HTTP API, JWT authorizer)    │
   │   {settings}   │    │        │                                    │
   │ ◄── {jobId,    │    │        ▼                                    │
   │      uploadUrl}│    │     Lambda: createJob ──► DynamoDB (Jobs)    │
   │                │    │                       └─► presign S3 PUT     │
   │ 2. PUT file ───┼────┼──────────────────────► S3 uploads/ prefix   │
   │                │    │                                             │
   │ 3. POST /jobs/ │────┼──► Lambda: submitJob                        │
   │    {id}/submit │    │        │ write manifest.json → S3           │
   │                │    │        └─► sagemaker:InvokeEndpointAsync ──┐ │
   │                │    │                                            │ │
   │                │    │   SageMaker Async Endpoint (min0/max2 GPU) │ │
   │                │    │   ┌────────────────────────────────────┐  │ │
   │                │    │   │ internal queue → WhisperX container │◄─┘ │
   │                │    │   │  • download audio from S3          │    │
   │                │    │   │  • transcribe → align → diarize    │    │
   │                │    │   │  • write transcript JSON → S3      │    │
   │                │    │   │  • write per-job .log → S3         │    │
   │                │    │   └──────────────┬─────────────────────┘    │
   │                │    │        success/failure ▼                    │
   │                │    │            SNS topics ──► Lambda: onComplete │
   │                │    │                              └─► DynamoDB    │
   │ 4. GET /jobs   │────┼──► Lambda: listJobs ◄──────── DynamoDB       │
   │   (poll ~3s)   │    │                                             │
   │ 5. GET /jobs/  │────┼──► Lambda: getTranscript ──► presign S3 GET  │
   │    {id}/…      │    │                                             │
                         └─────────────────────────────────────────────┘
```

---

## 3. AWS resource inventory

| Type | Name (suggested) | Purpose |
|---|---|---|
| S3 bucket | `whisperx-<acct>-<region>-data` | uploads, manifests, async output, transcripts, logs (prefixes below) |
| DynamoDB | `whisperx-jobs` | job metadata, status, per-user history |
| Cognito | `whisperx-users` (user pool + app client) | auth, invite-only |
| Secrets Manager | `whisperx/hf-token` | Hugging Face token for pyannote diarization |
| ECR | `whisperx-inference` | GPU container image |
| SageMaker | model `whisperx`, endpoint-config, **async** endpoint `whisperx-async` | GPU inference |
| SNS | `whisperx-inference-success`, `whisperx-inference-error` | async completion notifications |
| API Gateway | `whisperx-api` (HTTP API) | REST surface, JWT authorizer |
| Lambda ×5 | `createJob`, `submitJob`, `listJobs`, `getTranscript`, `onComplete` | app logic |
| Application Auto Scaling | target on the endpoint variant | scale 0↔2 |
| IAM | 3 roles (SageMaker exec, Lambda exec, API GW) | least-privilege |
| CloudWatch | log groups + a billing alarm | observability + cost guardrail |

### S3 prefix layout (single bucket)
```
s3://whisperx-<acct>-<region>-data/
├── uploads/<userId>/<jobId>/<filename>       # user audio (presigned PUT); 7-day lifecycle
├── manifests/<jobId>.json                    # async InputLocation (job spec)
├── async-output/<jobId>/                     # raw SageMaker async response
├── transcripts/<userId>/<jobId>.json         # WhisperX result (words+segments+speakers)
└── logs/jobs/<jobId>.log                      # ← THE per-job log
```

### DynamoDB `whisperx-jobs` schema
```
PK  = USER#<cognito-sub>
SK  = JOB#<createdAtISO>#<jobId>          # sorts history newest-last; query reverses
Attributes:
  jobId, userId, fileName, sizeBytes, durationSec,
  model (fast|balanced|accurate), language, diarize (bool),
  status (CREATED|UPLOADED|QUEUED|PROCESSING|DONE|ERROR),
  inferenceId,                              # SageMaker async id → maps SNS msg back to job
  transcriptKey, logKey, errorMsg,
  createdAt, updatedAt, segmentCount, durationProcessedSec
GSI1 (optional, admin): PK=STATUS#<status>, SK=updatedAt   # ops view of the queue
```

---

## 4. Code that lives on the SageMaker instance (the container)

The async endpoint uses a standard SageMaker inference container. We use the **SageMaker PyTorch inference toolkit** contract (`model_fn` / `input_fn` / `predict_fn` / `output_fn`). The async input is a small **manifest JSON** (not the raw audio) — the container downloads the audio from S3 itself, so 500 MB files never travel through the request body.

**Repo layout for the image:**
```
container/
├── Dockerfile
├── requirements.txt
└── code/
    └── inference.py
```

### `container/Dockerfile`
```dockerfile
# CUDA + cuDNN base with Python; matches T4 (g4dn) drivers on SageMaker
FROM 763104351884.dkr.ecr.us-east-2.amazonaws.com/pytorch-inference:2.3-gpu-py311

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/opt/ml/model/hf-cache \
    SAGEMAKER_PROGRAM=inference.py

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# SageMaker toolkit looks for code under /opt/ml/code
COPY code/ /opt/ml/code/
WORKDIR /opt/ml/code
```

### `container/requirements.txt`
```
whisperx==3.1.5
pyannote.audio==3.1.1
faster-whisper==1.0.3
ctranslate2==4.4.0
boto3
```
> Pin exact versions once validated on the T4 image; ctranslate2/faster-whisper/whisperx are tightly coupled.

### `container/code/inference.py`
```python
import os, io, json, time, tempfile, subprocess, logging
import boto3
import torch
import whisperx

log = logging.getLogger("whisperx")
logging.basicConfig(level=logging.INFO)

s3 = boto3.client("s3")
sm_secrets = boto3.client("secretsmanager")

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE = "float16" if DEVICE == "cuda" else "int8"
TIER_TO_MODEL = {"fast": "small", "balanced": "medium", "accurate": "large-v3"}

# Caches so a warm instance reuses loaded weights across jobs
_asr_cache = {}       # model_name -> whisperx asr model
_align_cache = {}     # language   -> (align_model, metadata)
_diarize = {"pipe": None}


def _hf_token():
    arn = os.environ["HF_TOKEN_SECRET_ARN"]
    return sm_secrets.get_secret_value(SecretId=arn)["SecretString"]


# ---- SageMaker contract -----------------------------------------------------

def model_fn(model_dir):
    """Called once when the container starts. Nothing heavy loaded eagerly;
    ASR/align/diarize weights load lazily and stay cached for warm reuse."""
    return {"device": DEVICE}


def input_fn(request_body, content_type="application/json"):
    """Async InputLocation points at manifests/<jobId>.json. SageMaker downloads
    it and hands us the bytes here."""
    return json.loads(request_body)


def predict_fn(manifest, ctx):
    """manifest = {jobId, userId, bucket, audioKey, model, language,
                   diarize, transcriptKey, logKey}"""
    job = manifest["jobId"]
    bucket = manifest["bucket"]
    logbuf = io.StringIO()

    def emit(msg):
        line = f"[{job}] {msg}"
        log.info(line)
        logbuf.write(line + "\n")

    t0 = time.time()
    emit(f"file={manifest['audioKey']} model={manifest['model']} "
         f"lang={manifest['language']} diarize={manifest['diarize']}")

    with tempfile.TemporaryDirectory() as tmp:
        local = os.path.join(tmp, "audio")
        s3.download_file(bucket, manifest["audioKey"], local)
        audio = whisperx.load_audio(local)

        # 1) transcribe
        model_name = TIER_TO_MODEL[manifest["model"]]
        if model_name not in _asr_cache:
            emit(f"loading ASR model {model_name}")
            _asr_cache[model_name] = whisperx.load_model(
                model_name, DEVICE, compute_type=COMPUTE,
                language=manifest.get("language") or None)
        t = time.time()
        result = _asr_cache[model_name].transcribe(audio, batch_size=16)
        lang = result["language"]
        emit(f"transcribe {time.time()-t:.1f}s (detected lang={lang})")

        # 2) word-level alignment
        if lang not in _align_cache:
            _align_cache[lang] = whisperx.load_align_model(lang, DEVICE)
        align_model, meta = _align_cache[lang]
        t = time.time()
        result = whisperx.align(result["segments"], align_model, meta,
                                audio, DEVICE, return_char_alignments=False)
        emit(f"align {time.time()-t:.1f}s")

        # 3) diarization (pyannote via HF-gated models)
        if manifest["diarize"]:
            if _diarize["pipe"] is None:
                emit("loading diarization pipeline")
                _diarize["pipe"] = whisperx.DiarizationPipeline(
                    use_auth_token=_hf_token(), device=DEVICE)
            t = time.time()
            diarize_df = _diarize["pipe"](audio)
            result = whisperx.assign_word_speakers(diarize_df, result)
            emit(f"diarize {time.time()-t:.1f}s")

        segments = result["segments"]
        emit(f"DONE {len(segments)} segments in {time.time()-t0:.1f}s")

    # 4) persist transcript + log to S3 at deterministic keys
    transcript = {
        "jobId": job, "language": lang, "segments": segments,
    }
    s3.put_object(Bucket=bucket, Key=manifest["transcriptKey"],
                  Body=json.dumps(transcript).encode(),
                  ContentType="application/json")
    s3.put_object(Bucket=bucket, Key=manifest["logKey"],
                  Body=logbuf.getvalue().encode(), ContentType="text/plain")

    # 5) small summary → becomes the async OutputLocation object; onComplete Lambda reads it
    return {
        "jobId": job, "status": "DONE", "language": lang,
        "segmentCount": len(segments),
        "transcriptKey": manifest["transcriptKey"],
        "logKey": manifest["logKey"],
    }


def output_fn(prediction, accept="application/json"):
    return json.dumps(prediction), "application/json"
```

> **Failure path:** if `predict_fn` raises, SageMaker routes the async failure to the **error SNS topic** with the failure S3 location; the `onComplete` Lambda marks the job `ERROR`. Wrap the body in try/except to still flush a partial `.log` before re-raising.

---

## 5. API layer (Lambda handlers)

All routes behind API Gateway **HTTP API** with a **Cognito JWT authorizer**. `userId = claims.sub`.

| Method / route | Lambda | Behavior |
|---|---|---|
| `POST /jobs` | `createJob` | Validate settings + size ≤ 500 MB. Create DynamoDB row (`CREATED`). Return `{jobId, uploadUrl}` where `uploadUrl` = presigned **PUT** to `uploads/<userId>/<jobId>/<filename>`. |
| `POST /jobs/{id}/submit` | `submitJob` | Verify object exists. Write `manifests/<jobId>.json`. Call `sagemaker.invoke_endpoint_async(InputLocation=manifest)`. Save `inferenceId`, set status `QUEUED`. |
| `GET /jobs` | `listJobs` | Query DynamoDB `PK=USER#<sub>`, newest first. Powers both the active queue and history. |
| `GET /jobs/{id}` | `getTranscript` | Return job row; if `DONE`, include presigned **GET** URL for `transcriptKey` (and `logKey` for debugging). |
| *(SNS trigger)* | `onComplete` | Subscribed to success + error topics. Map `inferenceId`→job, set `DONE`/`ERROR`, copy `segmentCount`, `transcriptKey`, `logKey`, `errorMsg`. |

**`submitJob` core (Python):**
```python
manifest = {
    "jobId": job["jobId"], "userId": user_sub, "bucket": BUCKET,
    "audioKey": job["audioKey"], "model": job["model"],
    "language": job["language"], "diarize": job["diarize"],
    "transcriptKey": f"transcripts/{user_sub}/{job['jobId']}.json",
    "logKey":        f"logs/jobs/{job['jobId']}.log",
}
key = f"manifests/{job['jobId']}.json"
s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(manifest).encode())
resp = sm.invoke_endpoint_async(
    EndpointName="whisperx-async",
    InputLocation=f"s3://{BUCKET}/{key}",
    ContentType="application/json",
)
ddb.update_item(... status="QUEUED", inferenceId=resp["InferenceId"] ...)
```

---

## 6. IAM roles (least privilege)

**SageMaker execution role**
- `s3:GetObject` on `uploads/*`, `manifests/*`; `s3:PutObject` on `transcripts/*`, `logs/*`, `async-output/*`
- `secretsmanager:GetSecretValue` on the HF-token secret
- `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `ecr:GetAuthorizationToken`
- `sns:Publish` (success/error topics), `logs:CreateLogStream`/`PutLogEvents`

**Lambda execution role**
- `dynamodb:*Item`/`Query` on `whisperx-jobs` (+ GSI)
- `s3:PutObject`/`GetObject` (presign) scoped to the data bucket prefixes
- `sagemaker:InvokeEndpointAsync` on the endpoint
- CloudWatch Logs

**API Gateway** — Cognito authorizer only (no extra IAM).

---

## 7. Phased build

### Phase 0 — Account prep & quotas *(do first; the quota can take a day)*
- [ ] Pick region `us-east-2`; confirm billing alarm exists.
- [ ] **Service Quotas → SageMaker** → request quota for **`ml.g4dn.xlarge` for endpoint usage ≥ 2** and **for async endpoint usage** if listed separately. *New accounts default to 0 — nothing runs until this is granted.*
- [ ] Create a Hugging Face account, accept licenses for **`pyannote/speaker-diarization-3.1`** and **`pyannote/segmentation-3.0`**, generate a read token.

### Phase 1 — Storage & identity
- [ ] Create S3 bucket `whisperx-<acct>-<region>-data`; block public access; add lifecycle rule expiring `uploads/` after 7 days; add CORS allowing the SPA origin for presigned PUT/GET.
- [ ] Create DynamoDB `whisperx-jobs` (on-demand capacity), PK/SK per §3.
- [ ] Create Cognito user pool `whisperx-users` + app client (SPA, no secret, hosted UI or Amplify). Invite the team; disable self-signup.
- [ ] Put the HF token in Secrets Manager `whisperx/hf-token`.
- [ ] Create the three IAM roles (§6).

### Phase 2 — Container → ECR
- [ ] Create ECR repo `whisperx-inference`.
- [ ] Build the image (§4) on a GPU box or CodeBuild; **smoke-test locally** on a sample file (transcribe + align + diarize) before pushing.
- [ ] `docker push` to ECR.

### Phase 3 — SageMaker async endpoint
- [ ] Create SageMaker **Model** pointing at the ECR image + SageMaker exec role; set env `HF_TOKEN_SECRET_ARN`.
- [ ] Create **endpoint-config** with `AsyncInferenceConfig`: `OutputConfig` → `s3://…/async-output/`, `NotificationConfig` → success + error SNS topics; `ClientConfig.MaxConcurrentInvocationsPerInstance` (e.g. 1, since one T4 = one job).
- [ ] Create **endpoint** `whisperx-async` on `ml.g4dn.xlarge`, initial instance count 1 (drop to 0 after autoscaling is attached).
- [ ] Register **Application Auto Scaling** target: `MinCapacity=0`, `MaxCapacity=2`, target-tracking on `ApproximateBacklogSizePerInstance` (e.g. target 1). This is what enables scale-to-zero and 0→N cold starts on demand.
- [ ] Create SNS topics; subscribe `onComplete` Lambda.
- [ ] **End-to-end test:** drop a manifest via `invoke_endpoint_async`, confirm transcript + `.log` land in S3 and SNS fires.

### Phase 4 — API + Lambdas
- [ ] Deploy the 5 Lambdas (§5). Recommend **AWS SAM / CDK** so it's reproducible, not console click-ops.
- [ ] Create HTTP API + Cognito JWT authorizer; wire routes; enable CORS for the SPA origin.
- [ ] Test each route with a real Cognito JWT.

### Phase 5 — Wire the frontend
- [ ] Replace mock `startSession`/`runUploadProgress`/`runProgress` with: Cognito login → `POST /jobs` → presigned `PUT` → `POST /jobs/{id}/submit` → poll `GET /jobs`.
- [ ] Map API `status` → existing `FileStatus` (`CREATED/UPLOADED`→`uploading`, `QUEUED`→`queued`, `PROCESSING`→`processing`, `DONE`→`done`, `ERROR`→`error`).
- [ ] History screen ← `GET /jobs`; editor download ← presigned transcript GET.
- [x] Remove the idle-timeout UX. There is no per-session instance to tear down, so ending a session on a timer saved nothing and only cost the user their queue. Gone: the ticker, `IdleModal`, the footer's auto-ends readout, and the `IDLE_*` constants. Ending a session is now only ever explicit.

### Phase 6 — Hardening & cost
- [ ] CloudWatch alarms: endpoint 5xx, async error-topic volume, DynamoDB throttles.
- [ ] Billing alarm + AWS Budgets on SageMaker spend.
- [ ] Confirm the endpoint truly scales to 0 after idle (watch `InstanceCount`).
- [ ] Optional GSI1 ops dashboard for the shared queue.

---

## 8. Cost & latency notes
- **Idle = ~$0** for GPU (scales to 0); you still pay S3/DynamoDB/Lambda pennies.
- **Cold start 0→1** takes several minutes (instance boot + container + model download). The existing UI queue already communicates "waiting," so this is acceptable — but set user expectations in copy.
- Keep whisper/align/diarize weights **cached in the container** across warm jobs (done in §4) so back-to-back jobs skip reload.
- One T4 = one concurrent job; `max 2` instances = 2 concurrent. Raise `MaxCapacity` + quota if the team outgrows it.

## 9. Open items / risks
- **pyannote + large-v3 on 16 GB T4** is tight. If OOM: run diarization on CPU, or bump `accurate` to `ml.g5.xlarge` (A10G, 24 GB). Validate in Phase 2.
- **Version coupling** (whisperx/faster-whisper/ctranslate2/cuDNN) is the most common breakage — pin and test on the exact base image.
- Async endpoints have a **per-invocation timeout** (up to 1 hr) and 1 GB payload cap. Our manifest pattern keeps payloads tiny; a 500 MB / long file must still finish under the timeout — spot-check the worst case.
- Decide transcript **retention/PII** policy (audio + transcripts may be sensitive) before onboarding real users.

---

## 10. Suggested next step
Stand up **Phase 0 + Phase 1** (quota request is the long pole) while I (or you) build and smoke-test the container in **Phase 2**. Nothing downstream can be tested until the GPU quota is granted, so file that request today.
