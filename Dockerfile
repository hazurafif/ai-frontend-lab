FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine AS serve
# Substitute the placeholder in nginx.conf before starting. A static
# proxy_pass keeps startup resolution via /etc/hosts (Docker Desktop or the
# compose extra_hosts host-gateway entry make host.docker.internal resolvable).
ENV BACKEND_URL="http://host.docker.internal:8000"
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["/bin/sh", "-c", "sed -i \"s|__BACKEND_URL__|${BACKEND_URL}|\" /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
