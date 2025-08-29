FROM node:22-alpine AS build

RUN apk update && apk add --no-cache curl && apk upgrade

ARG WORKDIR_BASE=/usr/src/app
ARG GEONAMES_DUMP_DIR=${WORKDIR_BASE}/geonames_dump
WORKDIR ${WORKDIR_BASE}

# Create directories
RUN mkdir -p \
  ${GEONAMES_DUMP_DIR}/admin1_codes \
  ${GEONAMES_DUMP_DIR}/admin2_codes \
  ${GEONAMES_DUMP_DIR}/all_countries \
  ${GEONAMES_DUMP_DIR}/alternate_names \
  ${GEONAMES_DUMP_DIR}/cities

# Download and process geonames data
RUN curl -L -o ${GEONAMES_DUMP_DIR}/admin1_codes/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt && \
  curl -L -o ${GEONAMES_DUMP_DIR}/admin2_codes/admin2Codes.txt https://download.geonames.org/export/dump/admin2Codes.txt && \
  curl -L -o ${GEONAMES_DUMP_DIR}/all_countries/allCountries.zip https://download.geonames.org/export/dump/allCountries.zip && \
  curl -L -o ${GEONAMES_DUMP_DIR}/alternate_names/alternateNames.zip https://download.geonames.org/export/dump/alternateNames.zip && \
  curl -L -o ${GEONAMES_DUMP_DIR}/cities/cities1000.zip https://download.geonames.org/export/dump/cities1000.zip && \
  unzip ${GEONAMES_DUMP_DIR}/all_countries/allCountries.zip -d ${GEONAMES_DUMP_DIR}/all_countries && \
  unzip ${GEONAMES_DUMP_DIR}/alternate_names/alternateNames.zip -d ${GEONAMES_DUMP_DIR}/alternate_names && \
  unzip ${GEONAMES_DUMP_DIR}/cities/cities1000.zip -d ${GEONAMES_DUMP_DIR}/cities && \
  rm ${GEONAMES_DUMP_DIR}/*/*.zip

COPY package.json package-lock.json postinstall.js app.js index.js ./
RUN npm install

FROM gcr.io/npav-172917/sto-ccc-cloud9/hardened_alpine:3.21-fips-2025.05.15 AS runner

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
ENTRYPOINT ["npm"]
CMD ["start"]
