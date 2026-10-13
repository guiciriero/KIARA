# Dockerfile do servidor de sinalização
FROM registry.redhat.io/ubi9/nodejs-20-minimal:latest

WORKDIR /app

# Copia manifesto de dependências
COPY package*.json ./
RUN npm ci --only=production

# Copia código compilado (execute 'npm run build' antes de fazer docker build)
COPY dist ./dist

# Usuário não-root (id 1001 já existe na imagem UBI)
USER 1001

EXPOSE 3001
CMD ["node", "dist/index.js"]
