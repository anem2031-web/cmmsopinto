FROM node:22-alpine
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.15.1

# Copy package.json فقط
COPY package.json ./

# تثبيت بدون lockfile
RUN pnpm install

# نسخ باقي المشروع
COPY . .

# بناء المشروع
RUN pnpm build

# حذف dev dependencies
RUN pnpm prune --prod

# فتح البورت
EXPOSE 8080

# تشغيل السيرفر
CMD ["node", "dist/index.js"]
