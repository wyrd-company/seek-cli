# The capture environment for seek's terminal recordings: VHS with its
# browser, ttyd and ffmpeg, plus the tools the recordings run. Built and run
# by scripts/docs/capture.sh.
FROM ghcr.io/charmbracelet/vhs:v0.12.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs curl jq ca-certificates \
  && rm -rf /var/lib/apt/lists/*
