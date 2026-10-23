# seek-server: the seek CLI running `seek serve` as a back-end that holds
# provider API keys (from env, a mounted config file, or Vault/OpenBao).

# Build on the native platform and cross-compile, so multi-arch images don't
# need emulation.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.4 AS build
ARG TARGETARCH
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
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
ENV SEEK_SERVER_HOST=0.0.0.0 \
    SEEK_SERVER_PORT=8787 \
    XDG_CONFIG_HOME=/config
EXPOSE 8787
USER nonroot
ENTRYPOINT ["/usr/local/bin/seek"]
CMD ["serve"]
