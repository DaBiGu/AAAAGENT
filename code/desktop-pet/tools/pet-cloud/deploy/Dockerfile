FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY companion/cloud ./companion/cloud
RUN npx --no-install tsc --target ES2022 --module NodeNext --strict --skipLibCheck --noUncheckedIndexedAccess --exactOptionalPropertyTypes --rootDir . --outDir dist companion/cloud/*.ts && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY tools/pet-cloud ./tools/pet-cloud
RUN mkdir -p /state && chown node:node /state
USER node
ENV PET_SOCIAL_HOST=0.0.0.0
EXPOSE 18766
ENTRYPOINT ["node", "tools/pet-cloud/cli.mjs"]
CMD ["serve", "/state"]
