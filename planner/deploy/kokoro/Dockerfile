# Kokoro text-to-speech: natural open-source voices, fast on CPU (ARM-friendly).
FROM python:3.12-slim
RUN pip install --no-cache-dir "kokoro-onnx==0.6.1"
ADD https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx /models/kokoro.onnx
ADD https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin /models/voices.bin
COPY server.py /app/server.py
ENV KOKORO_VOICE=bm_george
EXPOSE 5000
CMD ["python", "/app/server.py"]
