# API and worker image (TypeScript run with tsx; packages are consumed as source).
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@cuntas/api", "start"]
