# Debian-based image for reliable multi-arch on WSL2/Docker Desktop.
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Layer 1: deps only — cached when package.json / package-lock.json unchanged
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install

# Layer 2: source — only this layer rebuilds on code changes
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-bookworm
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
