FROM node:22-alpine
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.15.1

# Copy package.json only (no lockfile)
COPY package.json ./
COPY patches ./patches

# Install ALL dependencies (dev needed for build step)
RUN pnpm install --no-frozen-lockfile

# Copy source files
COPY . .

# Build frontend (vite) + server (esbuild --packages=external) using project build script
RUN pnpm build

# Remove dev dependencies after build
RUN pnpm prune --prod

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "dist/index.js"]
