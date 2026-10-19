# Stage 1: install Node dependencies (also provides the Node binary)
FROM node:22-bookworm-slim AS node-deps
WORKDIR /srv
COPY package.json ./
RUN npm install --omit=dev

# Stage 2: Java 8 runtime (what the 2018-era ANAF jars expect) + Node
FROM eclipse-temurin:8-jre-jammy
ENV NODE_ENV=production
ENV LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*

# Node binary copied from the official Node image (needs glibc >= 2.28; jammy has 2.35)
COPY --from=node-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=node-deps /srv/node_modules /srv/node_modules

WORKDIR /srv
COPY package.json server.js ./
COPY public ./public
COPY app ./app

EXPOSE 3000
CMD ["node", "server.js"]
