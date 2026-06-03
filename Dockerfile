FROM gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine:3.23 AS build

RUN apk update && apk add --no-cache curl nodejs npm && apk upgrade

ARG WORKDIR_BASE=/usr/src/app
ARG GEONAMES_DUMP_DIR=${WORKDIR_BASE}/geonames_dump
WORKDIR ${WORKDIR_BASE}

COPY package.json ./
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack && corepack enable && corepack install

# Create directories
RUN mkdir -p \
  ${GEONAMES_DUMP_DIR}/admin1_codes \
  ${GEONAMES_DUMP_DIR}/admin2_codes \
  ${GEONAMES_DUMP_DIR}/all_countries \
  ${GEONAMES_DUMP_DIR}/alternate_names \
  ${GEONAMES_DUMP_DIR}/cities1000

# Download and process geonames data
RUN curl -L -o ${GEONAMES_DUMP_DIR}/admin1_codes/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt && \
  curl -L -o ${GEONAMES_DUMP_DIR}/admin2_codes/admin2Codes.txt https://download.geonames.org/export/dump/admin2Codes.txt && \
  curl -L -o ${GEONAMES_DUMP_DIR}/all_countries/allCountries.zip https://download.geonames.org/export/dump/allCountries.zip && \
  curl -L -o ${GEONAMES_DUMP_DIR}/alternate_names/alternateNames.zip https://download.geonames.org/export/dump/alternateNames.zip && \
  curl -L -o ${GEONAMES_DUMP_DIR}/cities1000/cities1000.zip https://download.geonames.org/export/dump/cities1000.zip && \
  unzip ${GEONAMES_DUMP_DIR}/all_countries/allCountries.zip -d ${GEONAMES_DUMP_DIR}/all_countries && \
  unzip ${GEONAMES_DUMP_DIR}/alternate_names/alternateNames.zip -d ${GEONAMES_DUMP_DIR}/alternate_names && \
  unzip ${GEONAMES_DUMP_DIR}/cities1000/cities1000.zip -d ${GEONAMES_DUMP_DIR}/cities1000 && \
  rm ${GEONAMES_DUMP_DIR}/*/*.zip

COPY pnpm-lock.yaml pnpm-workspace.yaml postinstall.js app.js index.js ./
RUN pnpm install --frozen-lockfile

# Guard: the deprecated `request` library must never be (re)installed.
RUN if [ -e node_modules/request/package.json ]; then \
      echo 'ERROR: forbidden dependency "request" is present in node_modules' >&2; \
      exit 1; \
    fi

FROM gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine:3.23 AS runner

WORKDIR /usr/src/app

RUN addgroup -S node && \
  adduser -S node -G node && \
  chown -R node:node /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/geonames_dump ./geonames_dump
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
