# Etapa 1: Build do cliente React
FROM registry.redhat.io/ubi9/nodejs-20-minimal:latest AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Etapa 2: Servir via Nginx minimal
FROM registry.redhat.io/ubi9/nginx-120:latest

COPY --from=builder /app/dist /usr/share/nginx/html

# Configuração Nginx para SPA (react-router-dom)
COPY nginx.conf /etc/nginx/nginx.conf

USER 1001
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
