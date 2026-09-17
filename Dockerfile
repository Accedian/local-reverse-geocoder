# Image layer for building the application
# If the Node.js version changes, re-mirror the image before updating this digest.
## builder : tag: "us-docker.pkg.dev/npav-172917/docker-mirrors/node:24.18.0-alpine3.24" ##
FROM us-docker.pkg.dev/npav-172917/docker-mirrors/node@sha256:e94306bf71a92565cc216b3ce3f1071aefad0c305d0e54e11537b66452225e43 AS build

RUN apk add --no-cache curl unzip

ARG WORKDIR_BASE=/usr/src/app
ARG GEONAMES_DUMP_DIR=${WORKDIR_BASE}/geonames_dump
WORKDIR ${WORKDIR_BASE}

COPY package.json ./
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Install Corepack from an exact tarball and verify it before executing it.
# The digest is kept here rather than in an ARG so --build-arg cannot relax the
# pin. npm is only used to install the already-verified local tarball, and
# lifecycle scripts are disabled because Corepack does not need them.
RUN COREPACK_VERSION=0.34.7 && \
    COREPACK_SHA512=77938bb93361e337892bcfaef86d7429272aae71ca34d9ba36f4785cedbc159c8114c184eb448d0ab05eb492f2291f47d711821ba5362f2b30b323cd74eea4c7 && \
    curl -fsSL --proto '=https' --tlsv1.2 \
      -o /tmp/corepack.tgz \
      "https://registry.npmjs.org/corepack/-/corepack-${COREPACK_VERSION}.tgz" && \
    ACTUAL_SHA512="$(sha512sum /tmp/corepack.tgz | awk '{print $1}')" && \
    test "$ACTUAL_SHA512" = "$COREPACK_SHA512" && \
    npm install -g --ignore-scripts /tmp/corepack.tgz && \
    rm /tmp/corepack.tgz && \
    corepack enable && \
    corepack install

# Corepack has already hydrated the hashed pnpm version. Do not allow it to
# resolve another package-manager artifact later in the build.
ENV COREPACK_ENABLE_NETWORK=0

# Create directories
RUN mkdir -p \
  ${GEONAMES_DUMP_DIR}/admin1_codes \
  ${GEONAMES_DUMP_DIR}/cities1000

# Download geonames data (only admin1 codes and cities - minimal set for actual usage)
RUN curl -L -o ${GEONAMES_DUMP_DIR}/admin1_codes/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt && \
  curl -L -o ${GEONAMES_DUMP_DIR}/cities1000/cities1000.zip https://download.geonames.org/export/dump/cities1000.zip && \
  unzip ${GEONAMES_DUMP_DIR}/cities1000/cities1000.zip -d ${GEONAMES_DUMP_DIR}/cities1000 && \
  rm ${GEONAMES_DUMP_DIR}/*/*.zip

COPY pnpm-lock.yaml pnpm-workspace.yaml app.ts index.js index.d.ts prebake.js tsconfig.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm run build:app

# Pre-bake geocoder data (build k-d tree and serialize with V8)
RUN node --max-old-space-size=4096 prebake.js

# Guard: the deprecated `request` library must never be (re)installed.
RUN if [ -e node_modules/request/package.json ]; then \
      echo 'ERROR: forbidden dependency "request" is present in node_modules' >&2; \
      exit 1; \
    fi

# Image layer for running the application
## runtime : tag: "gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine:3.24-fips-2026.08.15" ##
FROM gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine:3.24-fips-2026.08.15@sha256:448c800d57cb65497239ae8359bc003449bed0179d3617af22ea57f37296c741 AS runner

WORKDIR /usr/src/app

RUN addgroup -S node && \
  adduser -S node -G node && \
  chown -R node:node /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/geonames_dump/prebaked.v8 ./dist/geonames_dump/prebaked.v8
COPY --from=build --chown=node:node /usr/src/app/package.json ./package.json
COPY --from=build --chown=node:node /usr/src/app/dist/app.js ./dist/app.js
COPY --from=build --chown=node:node /usr/src/app/dist/index.js ./dist/index.js

RUN apk update && \
  apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/v3.24/main 'nodejs~24' npm && \
  apk add --no-cache dumb-init && \
  apk add --no-cache openssl --repository=https://dl-cdn.alpinelinux.org/alpine/latest-stable/main && \
  apk upgrade && \
  echo "Node.js: $(node --version)" && \
  echo "Npm: $(npm --version)" && \
  echo "OpenSSL: $(openssl version)" && \
  rm -rf /var/cache/apk/*

# run as non-root user
USER node
EXPOSE 3000
ENTRYPOINT ["node", "--max-old-space-size=4096"]
CMD ["dist/app.js"]
