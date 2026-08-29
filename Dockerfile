## runtime : tag: "gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine:3.23" ##
FROM gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine@sha256:f21c908cc6786b533c7bf2a6af9589243ccbe9e355a56c76e872c64a4ae3d2d8 AS build

RUN apk update && apk add --no-cache curl nodejs npm && apk upgrade

ARG WORKDIR_BASE=/usr/src/app
ARG GEONAMES_DUMP_DIR=${WORKDIR_BASE}/geonames_dump
WORKDIR ${WORKDIR_BASE}

COPY package.json ./
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Corepack bootstrap.
#
# Pinned to an exact version (0.34.7, published 2026-04-17) and verified against
# a repository-owned SHA-512 before it is installed. Newer releases exist, but a
# bump should respect the 48h cooling-off period this project applies to pnpm
# packages via `minimumReleaseAge` in pnpm-workspace.yaml.
#
# --ignore-scripts matters: without it, npm executes package lifecycle scripts
# as root during this step, which is the execution primitive LOCREVGE-0002
# demonstrated. Corepack does not need any.
#
# Caveat on the digest: npm is both the artifact source and the digest source,
# so unlike an Apache-style out-of-band checksum this is trust-on-first-use. It
# guarantees reproducibility and detects later tampering or unpublish/republish;
# it does not defend against a registry compromised at the time it was recorded.
# The pnpm hop is covered separately by the +sha512 suffix on `packageManager`.
# The version and digest are shell locals, not ARGs: an ARG can be relaxed with
# --build-arg at build time, which is not a pin.
#
# The digest is compared explicitly rather than via `sha512sum -c`. This base is
# Alpine, so sha512sum is BusyBox, which does not support GNU's --strict. An
# explicit string comparison is unambiguous on both BusyBox and coreutils and
# cannot be satisfied by an empty or malformed expected value.
RUN COREPACK_VERSION=0.34.7 && \
    COREPACK_SHA512=77938bb93361e337892bcfaef86d7429272aae71ca34d9ba36f4785cedbc159c8114c184eb448d0ab05eb492f2291f47d711821ba5362f2b30b323cd74eea4c7 && \
    curl -fsSL --proto '=https' --tlsv1.2 -o /tmp/corepack.tgz \
      "https://registry.npmjs.org/corepack/-/corepack-${COREPACK_VERSION}.tgz" && \
    ACTUAL_SHA512="$(sha512sum /tmp/corepack.tgz | cut -d' ' -f1)" && \
    if [ -z "$COREPACK_SHA512" ] || [ "$ACTUAL_SHA512" != "$COREPACK_SHA512" ]; then \
      echo "ERROR: corepack tarball digest mismatch" >&2; \
      echo "  expected: $COREPACK_SHA512" >&2; \
      echo "  actual:   $ACTUAL_SHA512" >&2; \
      exit 1; \
    fi && \
    npm install -g --ignore-scripts /tmp/corepack.tgz && \
    rm /tmp/corepack.tgz && \
    corepack enable && \
    corepack install

# Create directories
RUN mkdir -p \
  ${GEONAMES_DUMP_DIR}/admin1_codes \
  ${GEONAMES_DUMP_DIR}/cities1000

# Download geonames data (only admin1 codes and cities - minimal set for actual usage)
RUN curl -L -o ${GEONAMES_DUMP_DIR}/admin1_codes/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt && \
  curl -L -o ${GEONAMES_DUMP_DIR}/cities1000/cities1000.zip https://download.geonames.org/export/dump/cities1000.zip && \
  unzip ${GEONAMES_DUMP_DIR}/cities1000/cities1000.zip -d ${GEONAMES_DUMP_DIR}/cities1000 && \
  rm ${GEONAMES_DUMP_DIR}/*/*.zip

COPY pnpm-lock.yaml pnpm-workspace.yaml app.js index.js prebake.js ./
RUN pnpm install --frozen-lockfile

# Pre-bake geocoder data (build k-d tree and serialize with V8)
RUN node --max-old-space-size=4096 prebake.js

# Guard: the deprecated `request` library must never be (re)installed.
RUN if [ -e node_modules/request/package.json ]; then \
      echo 'ERROR: forbidden dependency "request" is present in node_modules' >&2; \
      exit 1; \
    fi

## runtime : tag: "gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine:3.23" ##
FROM gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine@sha256:f21c908cc6786b533c7bf2a6af9589243ccbe9e355a56c76e872c64a4ae3d2d8 AS runner

WORKDIR /usr/src/app

RUN addgroup -S node && \
  adduser -S node -G node && \
  chown -R node:node /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/geonames_dump/prebaked.v8 ./geonames_dump/prebaked.v8
COPY --from=build --chown=node:node /usr/src/app/package.json ./package.json
COPY --from=build --chown=node:node /usr/src/app/app.js ./app.js
COPY --from=build --chown=node:node /usr/src/app/index.js ./index.js

RUN apk update && \
  apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/v3.21/main nodejs npm && \
  apk add --no-cache dumb-init && \
  apk add --no-cache openssl --repository=http://dl-cdn.alpinelinux.org/alpine/latest-stable/main && \
  apk upgrade && \
  echo "Node.js: $(node --version)" && \
  echo "Npm: $(npm --version)" && \
  echo "OpenSSL: $(openssl version)" && \
  rm -rf /var/cache/apk/*

# run as non-root user
USER node
EXPOSE 3000
ENTRYPOINT ["node", "--max-old-space-size=4096"]
CMD ["app.js"]
