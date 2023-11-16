FROM node:21.1.0-alpine3.17
RUN apk update && apk upgrade --no-cache
RUN apk add openssl

WORKDIR /app

COPY package.json .
COPY package-lock.json .
COPY postinstall.js .
COPY app.js .
COPY index.js .
RUN npm install

RUN apk add --no-cache curl && \
    mkdir -p \
        /app/geonames_dump/admin1_codes \
        /app/geonames_dump/admin2_codes \
        /app/geonames_dump/all_countries \
        /app/geonames_dump/alternate_names \
        /app/geonames_dump/cities && \
    cd /app/geonames_dump && \
    curl -k -L -o admin1_codes/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt && \
    curl -k -L -o admin2_codes/admin2Codes.txt https://download.geonames.org/export/dump/admin2Codes.txt && \
    curl -k -L -o all_countries/allCountries.zip https://download.geonames.org/export/dump/allCountries.zip && \
    curl -k -L -o alternate_names/alternateNames.zip https://download.geonames.org/export/dump/alternateNames.zip && \
    curl -k -L -o cities/cities1000.zip https://download.geonames.org/export/dump/cities1000.zip && \
    cd all_countries && unzip allCountries.zip && rm allCountries.zip && cd .. && \
    cd cities && unzip cities1000.zip && rm cities1000.zip && cd .. && \
    cd alternate_names && unzip alternateNames.zip && rm alternateNames.zip

ENTRYPOINT ["npm"]
CMD ["start"]

EXPOSE 3000