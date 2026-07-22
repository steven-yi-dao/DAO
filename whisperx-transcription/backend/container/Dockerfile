# CUDA + cuDNN base matching the T4 (g4dn) drivers on SageMaker.
# Pull requires an ECR login against the AWS DLC account:
#   aws ecr get-login-password --region us-east-2 \
#     | docker login --username AWS --password-stdin 763104351884.dkr.ecr.us-east-2.amazonaws.com
FROM 763104351884.dkr.ecr.us-east-2.amazonaws.com/pytorch-inference:2.3.0-gpu-py311

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/opt/ml/model/hf-cache \
    SAGEMAKER_PROGRAM=inference.py

# pyannote needs libsndfile; whisperx needs ffmpeg for anything that isn't WAV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# The SageMaker toolkit looks for handler code under /opt/ml/code.
COPY code/ /opt/ml/code/
WORKDIR /opt/ml/code
