# WhisperX backend

AWS SAM implementation of [`../BACKEND_PLAN.md`](../BACKEND_PLAN.md).

```
backend/
├── template.yaml          # the whole stack (S3, DynamoDB, Cognito, API, Lambdas, SageMaker)
├── samconfig.toml
├── src/                   # Lambda handlers — one CodeUri, five handlers
│   ├── common/            # shared HTTP plumbing + DynamoDB access
│   ├── create_job/  submit_job/  list_jobs/  get_transcript/  on_complete/
├── container/             # GPU inference image
└── tests/                 # stdlib unittest, no AWS needed
```

## Deploying

The stack deploys in two passes because the SageMaker endpoint can't be created
until an image exists in ECR. Everything behind `InferenceImageUri` is gated on
a CloudFormation condition, so pass one is a complete, working API.

**Prerequisites:** the `ml.g4dn.xlarge for endpoint usage` service quota must be
above 0. The plan assumed a new account at 0 with a multi-day approval wait; this
account is already at **1** in us-east-2, so nothing is blocked. Keep the
`MaxInstances` parameter equal to that quota — set higher, autoscaling will try
to scale out and fail. Quotas are per-region and do not transfer.

```bash
# Pass 1 — storage, auth, API, Lambdas. No GPU cost.
sam build && sam deploy --guided

# Put the Hugging Face token in the secret the stack created.
# The account must have accepted the licences for pyannote/speaker-diarization-3.1
# and pyannote/segmentation-3.0, or diarization fails at runtime.
aws secretsmanager put-secret-value \
  --secret-id whisperx/hf-token --secret-string 'hf_xxx'

# Pass 2 — build and push the container, then light up SageMaker.
aws ecr get-login-password --region us-east-2 \
  | docker login --username AWS --password-stdin \
      763104351884.dkr.ecr.us-east-2.amazonaws.com
ECR=$(aws cloudformation describe-stacks --stack-name whisperx \
  --query "Stacks[0].Outputs[?OutputKey=='EcrRepositoryUri'].OutputValue" --output text)
docker build -t "$ECR:latest" container/ && docker push "$ECR:latest"
sam deploy --parameter-overrides "InferenceImageUri=$ECR:latest"
```

Then wire the SPA — `sam list stack-outputs --stack-name whisperx` gives the
three values that go in `../.env.local` (see `../.env.example`).

## Running the tests

```bash
python3 -m unittest discover -s tests
```

`boto3` is stubbed at import time, so these need no AWS account, credentials, or
third-party packages.

## Notes and deviations from the plan

- **`inferenceId-index` GSI (added).** The plan's schema had no way to get from
  an SNS notification back to a job row — `onComplete` receives an `inferenceId`
  but the primary key is `USER#<sub>` / `JOB#<createdAt>#<jobId>`, and neither
  component is derivable from it. A sparse GSI on `inferenceId` closes that gap.
  `submit_job` also passes `InferenceId=jobId` so the two are the same value.
- **Size enforcement moved to `submit_job`.** A presigned PUT can't cap upload
  size, so the declared `sizeBytes` is validated at create time and the *actual*
  object size is checked with `head_object` before inference is invoked.
- **`PROCESSING` is never set.** SageMaker async notifies on completion only —
  there's no start event — so jobs go `QUEUED` → `DONE`/`ERROR`. The status is
  kept in the type union in case a heartbeat is added later. `UPLOADED` is
  likewise unused: `submit_job` moves `CREATED` straight to `QUEUED`.
- **Transcript shape.** The container writes segments already matching the SPA's
  `Segment` type, mapping WhisperX word `score` to the `low` confidence flag the
  review UI highlights (threshold 0.5).
- **`ScalableTarget` `RoleARN`** points at the Application Auto Scaling
  service-linked role. If the account has never used SageMaker autoscaling, that
  role may not exist yet — `aws iam create-service-linked-role --aws-service-name
  sagemaker.application-autoscaling.amazonaws.com` creates it.
- **Failure messages are generic.** `failureReason` from SageMaker carries
  container stack traces; it goes to CloudWatch, and the user sees a generic
  message. The per-job `.log` in `logs/jobs/<jobId>.log` has the detail.

## Not yet verified

None of this has been deployed — the machine it was written on has no `aws`,
`sam`, `docker`, or credentials. Static checks that *did* pass: Python compiles,
18 unit tests, template parses as CloudFormation with all `Ref`/`GetAtt`/`Sub`
targets resolving, and the SPA typechecks and builds. Still unproven end to end:
`sam validate`/`sam deploy`, the container build (the whisperx / faster-whisper /
ctranslate2 / cuDNN version pinning is the plan's own §9 top risk), whether
large-v3 + pyannote fits in the T4's 16 GB, and scale-to-zero behaviour.
