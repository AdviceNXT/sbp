FROM node:20-slim AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json* ./

# Copy server package
COPY packages/server/package.json packages/server/
COPY packages/server/tsconfig.json packages/server/
COPY packages/server/src/ packages/server/src/

# Install and build
RUN cd packages/server && npm install && npm run build

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/packages/server/dist/ ./dist/
COPY --from=builder /app/packages/server/package.json ./
COPY --from=builder /app/packages/server/node_modules/ ./node_modules/

EXPOSE 3000

ENV NODE_ENV=production

# Use --host 0.0.0.0 to accept external connections in Docker
CMD ["node", "dist/cli.js", "--host", "0.0.0.0"]
