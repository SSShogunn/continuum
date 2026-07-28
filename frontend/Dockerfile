FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
ENV HOSTNAME="0.0.0.0"
CMD ["pnpm", "run", "dev"]
