# seek-server: the seek CLI running `seek serve` as a back-end that holds
# provider API keys. It reads /etc/seek/server.yml when one is mounted, and
# the SEEK_* environment variables.

# Build on the native platform and cross-compile, so multi-arch images don't
# need emulation.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.5 AS build
ARG TARGETARCH
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
COPY skills ./skills
# The configuration schemas define seek's settings and are compiled in.
COPY docs/specifications ./docs/specifications
RUN case "$TARGETARCH" in \
      amd64) target=bun-linux-x64 ;; \
      arm64) target=bun-linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && bun build src/index.ts --compile --target="$target" --outfile /out/seek

FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.title="seek-server" \
      org.opencontainers.image.source="https://github.com/wyrd-company/seek-cli" \
      org.opencontainers.image.description="seek CLI back-end that proxies provider calls with server-held API keys"
COPY --from=build /out/seek /usr/local/bin/seek
ENV SEEK_SERVER_HOST=0.0.0.0
EXPOSE 8787
USER nonroot
ENTRYPOINT ["/usr/local/bin/seek"]
CMD ["serve"]
