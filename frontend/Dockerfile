FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
ENV HOSTNAME="0.0.0.0"
CMD ["pnpm", "run", "dev"]
