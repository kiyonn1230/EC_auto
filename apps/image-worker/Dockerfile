FROM python:3.11-slim

WORKDIR /app

# onnxruntime (rembg) 用
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# rembgモデルは初回ジョブ時に ~/.u2net へ自動DLされる。
# Railway等ではボリュームをマウントするとコールドスタートが速くなる。
ENV U2NET_HOME=/data/models

CMD ["python", "worker.py"]
