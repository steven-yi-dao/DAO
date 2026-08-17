#!/usr/bin/env bash
# First-boot bootstrap for the WhisperX instance. Passed as EC2 user data, so it
# runs once, as root, on the initial launch only. Re-running it by hand is safe:
# every step is guarded.
#
# Assumes the Deep Learning Base OSS Nvidia Driver AMI (Ubuntu 22.04), which
# already carries the NVIDIA driver, Docker, and nvidia-container-toolkit.
set -euxo pipefail

DATA_VOLUME_ID=vol-0ef218b5a0a98f279
DOMAIN=3-23-151-46.sslip.io
REPO=https://github.com/steven-yi-dao/DAO.git
BRANCH=backend/ec2-whisperx
CHECKOUT=/opt/whisperx

exec > >(tee -a /var/log/whisperx-bootstrap.log) 2>&1
echo "bootstrap starting $(date -Is)"

# --- data volume -----------------------------------------------------------
# g4dn ships a 125 GB local NVMe instance store alongside the EBS volumes, and
# its data is lost on stop/terminate. Match on the EBS volume's serial rather
# than guessing a device name, so we can never format the wrong disk.
SERIAL="${DATA_VOLUME_ID//-/}"
DEV=""
for _ in $(seq 1 60); do
  if [ -e "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${SERIAL}" ]; then
    DEV=$(readlink -f "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${SERIAL}")
    break
  fi
  # Fallback for AMIs without the by-id udev rule.
  while read -r name serial; do
    [ "$serial" = "$SERIAL" ] && DEV="/dev/$name"
  done < <(lsblk -dno NAME,SERIAL)
  [ -n "$DEV" ] && break
  sleep 5
done
[ -n "$DEV" ] || { echo "data volume $DATA_VOLUME_ID never appeared"; exit 1; }
echo "data volume is $DEV"

# Only make a filesystem on a blank disk. A volume that survived an instance
# replacement already has one, and reformatting it would destroy every job.
if ! blkid "$DEV" >/dev/null 2>&1; then
  echo "no filesystem on $DEV, creating ext4"
  mkfs.ext4 -L whisperx-data "$DEV"
else
  echo "$DEV already has a filesystem, leaving it alone"
fi

mkdir -p /data
UUID=$(blkid -s UUID -o value "$DEV")
if ! grep -q "$UUID" /etc/fstab; then
  # nofail so a detached volume degrades to a failed service rather than a box
  # that will not finish booting.
  echo "UUID=$UUID /data ext4 defaults,nofail 0 2" >> /etc/fstab
fi
mountpoint -q /data || mount /data

mkdir -p /data/uploads/tmp /data/transcripts /data/logs /data/models

# --- toolchain -------------------------------------------------------------
systemctl enable --now docker

if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose-plugin
fi

command -v git >/dev/null 2>&1 || { apt-get update; apt-get install -y git; }

# The SPA is built on the host; Caddy serves the resulting dist/ directory.
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# --- application -----------------------------------------------------------
if [ ! -d "$CHECKOUT/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$CHECKOUT"
else
  git -C "$CHECKOUT" fetch origin "$BRANCH"
  git -C "$CHECKOUT" checkout "$BRANCH"
  git -C "$CHECKOUT" reset --hard "origin/$BRANCH"
fi

APP="$CHECKOUT/whisperx-transcription"
cd "$APP"
npm ci
npm run build

cd "$APP/backend"
cat > .env <<EOF
DOMAIN=$DOMAIN
DATA_DIR=/data
MAX_UPLOAD_BYTES=524288000
RETENTION_DAYS=7
WHISPER_MODEL=medium
EOF

# Layer the GPU reservation on only where there is a GPU, so this same script
# bootstraps a CPU box and a g4dn unchanged. app/transcribe.py already selects
# cuda or cpu on its own.
COMPOSE_ARGS="-f docker-compose.yml"
if nvidia-smi >/dev/null 2>&1; then
  echo "GPU present, adding docker-compose.gpu.yml"
  COMPOSE_ARGS="$COMPOSE_ARGS -f docker-compose.gpu.yml"
else
  echo "no GPU detected, running the stack on CPU"
fi

docker compose $COMPOSE_ARGS up -d --build

echo "bootstrap finished $(date -Is)"
