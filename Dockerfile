FROM node:22-alpine
WORKDIR /app

# Install Chromium and required system dependencies for Puppeteer on Alpine Linux
# Required for delegate purchasing items PDF export (Puppeteer rendering engine)
RUN apk update && apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-arabic \
    dbus \
    eudev

# Tell puppeteer-core where to find Chromium on Alpine Linux
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install pnpm
RUN npm install -g pnpm@10.15.1

# Copy package.json only (no lockfile, no patches)
COPY package.json ./

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
