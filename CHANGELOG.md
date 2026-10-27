# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado

- **Estúdio do host no padrão do player do espectador:** o palco agora tem player principal, miniplayer flutuante (PiP) e a mesma barra de controles em vidro do espectador. Quando um co-apresentador transmite, a tela dele ocupa o player principal e o retorno local do host vira miniplayer; sem co-apresentador, o retorno do host ocupa o palco inteiro.
- **Ocultar/Exibir Configurações:** botão no topo recolhe os painéis laterais com transição suave e dá todo o espaço ao vídeo. Com os painéis ocultos continuam à mão, na barra do palco: pausar/retomar, encerrar, copiar link, retorno de tela, trocar tela, som do co-apresentador, reações, telemetria e tela cheia (atalho `F`). Antes de transmitir, o botão "Iniciar Transmissão" aparece no próprio palco.
- **Miniplayer ajustável:** com um co-apresentador no ar, o host pode aumentar ou diminuir o miniplayer da própria tela (botões − e + sobre ele, de 160 a 480 px) e ocultá-lo para ver só a tela da outra pessoa. O botão de miniplayer na barra do palco traz de volta. Tamanho e visibilidade ficam salvos no navegador.
- **Ocultar/Exibir Configurações no site do espectador:** o painel "Também transmitir" ganhou o mesmo botão do app, no topo do player, e desliza para fora com transição suave sem interromper a transmissão em andamento.
- O host passa a receber a tela do co-apresentador (`CopresenterReceiver` / `useCopresenterStream`), reaproveitando o `WebRTCViewer`.
- **Captura nativa de tela no app para Windows:** DXGI com textura compartilhada na GPU (sem cópia pela CPU), entregue ao WebRTC como `VideoFrame`, com cursor, seleção do monitor, recuperação de `ACCESS_LOST` e queda automática para `getDisplayMedia` em caso de falha (monitor girado, HDR, janela). Interruptor: `localStorage['kiara:nativeCapture']='0'`. Medida só com o Electron avulso; falta validar no app empacotado.
- **Codec automático por espectador:** H.265 quando o apresentador codifica e o espectador decodifica por hardware, senão H.264.
- Auditoria de streaming com benchmarks reproduzíveis (`docs/AUDITORIA-STREAMING.md`, `npm run bench` em `client/`), `PERFORMANCE.md` e overlay de telemetria estendido.
- Avisos de licenças de terceiros (`THIRD-PARTY-NOTICES.md`).

### Removido

- **Chat de texto e reações com emoji:** a sala deixou de ter qualquer chat. Removidos o painel de chat, `ReactionBar`, `useReactions`, os eventos `chat:message`, `chat:reaction` e `room:update-features` e a opção "Permitir reações". Os campos `reactionsEnabled` e o tipo `ReactionEmoji` ainda existem em `shared/types`, `validators.ts` e `roomManager.ts`, sem uso pela interface.
- **Painel de vídeo simplificado:** saíram os presets 720p e 4K, o seletor de FPS (fixo em 60), o seletor de modo do encoder (fixo em `game`), o seletor de codec (fixo em automático) e a estimativa de upload na interface. Ficam 1080p 60 FPS (FHD), 1440p 60 FPS (2K) e o bitrate (1 a 20 Mbps).

### Segurança

- `TURN_SECRET` passa a ser obrigatório via ambiente no `docker-compose.yml` (antes havia um segredo fixo no repositório).
- `body-parser` atualizado para 1.20.9 (GHSA-27r3-jxmh-p828).

### Corrigido

- App desktop: depois de sair de uma sala aberta por link de outra pessoa (ou de um erro nessa página), a janela ficava no site remoto e todo IPC falhava com "Remetente IPC não autorizado", exigindo fechar e abrir o app. Agora a janela volta sozinha ao servidor local ao sair da rota `/view/CÓDIGO` e, se o endereço remoto não carregar, mostra um aviso e também volta à tela inicial.
- Falha ao trocar de tela durante a transmissão.
- Serrilhado no player de vídeo; permissão de tela cheia no app desktop.
- App desktop: removido `disable-frame-rate-limit`, que deixava o `requestAnimationFrame` da interface sem vsync (~5000 quadros por segundo).

### Alterado

- **Compartilhamento de tela direto:** quem assiste e clica em "Também transmitir" passa a transmitir na hora; a etapa de pedido e aprovação do host foi removida (eventos `room:request-copresent`, `room:respond-copresent` e `room:copresent-request` substituídos por `room:start-copresent` e `room:stop-copresent`). A vaga continua única e é liberada ao parar, sair ou desconectar.
- **Link fixo como único link:** o código da sala é gerado na primeira visita, guardado no `localStorage` e usado em toda transmissão. Removidos o botão "Novo código" e o painel de convite dinâmico (`InviteCode`).
- **Interface modernizada:** novos tokens de sombra e movimento, microinterações e transições em CSS, cartões da Home com halo frio, barra do player em vidro leve, bolhas de chat e painéis com entrada suave, mantendo a identidade preta do KIARA.

## [1.1.0] — 2026-10-21

### Adicionado

- **Sala permanente com link fixo:** o código da sala é salvo no `localStorage` do host e reutilizado automaticamente entre sessões e reinicializações do servidor. O link já aparece no painel antes de iniciar a transmissão e pode ser compartilhado com antecedência — os espectadores veem uma tela de espera até o host iniciar.
- **Sala de co-apresentação:** o segundo participante pode pedir permissão para também transmitir a tela dentro da mesma sala, usando o mesmo link. O host aprova ou recusa pelo painel. Ambos têm acesso completo às configurações de qualidade, codec, fontes de áudio e seleção de tela/janela.
- **Redesenho do estúdio do host:** novo layout em três colunas — painel esquerdo de acesso à sala (link, status ao vivo, configurações da sala, pedidos), área central de preview, painel direito de configurações de transmissão (resolução, FPS, bitrate, codec, áudio). Todos os controles acessíveis sem trocar de página.

### Melhorado

- **Qualidade no macOS:** `resizeMode: 'crop-and-scale'` em telas Retina evita capturar em resolução 2× desnecessária; `degradationPreference: 'balanced'` em qualidade alta/ultra evita drop de frames; H.264 Main profile priorizado antes de High no macOS para melhor suporte a hardware encode (VideoToolbox); `contentHint: 'detail'` em qualidade alta/ultra para transmissão de texto e código; piso de bitrate adaptativo reduzido para 400 kbps em redes com >10% de perda de pacotes.
- Log de diagnóstico de captura em modo de desenvolvimento (`[KIARA capture]` no console) com resolução real obtida, `devicePixelRatio`, `contentHint` e `frameRate`.

### Adicionado (anterior)

---

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

### Segurança

- Servidor: limite de tentativas de senha por sala e de falhas de entrada por IP (reconectar não zera mais o contador); limite geral de eventos por socket; `room:create` concorrente não cria salas órfãs; sem sala/espectador fantasma quando o socket cai durante o hash da senha; `socketNicknames` deixa de vazar memória.
- Servidor: `stream:config-update`, `stream:stats` e `offer.config` são validados e reconstruídos (campos conhecidos, enums e faixas) antes de serem retransmitidos; apelidos e chat sem caracteres bidi/invisíveis e sem personificar o "Apresentador".
- Servidor: o código da sala (segredo de convite) não é mais gravado nos logs; `/health` sem `uptime`; CORS sem `credentials`; `Permissions-Policy` e `form-action 'self'`; origem de desenvolvimento `localhost:3000` só fora de produção.
- Nginx: cabeçalhos de segurança repetidos em cada `location` (o `add_header` aninhado anulava os herdados), `frame-ancestors 'none'`, `Permissions-Policy`, limite de taxa, tamanho de corpo e timeouts.
- CI: `secrets: inherit` substituído por repasse explícito; `cloudflared` fixado por versão e SHA-256 (o `prepare:resources` exige SHA-256 em CI); `CODEOWNERS` e `.gitignore`/`.dockerignore` ampliados.
- Desktop: app empacotado ignora `KIARA_UPDATE_URL` do ambiente (usa só a URL embutida no build); `electron-builder.yml` aponta para o repositório correto.
- Dependências: `ts-node-dev` substituído por `tsx` (remove `braces` vulnerável); `dotenv` 18, `vitest` 5/4, `puppeteer-core` 25, `electron` 44.7 e `electron-builder` 26.17.

### Alterado

- Experiência mobile: tela cheia no celular (API padrão, prefixo webkit e player nativo do iPhone, com travamento em paisagem quando permitido), tela que fica acesa durante a transmissão, toque no vídeo mostra/esconde os controles, altura dinâmica (`dvh`) e áreas seguras do iPhone, barra do player compacta, reações dentro do chat em telas estreitas, estúdio em coluna única com a prévia no topo, campos com 16 px (sem zoom automático do iOS) e alvos de toque de 44 px.
- Celulares não conseguem transmitir pelo navegador (não existe `getDisplayMedia`): a página do apresentador explica e desabilita o botão em vez de falhar.
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
