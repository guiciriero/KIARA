# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Adicionado

- **Baixa latência (experimental, opcional):** botão "Baixa latência (exp.)" no player. Em vez do `<video>`, um worker recebe os quadros VP9 codificados (`RTCRtpScriptTransform`), decodifica com WebCodecs (`VideoDecoder`) e desenha num `OffscreenCanvas` com WebGL. Fica desligado por padrão, a escolha é salva no navegador, e ligar ou desligar refaz a entrada na sala. O áudio continua pelo `<video>` (só com as faixas de áudio). Em sala E2EE o mesmo worker decifra antes de decodificar; quadro que não autentica nunca é desenhado.
  - **Hoje só funciona em sala E2EE.** O host só envia VP9 em sala E2EE (forçado); em sala comum o modo automático escolhe H.265 ou H.264 e não há seletor de codec na interface, então o botão volta ao <video> na hora, com aviso. Fazer o espectador pedir VP9 exigiria estender o protocolo e faria o host codificar VP9 em software para ele (custo de CPU do apresentador por causa de um botão experimental); não foi feito.
  - **Só VP9.** Qualquer outro codec (H.264, H.265, AV1, VP8) volta sozinho ao `<video>`, assim como falta de WebGL, erros em série do decoder ou mais de 5 s sem keyframe. Navegador sem `VideoDecoder`, `OffscreenCanvas` ou `RTCRtpScriptTransform` nem mostra o botão.
  - **Sem keyframe sob demanda:** o transformer do Chrome 156 não tem `sendKeyFrameRequest`, então depois de um erro ou de uma fila atrasada o decoder só recomeça no próximo keyframe. No teste em loopback (6 s) houve 2 a 4 erros de decodificação por execução, nos primeiros segundos, quando o encoder sobe a resolução; somados, 11 a 27 quadros foram descartados esperando keyframe (menos de 1 s de imagem parada no total, a 30 FPS). Não identifiquei a causa; trocar o nível do VP9, desligar `optimizeForLatency` e forçar decoder em software não mudou isso. Não sei se acontece em rede e GPU reais.
  - **Perde recursos do `<video>`:** com o canvas ativo ficam indisponíveis o Picture-in-Picture nativo e a janela flutuante (a janela é fechada se estava aberta), porque ambos usam o `MediaStream`. Tela cheia e o enquadramento "preencher" (Z) funcionam. O espectador não grava, então a gravação não é afetada. O watchdog de tela preta passa a contar os quadros desenhados, já que o `<video>` não decodifica nada.
  - **O ganho de latência NÃO está demonstrado.** O painel mostra a média "chegada → desenho" medida no worker (cerca de 9 a 10 ms em loopback), mas esse número termina quando o quadro é enviado ao WebGL, sem composição nem vsync, e por isso não é comparável com o `receiveTime → presentationTime` do `<video>` (17 a 39 ms na mesma máquina). Além disso, o transformer entrega os quadros antes do jitter buffer do WebRTC: o canvas não tem esse amortecimento, o que pode reduzir a latência, mas também expõe a variação da rede (jitter) como engasgos. O loopback não tem jitter, então o efeito em rede real não foi medido.
  - **Validado no Chrome 156 (headless, SwiftShader, loopback, código real empacotado):** VP9 sem E2EE e com E2EE (mesma chave) desenharam cerca de 160 a 185 quadros em 6 s com o `<video>` com 0 quadros decodificados e áudio de pico 1; chave errada desenhou 0 quadros; H.264 caiu no fallback (`codec:video/H264`) e o `<video>` decodificou normalmente. Não validado: GPU real, Electron, rede real, o botão na interface, tela cheia e "preencher" em navegador, e qualquer outro navegador.
- **Criptografia de ponta a ponta opcional (E2EE, Insertable Streams):** ao criar a sala, o apresentador pode ligar "Cifra ponta a ponta" (exige senha). Cada quadro de vídeo e áudio é cifrado com AES-GCM num worker (`RTCRtpScriptTransform`) antes de sair do navegador e só é decifrado no espectador, então o servidor e o TURN só veem bytes cifrados. A senha de entrada **não** vai em claro ao servidor: o cliente deriva da senha (PBKDF2-SHA-256, 600 mil iterações, sal com o código da sala) duas chaves independentes por HKDF, uma chave de mídia AES-GCM não extraível, que nunca sai do navegador, e um "token de entrada" de 43 caracteres, que é o que vai no campo `password` e vira o hash scrypt do servidor. O servidor devolve `e2ee: true` em `room:created`, `room:resumed`, `room:joined` e no erro `password-required`, e o espectador só descobre que a sala é E2EE ao tentar entrar. O IV de 12 bytes é um prefixo aleatório de 6 bytes mais um contador de 48 bits. O co-apresentador também recebe a chave. Quadro que não autentica (chave errada, adulterado ou sem cifra) é descartado, nunca exibido.
  - **Só VP9 (ou VP8):** medido no Chrome 156, AV1 e H.264 falham ao cifrar o payload inteiro. Em sala E2EE o codec é forçado para VP9, e AV1, H.264, H.265 e o modo "auto" ficam desativados. Há custo extra de CPU e uns 28 bytes por quadro.
  - **Sem suporte, recusa:** navegador sem `RTCRtpScriptTransform` não cria nem entra em sala E2EE; o espectador mostra mensagem clara em vez de assistir sem cifra.
  - **Limites (honestos):** a E2EE só é tão forte quanto a senha. Quem tiver o token de entrada (por exemplo, o dono do servidor) pode tentar força bruta offline na senha, e com ela derivar a chave de mídia; use senha longa. Não há rotação de chave, e quem já tem a senha assiste. Metadados continuam visíveis ao servidor: quem entrou e saiu, o SDP, as estatísticas de `stream:stats` e o tamanho e a cadência dos quadros. Uma alternativa mais forte seria uma chave aleatória no fragmento do link (`#k=...`), que o servidor nunca recebe; não implementada.
  - **Validado no Chrome 156 (headless, loopback, código real empacotado, worker de arquivo sob CSP `worker-src 'self'`):** mesma chave decodifica 178 a 179 quadros VP9 com áudio de pico 1; chave errada, 0 quadros e áudio mudo; receptor sem transform, 0 quadros decodificados. Não validado: Electron, Firefox, Safari, vários espectadores reais e rede com perda.
- **SVC temporal e teto de FPS por espectador:** VP9 e AV1 usam `scalabilityMode` `L1T3` (3 camadas temporais); H.264 e H.265 ficam em `L1T1`. Não há camadas espaciais, de propósito, porque multiplicam o custo de codificação. Quem pede 480p ou menos recebe no máximo 30 FPS. No Chrome 156 em loopback, o VP9 foi de 58,7 para 29,7 FPS e o AV1 de 46 para 30 FPS, com saída 853x480.
- **Correção:** o laço de bitrate em `collectAggregatedStats` sobrescrevia `maxFramerate` a cada 2 s com o FPS global, desfazendo o teto por espectador.
- **Gráficos de histórico na telemetria (sparklines, últimos 30 s):** latência RTT, FPS real contra o nominal, bitrate de vídeo e perda de pacotes, com valor atual, mínimo e máximo, linha tracejada de referência (100 ms, FPS-alvo, 2% de perda) e descrição acessível. Aparecem no painel de telemetria do espectador e do host. O histórico fica na página, então não zera ao minimizar o painel. Cada ponto vem de uma amostra de `stream:stats` (a cada 2 s).
- **Janela flutuante com controles (Document Picture-in-Picture):** no Chrome e Edge, o botão e o atalho **P** abrem uma mini-janela com volume, mudo, tela cheia e estatísticas (FPS, resolução, bitrate, latência, perda e jitter). O áudio sai pela janela flutuante e o `<video>` da página fica mudo para não duplicar. Sem suporte à API, o Picture-in-Picture nativo continua como alternativa. Não validado em navegador real.
  - **App desktop (Electron) usa o PiP nativo:** no Electron 44.7.2 o `documentPictureInPicture.requestWindow` resolve, mas a janela é fechada em menos de 100 ms (`closed` vira `true`, com `pagehide`), mesmo sem o `setWindowOpenHandler` do app. O botão mostrava "Janela flutuante aberta" e o vídeo continuava preso ao app. Por isso a janela com controles fica desligada no Electron (detecção pelo user agent) e o botão abre o Picture-in-Picture nativo, que nesse teste abriu a janela de verdade. A causa do fechamento imediato não foi identificada. Testado num Electron 44.7.2 avulso, não no app empacotado.
- **Queda de conexão do apresentador:** a sala espera `HOST_GRACE_MS` (padrão 20 s) pela volta do host em vez de fechar na hora. O servidor emite `room:host-reconnecting` e `room:host-resumed`; o host retoma com `room:resume` usando o `hostToken` (guardado só em memória, só o hash fica no servidor), e o broadcaster refaz as ofertas com ICE restart. `room:leave` continua fechando a sala na hora.
- **Lista de espectadores com Expulsar e Banir** (`room:kick-viewer`, erros `kicked` e `banned`; o ban vale por IP até a sala fechar) e `room:viewer-renamed`.
- **QR code do link** (gerado localmente) e **gravação local** em `.webm` (`MediaRecorder`) no estúdio do host.
- **Economia de dados** para o espectador (480p, ligada por padrão em conexões lentas) e aviso **"Acordando o servidor…"** quando o servidor do Render está hibernando.
- `room:created` traz `codeChanged` quando o código fixo estava ocupado, e o painel avisa o host.
- `GET /metrics` (Prometheus) protegido por `METRICS_TOKEN`; sem a variável, responde 404.
- ESLint no servidor (`npm run lint`), também na CI, e job de compilação do módulo nativo no Windows em pull requests.
- **Experimental, não executado:** pacotes Linux (AppImage/deb) e macOS (dmg/zip) e os workflows `build-linux.yml` e `build-macos.yml`.
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

- `server/src/db` (`RoomStore`), que nunca foi usado, e o volume `kiara_data` do compose.
- **Chat de texto e reações com emoji:** a sala deixou de ter qualquer chat. Removidos o painel de chat, `ReactionBar`, `useReactions`, os eventos `chat:message`, `chat:reaction` e `room:update-features` e a opção "Permitir reações". Os campos `reactionsEnabled` e o tipo `ReactionEmoji` ainda existem em `shared/types`, `validators.ts` e `roomManager.ts`, sem uso pela interface.
- **Painel de vídeo simplificado:** saíram os presets 720p e 4K, o seletor de FPS (fixo em 60), o seletor de modo do encoder (fixo em `game`), o seletor de codec (fixo em automático) e a estimativa de upload na interface. Ficam 1080p 60 FPS (FHD), 1440p 60 FPS (2K) e o bitrate (1 a 20 Mbps).

### Segurança

- Semáforo de 4 operações scrypt simultâneas (hash e verificação de senha) para não esgotar o threadpool.
- O coturn do `docker-compose.yml` nega relay para redes privadas e loopback e tem cotas.
- Fontes (Inter e JetBrains Mono) hospedadas pelo próprio site; o CSP não permite mais o Google Fonts.
- `TURN_SECRET` passa a ser obrigatório via ambiente no `docker-compose.yml` (antes havia um segredo fixo no repositório).
- `body-parser` atualizado para 1.20.9 (GHSA-27r3-jxmh-p828).

### Corrigido

- `docker-compose.yml`: o TURN entregue aos navegadores era `127.0.0.1` (não funcionava fora da máquina do servidor) e o build usava o contexto errado. Agora exige `TURN_PUBLIC_HOST` e usa `context: ./server`; o site (`kiara-web`) entrou no compose.
- Service worker: só atualiza o cache de `index.html` com respostas HTML válidas das rotas `/` e `/view/*`.
- App desktop: depois de sair de uma sala aberta por link de outra pessoa (ou de um erro nessa página), a janela ficava no site remoto e todo IPC falhava com "Remetente IPC não autorizado", exigindo fechar e abrir o app. Agora a janela volta sozinha ao servidor local ao sair da rota `/view/CÓDIGO` e, se o endereço remoto não carregar, mostra um aviso e também volta à tela inicial.
- Espectador: às vezes a tela ficava preta ao entrar e só voltava saindo e entrando de novo. Agora o player confere se algum frame de vídeo foi decodificado; se em 12 s não chegou nenhum, refaz a entrada sozinho (até 2 vezes), sem anunciar decodificação por hardware para o host cair no H.264, que é mais compatível.
- App desktop (Windows): a live voltava para "pronto para iniciar" ao dar alt-tab. A captura nativa agora tolera até 5 quedas consecutivas (o contador zera após 5 s estável), reinicia também em `acquire-failed`, `unsupported-format` e falha ao reiniciar, e, se ainda assim cair, a transmissão troca sozinha para o `getDisplayMedia` sem derrubar a sala. O motivo da queda vai para o console (`[KIARA] Captura nativa encerrada (...)`).
- Falha ao trocar de tela durante a transmissão.
- Serrilhado no player de vídeo; permissão de tela cheia no app desktop.
- App desktop: removido `disable-frame-rate-limit`, que deixava o `requestAnimationFrame` da interface sem vsync (~5000 quadros por segundo).

### Alterado

- **Dependências major atualizadas:** React 19 (e `@types/react`/`@types/react-dom` 19), Vite 8 com `@vitejs/plugin-react` 6, ESLint 10 e Express 5 (o fallback SPA do servidor agora usa `/{*splat}`, com teste cobrindo `/` e `/view/CÓDIGO`). O Dependabot passou a ignorar só `typescript` (o `typescript-eslint` ainda exige TypeScript < 6.1), `@types/node` e `electron`.
- **Compartilhamento de tela direto:** quem assiste e clica em "Também transmitir" passa a transmitir na hora; a etapa de pedido e aprovação do host foi removida (eventos `room:request-copresent`, `room:respond-copresent` e `room:copresent-request` substituídos por `room:start-copresent` e `room:stop-copresent`). A vaga continua única e é liberada ao parar, sair ou desconectar.
- **Link fixo como único link:** o código da sala é gerado na primeira visita, guardado no `localStorage` e usado em toda transmissão. Removidos o botão "Novo código" e o painel de convite dinâmico (`InviteCode`).
- **Interface modernizada:** novos tokens de sombra e movimento, microinterações e transições em CSS, cartões da Home com halo frio, barra do player em vidro leve, bolhas de chat e painéis com entrada suave, mantendo a identidade preta do KIARA.
- **Atualização do app mais rápida:** o app desktop agora procura a versão nova sozinho (10 s depois de abrir e a cada 4 h) e já a baixa em segundo plano; resta só clicar em "Reiniciar e atualizar" (ou fechar o app, que instala sozinho). Sem internet, a verificação automática não mostra erro. No GitHub Actions, o instalador passou a compilar em paralelo com a CI (a release só sai se as duas passarem), o addon nativo fica em cache (~80 s a menos quando `native/` não muda) e os jobs E2E e Docker da CI rodam junto com a verificação.

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
