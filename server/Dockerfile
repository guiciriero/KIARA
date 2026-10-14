# Dockerfile do servidor de sinalização
FROM registry.redhat.io/ubi9/nodejs-22-minimal:latest

WORKDIR /app

# Copia manifesto de dependências e instala só as de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia código compilado (execute 'npm run build' antes de fazer docker build)
COPY dist ./dist

ENV NODE_ENV=production
# O servidor escuta em 127.0.0.1 por padrão. Para ser alcançado por outros contêineres,
# defina HOST=0.0.0.0 explicitamente (o docker-compose.yml já faz isso).

# Usuário não-root (id 1001 já existe na imagem UBI)
USER 1001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
