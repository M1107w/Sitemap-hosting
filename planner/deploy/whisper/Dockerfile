# whisper.cpp speech-to-text server (open source, runs on CPU, ARM-friendly).
FROM debian:bookworm-slim AS build
ARG WHISPER_REF=v1.7.4
RUN apt-get update && apt-get install -y --no-install-recommends git cmake make g++ ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch ${WHISPER_REF} https://github.com/ggml-org/whisper.cpp.git .
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF && cmake --build build -j"$(nproc)" --config Release
RUN mkdir -p /out && (cp build/bin/whisper-server /out/ 2>/dev/null || cp build/bin/server /out/whisper-server)
ARG WHISPER_MODEL=base.en
RUN sh ./models/download-ggml-model.sh ${WHISPER_MODEL} && cp models/ggml-${WHISPER_MODEL}.bin /out/model.bin

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /opt/whisper/
EXPOSE 8080
# --convert: accept any audio (iPhone sends m4a) and let ffmpeg turn it into 16 kHz wav
CMD ["/opt/whisper/whisper-server", "--host", "0.0.0.0", "--port", "8080", "-m", "/opt/whisper/model.bin", "--convert", "-l", "en", "-t", "4"]
