FROM node:22-slim AS builder

WORKDIR /app

# Copy what a locked workspace install needs
COPY package.json package-lock.json ./
COPY packages/types/package.json packages/types/
COPY packages/client-ts/package.json packages/client-ts/
COPY packages/server/package.json packages/server/
COPY packages/server/tsconfig.json packages/server/
COPY packages/server/src/ packages/server/src/

# Install, build, then drop what only the build needs
RUN npm ci --workspace=@advicenxt/sbp-server
RUN npm run build --workspace=@advicenxt/sbp-server
RUN npm prune --omit=dev --workspace=@advicenxt/sbp-server

# --- Production stage ---
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/packages/server/dist/ ./dist/
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/node_modules/ ./node_modules/

EXPOSE 3000

ENV NODE_ENV=production

# Use --host 0.0.0.0 to accept external connections in Docker
CMD ["node", "dist/cli.js", "--host", "0.0.0.0"]
