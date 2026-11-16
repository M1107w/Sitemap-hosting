# Piper text-to-speech (open source, natural voices, fast on CPU).
FROM python:3.12-slim
RUN pip install --no-cache-dir "piper-tts[http]==1.8.0"
ARG VOICE=en_GB-alan-medium
ENV VOICE=${VOICE}
RUN mkdir /voices && python -m piper.download_voices ${VOICE} --data-dir /voices
EXPOSE 5000
CMD ["sh", "-c", "python -m piper.http_server --host 0.0.0.0 --port 5000 --data-dir /voices -m /voices/${VOICE}.onnx"]
