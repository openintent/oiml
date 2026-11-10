# Built by OSL once; yours to change. Two stages: build with every dependency, run the built app.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3111
COPY --from=build /app ./
USER node
EXPOSE 3111
CMD ["node_modules/.bin/tsx","src/server/main.ts"]
