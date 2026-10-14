# Etapa 1: build do cliente React (Node 22)
FROM registry.redhat.io/ubi9/nodejs-22-minimal:latest AS builder

USER 1001
WORKDIR /opt/app-root/src/app
COPY --chown=1001:0 package*.json ./
RUN npm ci

COPY --chown=1001:0 . .
RUN npm run build

# Etapa 2: Nginx (UBI 9), sem root, escutando na porta 8080
FROM registry.redhat.io/ubi9/nginx-126:latest

COPY --from=builder /opt/app-root/src/app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

USER 1001
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
