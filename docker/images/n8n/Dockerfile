ARG NODE_VERSION=26.12.1
ARG N8N_VERSION=snapshot

# The digest pins node:26.12.1-alpine3.24 for amd64 and arm64. Change the tag and the digest together.
ARG BUILDER_IMAGE=node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
# HARDENING (Fase 1): bumped from n8nio/base:26.12.1@sha256:435e5310... (Oct 22 build,
# contains libde265 -> 7 CVE MEDIUM). The Oct 23 rebuild (tag 26.12.1, digest below)
# drops libde265: 32 -> 25 OS CVEs, see reports/baseline-n8nio-base-26.12.1-newdigest-*.json.
# NB: the Dockerfile of release/2.45.4 is identical to release/2.44.7's (same
# pinned digests), and the official 2.45.4 image (pushed 2026-10-26) still ships
# the Oct 22 base (measured: 68 OS pkgs, libde265 present) -> this bump applies
# to 2.45.4 builds too.
# The BUILDER_IMAGE digest is irrelevant for the final image (multi-stage, only
# the compiled .node artifacts are copied over).
ARG RUNTIME_IMAGE=n8nio/base:26.12.1@sha256:4f98092ca321cc3395c056791013c2ad0469305d1734c031fc5bcb50afe5513a

# HARDENING (Fase 1): the runtime base is a Docker Hardened Image with no apk
# binary (apk add exits 127). Take the fixed packages from Alpine 3.24 instead.
# Besides libcurl/brotli, the pinned base ships openssh 10.3_p1-r1
# (CVE-2026-123158 CRITICAL, all openssh-* packages) and libexpat 2.9.0-r1
# (4 HIGH); both have patch-level fixes upstream (10.3_p1-r2 / 2.10.0-r0).
# The openssh binaries are built against the same OpenSSL 3.5.9 as the base,
# so the tar is extracted over the runtime root.
FROM alpine:3.24 AS os-fixes
RUN apk add --no-cache \
      'libcurl>=8.23.0-r0' \
      'brotli-libs>=1.2.1-r0' \
      'expat>=2.10.0-r0' \
      'openssh>=10.3_p1-r2' \
 && tar -cf /os-fixes.tar -C / \
      usr/lib/libexpat.so.1.13.1 usr/lib/libexpat.so.1 \
      usr/bin/ssh usr/bin/scp usr/bin/sftp usr/bin/ssh-add usr/bin/ssh-agent \
      usr/bin/ssh-copy-id usr/bin/ssh-keyscan usr/bin/ssh-keygen \
      usr/bin/ssh-pkcs11-helper usr/bin/findssl.sh \
      usr/lib/ssh usr/sbin/sshd

# HARDENING: npm 11.21.1 in the base bundles undici 6.28.1 (CVE-2026-109869).
# Build the fixed, dependency-free 6.29.1 once on the build platform and copy
# it over npm's internal copy in the runtime image.
FROM --platform=$BUILDPLATFORM node:26.12.1-alpine3.24 AS undici-fix
RUN npm pack undici@6.29.1 --pack-destination /tmp \
 && mkdir -p /tmp/undici \
 && tar xzf /tmp/undici-6.29.1.tgz -C /tmp/undici --strip-components=1

# Community nodes are baked into the image instead of being installed at
# runtime by an init container. They live in /opt, not in ~/.n8n, so a
# persistent volume mounted on /home/node/.n8n cannot shadow them. The separate
# stage keeps npm's cache and install leftovers out of the final image.
#
# - --legacy-peer-deps: do not duplicate n8n-workflow. The custom nodes resolve
#   the image's own copy through NODE_PATH (set in the runtime stage).
# - --ignore-scripts: no postinstall code from third-party packages. These nodes
#   are pure JS; a future node that needs a native build must drop this flag.
# - n8n-core is stubbed via overrides: the SuiteCRM package declares the ancient
#   0.111.0 but its dist only requires n8n-workflow. See custom-nodes/stub-n8n-core.
# - n8n-nodes-pdfkit calls image-size as a callable CommonJS default. We ship
#   2.0.3 (CVE-2025-71329/71330) and adapt that one require. The SuiteCRM
#   package's manifest lists a credentials path without ".js", which makes
#   n8n 2.x skip the whole package. patch-packages.mjs fixes both and fails the
#   build if a pinned package changes in a way the patches no longer match.
FROM ${BUILDER_IMAGE} AS custom-nodes
WORKDIR /opt/n8n-custom-nodes
COPY docker/images/n8n/custom-nodes/ ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts --legacy-peer-deps \
 && node patch-packages.mjs \
 && rm -rf /root/.npm

# The runtime base has no compiler, so this stage supplies one.
FROM ${BUILDER_IMAGE} AS toolchain
RUN apk add --no-cache python3 make g++
ENV NODE_GYP=/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js

# Compile the native modules above `COPY ./compiled`. An application change
# then does not start a new compile.
FROM toolchain AS native-builder

# These paths are pnpm symlinks. Copying through them uses the resolved version.
COPY ./compiled/node_modules/.pnpm/isolated-vm@*/node_modules/isolated-vm /build/isolated-vm
WORKDIR /build/isolated-vm
# node-gyp-build reads /etc/alpine-release to find musl. DHI Alpine does not
# have that file, so the loader uses the glibc prebuild and crashes.
RUN rm -rf prebuilds && node "$NODE_GYP" rebuild --release -j max

# sqlite3 needs node-addon-api for the headers, and `tar` because a gyp action
# unpacks the sqlite source. pnpm gives each package its own directory, so the
# dependencies of `tar` must come too.
COPY ./compiled/node_modules/.pnpm/sqlite3@*/node_modules/node-addon-api /build/node_modules/node-addon-api
COPY ./compiled/node_modules/.pnpm/sqlite3@*/node_modules/tar /build/node_modules/tar
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/@isaacs/fs-minipass /build/node_modules/@isaacs/fs-minipass
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/chownr /build/node_modules/chownr
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/minipass /build/node_modules/minipass
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/minizlib /build/node_modules/minizlib
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/yallist /build/node_modules/yallist
COPY ./compiled/node_modules/.pnpm/sqlite3@*/node_modules/sqlite3 /build/node_modules/sqlite3
WORKDIR /build/node_modules/sqlite3
RUN node "$NODE_GYP" rebuild --release

# Confluent has no prebuild for the Node version that CI installs, so
# `./compiled` has none. Compile it here against the base image librdkafka.
# See https://github.com/confluentinc/confluent-kafka-javascript/issues/397
RUN apk add --no-cache librdkafka-dev
COPY ./compiled/node_modules/.pnpm/@confluentinc+kafka-javascript@*/node_modules/nan /build/node_modules/nan
COPY ./compiled/node_modules/.pnpm/@confluentinc+kafka-javascript@*/node_modules/@confluentinc/kafka-javascript /build/node_modules/@confluentinc/kafka-javascript
WORKDIR /build/node_modules/@confluentinc/kafka-javascript
RUN BUILD_LIBRDKAFKA=0 node "$NODE_GYP" rebuild --release

# A separate workflow builds the base image. A new base reaches this image only
# when you change RUNTIME_IMAGE above.
FROM ${RUNTIME_IMAGE}

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ARG IMAGE_DESCRIPTION="Workflow Automation Tool"
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}
ENV SHELL=/bin/sh
# Custom nodes are installed without their peer deps; n8n-workflow (and any
# other peer) resolves from the n8n installation. n8n also adds its own module
# paths to NODE_PATH at startup, this makes it explicit for every process.
ENV NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules
# Separator in this n8n release is ';' (not ':'). n8n registers every custom
# directory under the same CUSTOM package name and the last loader wins (there
# is no merge), so an override must keep /opt/n8n-custom-nodes as the only or
# last value: "/opt/n8n-custom-nodes" is the supported setting.
ENV N8N_CUSTOM_EXTENSIONS=/opt/n8n-custom-nodes

WORKDIR /home/node

COPY --link ./compiled /usr/local/lib/node_modules/n8n
COPY --link docker/images/n8n/docker-entrypoint.sh /

# Do not use --link here. These destinations are pnpm symlinks. A --link copy
# resolves the destination against an empty root. It replaces the symlink with
# a directory, and the module does not load. The build still succeeds.
COPY --from=native-builder /build/node_modules/sqlite3/build/Release/node_sqlite3.node \
     /usr/local/lib/node_modules/n8n/node_modules/sqlite3/build/Release/node_sqlite3.node
COPY --from=native-builder /build/isolated-vm/build/Release/isolated_vm.node \
     /usr/local/lib/node_modules/n8n/node_modules/isolated-vm/build/Release/isolated_vm.node
# kafka-javascript has no top-level symlink, and its pnpm directory name holds
# a patch hash. The shell must expand this destination.
COPY --from=native-builder /build/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node /tmp/

# The base image keeps node in /usr/bin and has no /usr/local/bin.
RUN set -e; \
    N8N=/usr/local/lib/node_modules/n8n; \
    kafka=$(echo "$N8N"/node_modules/.pnpm/@confluentinc+kafka-javascript@*/node_modules/@confluentinc/kafka-javascript); \
    install -D /tmp/confluent-kafka-javascript.node "$kafka/build/Release/confluent-kafka-javascript.node"; \
    rm -rf "$N8N"/node_modules/.pnpm/isolated-vm@*/node_modules/isolated-vm/prebuilds; \
    mkdir -p /usr/local/bin; \
    ln -s "$N8N/bin/n8n" /usr/local/bin/n8n; \
    mkdir -p /home/node/.n8n; \
    chown -R node:node /home/node; \
    rm -rf /root/.npm /tmp/*

# HARDENING (Fase 1): the pinned base ships libcurl 8.22.0-r0 and brotli-libs
# 1.2.0-r1 (CVE-2026-92392 HIGH + ~22 LOW, CVE-2026-111497 HIGH), plus the
# openssh/libexpat versions from the os-fixes stage. Fixes are already published
# in the alpine 3.24 repositories. The runtime base is a Docker Hardened Image
# with no apk binary, so we copy the fixed files from os-fixes and update the
# APK DB entries (Trivy reads P/V from /lib/apk/db/installed). These are
# patch-level, ABI-compatible replacements; the old files are removed.
COPY --from=os-fixes /os-fixes.tar /tmp/os-fixes.tar
COPY --from=os-fixes /usr/lib/libcurl.so.4.8.0 /usr/lib/
COPY --from=os-fixes /usr/lib/libbrotlicommon.so.1.2.1 /usr/lib/
COPY --from=os-fixes /usr/lib/libbrotlidec.so.1.2.1 /usr/lib/
COPY --from=os-fixes /usr/lib/libbrotlienc.so.1.2.1 /usr/lib/
RUN set -e; \
    tar -xf /tmp/os-fixes.tar -C /; \
    rm -f /tmp/os-fixes.tar /usr/lib/libexpat.so.1.13.0; \
    ln -sf libcurl.so.4.8.0 /usr/lib/libcurl.so.4; \
    ln -sf libbrotlicommon.so.1.2.1 /usr/lib/libbrotlicommon.so.1; \
    ln -sf libbrotlidec.so.1.2.1 /usr/lib/libbrotlidec.so.1; \
    ln -sf libbrotlienc.so.1.2.1 /usr/lib/libbrotlienc.so.1; \
    rm -f /usr/lib/libbrotlicommon.so.1.2.0 /usr/lib/libbrotlidec.so.1.2.0 /usr/lib/libbrotlienc.so.1.2.0; \
    sed -i 's/^V:8.22.0-r0$/V:8.23.0-r0/' /lib/apk/db/installed; \
    sed -i 's/^V:1.2.0-r1$/V:1.2.1-r0/; s/libbrotlicommon\.so\.1\.2\.0/libbrotlicommon.so.1.2.1/g; s/libbrotlidec\.so\.1\.2\.0/libbrotlidec.so.1.2.1/g; s/libbrotlienc\.so\.1\.2\.0/libbrotlienc.so.1.2.1/g; s/=1\.2\.0/=1.2.1/g' /lib/apk/db/installed; \
    sed -i '/^P:libexpat$/,/^$/ s/^V:2\.9\.0-r1$/V:2.10.0-r0/' /lib/apk/db/installed; \
    sed -i '/^P:openssh/,/^$/ s/^V:10\.3_p1-r1$/V:10.3_p1-r2/' /lib/apk/db/installed

# HARDENING: replace npm's bundled undici 6.28.1 with 6.29.1.
RUN rm -rf /usr/lib/node_modules/npm/node_modules/undici
COPY --from=undici-fix /tmp/undici /usr/lib/node_modules/npm/node_modules/undici

# Community nodes built in the custom-nodes stage. Read-only and outside
# /home/node, so the data volume does not hide them.
COPY --from=custom-nodes /opt/n8n-custom-nodes /opt/n8n-custom-nodes

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
      org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
      org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
      org.opencontainers.image.url="https://n8n.io" \
      org.opencontainers.image.version=${N8N_VERSION}
