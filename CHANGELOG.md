# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado

- Credenciais TURN efêmeras geradas pelo servidor (coturn HMAC via `TURN_URLS`/`TURN_SECRET`, ou Cloudflare Realtime TURN via `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN`).
- Senha e aprovação do anfitrião para entrar na sala.
- Limite de espectadores por sala (`MAX_VIEWERS_PER_ROOM`, padrão 8) e limites globais (`MAX_ROOMS`, `MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_IP`, `ROOM_MAX_HOURS`).
- Chat e reações durante a transmissão.
- Modo privacidade.
- PWA: manifesto e service worker.
- CI no GitHub Actions (lint, tipos, testes, build, `npm audit`, e2e em Chrome e build de imagens), CodeQL e Dependabot.
- Workflow do instalador Windows só roda após a CI passar, com smoke test do addon nativo e ações fixadas por SHA.
- `SECURITY.md`, `CONTRIBUTING.md`, templates de issue/PR, `.editorconfig` e configuração do Prettier para editores.
- Desktop: Electron Fuses aplicados via `afterPack`, verificação do SHA-256 do `cloudflared.exe` antes de executá-lo e validação dos hosts de redirecionamento no download.
- Estimativa de upload no estúdio, painel de pedidos de entrada, painel de chat com reações flutuantes, atalhos F/M no player, validação do código na página inicial e telas dedicadas para senha, aprovação, sala cheia e sala encerrada.
- Reconexão automática do espectador com backoff e teste de sinalização do servidor (senha, aprovação, limites, relay, chat, payloads malformados).
- Testes automatizados do servidor (Vitest) e do cliente, incluindo a lógica de atualização do desktop.

### Alterado

- Servidor e cliente exigem Node 22.
- Docker: Nginx escuta na porta 8080 (compose mapeia `127.0.0.1:3000:8080`), CSP mais restrita e proxy de `/socket.io` e `/download` para o servidor.
- `render.yaml` usa Node 22 e variáveis de TURN com `sync: false`.
- `KIARA_UPDATE_URL` só é aceita com https e, no app empacotado, apenas quando embutida no build.

### Removido

- Variáveis `VITE_TURN_*` do cliente: credenciais TURN não vão mais no bundle.

### Corrigido

- Falha (crash) do servidor de sinalização: `stream:config-update` sem payload derrubava o processo.
- Controle de bitrate: amostra intermediária decrementa em 1 a contagem de saudáveis (antes zerava).
- Acessibilidade: foco visível global, contrastes de texto e bordas de campos, alvos de toque de 44 px, zoom liberado no viewport.
- Instalação com `npm ci || npm install` nos workflows, que escondia lockfiles inconsistentes.

### Segurança

- Imagens de contêiner executadas como não-root, com `cap_drop`, `no-new-privileges` e sistema de arquivos somente leitura quando possível.
