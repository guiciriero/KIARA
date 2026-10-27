# KIARA

Compartilhe sua tela e o som do computador com quem você quiser, direto do navegador ou do app para Windows. Quem assiste só precisa abrir um link.

O site está no ar em https://kiara-a15m.onrender.com. Na hospedagem grátis ele hiberna quando fica sem uso, então a primeira visita pode demorar cerca de 1 minuto para abrir.

O KIARA transmite a tela ligando você e os espectadores de forma direta (WebRTC). As opções de qualidade são 1080p 60 FPS (FHD) e 1440p 60 FPS (2K), com bitrate de 1 a 20 Mbps (padrão 8 Mbps). O que foi medido até agora está em [docs/AUDITORIA-STREAMING.md](docs/AUDITORIA-STREAMING.md): a captura de tela do Chromium (navegador) entregou só 31 a 43 FPS reais com conteúdo animado, e por isso o app para Windows captura a tela com um módulo nativo (DXGI, sem cópia pela CPU), que chegou a 60 FPS em testes com o Electron avulso. Essas medições são de loopback, na mesma máquina; não valem como garantia para a sua rede. No app desktop dá para escolher de quais programas o som sai, por exemplo o vídeo sim e o jogo não.

---

## Para quem só quer usar

### Instalar no Windows

1. Baixe o instalador. O jeito mais fácil é abrir o [site do KIARA](https://kiara-a15m.onrender.com) e clicar em **Baixar KIARA para Windows**, no canto de cima: ele sempre entrega a versão mais recente. Se preferir, pegue o `KIARA-Setup-<versão>.exe` na página de [Releases](../../releases/latest).
2. Dê dois cliques no arquivo. O instalador deixa você escolher a pasta e não pede senha de administrador.
3. Abra o KIARA pelo atalho na Área de Trabalho e clique em **Iniciar Transmissão**.
4. Copie o link que aparece e mande para quem vai assistir (no WhatsApp, por exemplo). A pessoa abre no navegador, sem instalar nada.

**Sobre o aviso do Windows.** Na primeira vez, o Windows pode mostrar "O Windows protegeu seu computador". Isso acontece com qualquer programa novo ou pouco baixado, e não quer dizer que o arquivo tenha algo errado. Para continuar, clique em **Mais informações** e depois em **Executar assim mesmo**. Se quiser se certificar de que o arquivo é o original, veja [como conferir o instalador](#conferir-que-o-instalador-é-o-original).

### Assistir uma transmissão

1. Abra o link que a pessoa mandou.
2. Clique em **Ativar Som da Transmissão** para ouvir o áudio (os navegadores bloqueiam o som até você clicar).
3. Se a sala tiver senha, digite-a (e, se quiser, um apelido). Se exigir aprovação, aguarde o apresentador aceitar.
4. Atalhos: **F** tela cheia, **M** mutar, **P** janela flutuante (PiP), **S** (ou **C**) ocultar/exibir o painel, **Z** preencher a tela ou manter a proporção. No player há também a **Qualidade** (Auto, 1080p, 720p, 480p, 360p), só para você.
5. Para sair, clique em **Sair**.

Se preferir, abra a página inicial no navegador, digite o código de 6 caracteres (ou cole o link) e clique em **Entrar**. No app instalado, cole o link completo.

### Dicas

- O app precisa ficar aberto no computador de quem transmite.
- O link é fixo: o código da sua sala fica salvo neste computador e é o mesmo em toda transmissão, então dá para compartilhá-lo antes de iniciar (quem abrir vê uma tela de espera). Quando você encerra, a sala fecha (e toda sala expira sozinha após 12 horas).
- Quem assiste pode clicar em **Também transmitir** e compartilhar a própria tela na mesma sala, na hora, sem pedir permissão a ninguém (só uma pessoa por vez, além de você).
- Quem tiver o link e o código consegue assistir, a menos que você proteja a sala. Antes de iniciar, em **Acesso à sala**, dá para definir uma **senha** (4 a 64 caracteres) e marcar **Aprovar cada entrada**: cada pessoa aparece na tela como pedido e você clica em Aprovar ou Negar.
- O **Modo privacidade** esconde seu IP dos espectadores, fazendo o vídeo passar por um servidor de retransmissão (TURN). Só funciona se o servidor tiver TURN configurado; depois de iniciar, a sala mostra se ele foi ativado de fato.
- No celular dá para **assistir** (com tela cheia e tela sempre acesa), mas **não transmitir**: os navegadores de Android e iPhone não permitem compartilhar a tela. Para transmitir, use um computador ou o app para Windows.
- Cada espectador recebe uma cópia do vídeo, então seu upload precisa dar conta (bitrate × espectadores). Com o padrão de 8 Mbps, três espectadores já pedem cerca de 24 Mbps de upload; reserve uma folga de uns 50 % (veja [`PERFORMANCE.md`](PERFORMANCE.md)). O limite padrão é de 8 espectadores por sala.
- O botão de baixar o app só aparece no site. Dentro do app instalado você usa o **Atualizar**.
- No macOS, libere **Gravação de Tela e Áudio do Sistema** em Ajustes do Sistema, Privacidade e Segurança, e reabra o app.

---

## Conferir que o instalador é o original

Cada release publicada mostra o SHA-256 do instalador na descrição. Para comparar, rode no PowerShell, na pasta onde você baixou:

```powershell
Get-FileHash .\KIARA-Setup-<versão>.exe
```

Se o valor for igual ao da página da release, o arquivo é o mesmo que foi gerado pelo GitHub a partir do código deste repositório. O instalador é montado automaticamente pelo GitHub Actions, e você pode ler o passo a passo em [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml).

---

## Para quem quer rodar o código

### O que você precisa

- Node.js 22 ou mais novo (o Node 20 chegou ao fim do suporte), com npm 10 ou mais novo
- Git

### Um comando só

```bash
npm run share
```

Na primeira vez ele instala as dependências, compila o site, sobe o servidor e cria um link público pela Cloudflare (grátis, sem conta). Esse jeito depende do seu computador ficar ligado; se você quer um endereço que fique sempre no ar, veja [Hospedagem fixa no Render](#hospedagem-fixa-no-render-grátis-sem-depender-do-seu-pc). Para usar o `npm run share` você precisa do `cloudflared`:

- macOS: `brew install cloudflared`
- Windows: `winget install --id Cloudflare.cloudflared` (reabra o terminal depois)
- Linux: veja a [documentação oficial](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

Para abrir o app desktop, com som por aplicativo, use `npm run share:desktop`.

Se o vídeo não conectar em redes muito restritas (empresas, alguns planos 4G), será preciso um servidor TURN. Veja [Variáveis de ambiente](#variáveis-de-ambiente-do-servidor).

### Modo de desenvolvimento

Abra um terminal para cada etapa.

```bash
# 1. Tipos compartilhados (tem que ser o primeiro)
cd shared/types && npm install && npm run build

# 2. Servidor de sinalização
cd ../../server && npm install && npm run dev

# 3. Interface web
cd ../client && npm install && npm run dev
```

Depois abra http://localhost:3000 (Chrome ou Edge funcionam melhor). Copie `.env.example` para `.env` se quiser mudar portas, limites ou o servidor TURN. As credenciais TURN agora são geradas pelo servidor (as antigas `VITE_TURN_*` foram removidas, porque iam dentro do site compilado).

O servidor escuta só em `127.0.0.1`, de propósito. Para mudar isso (numa hospedagem, por exemplo), defina `HOST=0.0.0.0`.

| Serviço | Porta | Onde mudar |
|---|---|---|
| Interface (Vite) | 3000 | `client/vite.config.ts` |
| Servidor de sinalização | 3001 | `.env`, variável `PORT` |

### Variáveis de ambiente do servidor

Todas são opcionais. Veja também [`.env.example`](.env.example).

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` / `HOST` | `3001` / `127.0.0.1` | Onde o servidor escuta. Em hospedagem, `HOST=0.0.0.0` |
| `PUBLIC_URL` | vazio | Endereço público, usado nos links de convite e no CORS |
| `TRUST_PROXY` | `0` | Saltos de proxy confiáveis para ler o IP real (Render/Nginx = `1`) |
| `MAX_VIEWERS_PER_ROOM` | `8` | Espectadores por sala (1 a 50) |
| `MAX_PENDING_PER_ROOM` | `10` | Pedidos de entrada aguardando aprovação por sala |
| `MAX_ROOMS` | `200` | Salas simultâneas |
| `MAX_CONNECTIONS` / `MAX_CONNECTIONS_PER_IP` | `500` / `20` | Conexões simultâneas, no total e por IP |
| `ROOM_MAX_HOURS` | `12` | Duração máxima de uma sala |
| `JOIN_APPROVAL_TIMEOUT_MS` | `60000` | Tempo que o apresentador tem para responder a um pedido |
| `TURN_URLS` + `TURN_SECRET` | vazio | TURN próprio (coturn com `use-auth-secret`); o servidor gera credenciais temporárias |
| `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN` | vazio | Alternativa: Cloudflare Realtime TURN (o plano gratuito inclui 1000 GB por mês, conforme a Cloudflare na data da pesquisa; confira o preço atual) |
| `LOG_LEVEL` / `LOG_DIR` | `info` / vazio | Nível e pasta dos logs |

Sem TURN configurado, o **Modo privacidade** é ignorado (o apresentador é avisado) e só o STUN público é usado.

### Qualidade do código

```bash
npm run verify      # na raiz: tipos compartilhados, servidor e cliente (tipos, testes, build)

cd server
npm run typecheck && npm test   # Vitest: sinalização, salas, senha, aprovação, TURN, limites

cd ../client
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (cliente e lógica de atualização do desktop)
npm run build       # typecheck e build de produção
npm run e2e         # WebRTC e áudio em um Chrome de verdade (veja client/e2e/README.md)
```

O GitHub Actions roda tudo isso a cada push e pull request ([`ci.yml`](.github/workflows/ci.yml)), além de CodeQL e Dependabot. O instalador só é gerado depois que a CI passa.

### Hospedagem fixa no Render (grátis, sem depender do seu PC)

O repositório tem um [`render.yaml`](render.yaml) que publica site e servidor num único Web Service do plano Free.

1. Suba o repositório para o GitHub.
2. No [Render](https://dashboard.render.com), clique em **New**, **Blueprint**, escolha o repositório e confirme.
3. (Opcional) Preencha no painel `TURN_URLS` e `TURN_SECRET`, ou `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN`. Esses valores ficam só no servidor e nunca vão para o site compilado.
4. Quando terminar, o endereço `https://<nome>.onrender.com` é o seu KIARA fixo. O `PUBLIC_URL` é preenchido sozinho a partir de `RENDER_EXTERNAL_URL`. Com domínio próprio, defina `PUBLIC_URL` no painel.

Limites do plano Free: o serviço hiberna após 15 minutos sem tráfego (a primeira visita seguinte demora cerca de 1 minuto), e uma reinicialização derruba as salas ativas, que ficam só na memória. Para evitar a hibernação, use um monitor gratuito (por exemplo UptimeRobot) chamando `https://<nome>.onrender.com/health` a cada 5 minutos.

O botão **Baixar KIARA para Windows** do site funciona por um endereço do próprio servidor, `/download/windows`. Ele pergunta ao GitHub qual é a release mais recente e redireciona para o `.exe` dela. O resultado fica guardado por 10 minutos, então uma versão recém-publicada pode demorar um pouco para aparecer no botão. Se o GitHub estiver fora do ar, o botão leva para a página de releases. O repositório consultado é `guiciriero/KIARA`; para usar outro, defina `GITHUB_REPO=dono/repositorio`.

### Docker

O [`docker-compose.yml`](docker-compose.yml) sobe o servidor de sinalização (porta 3001, verificação em `/health`) e um coturn próprio. O `TURN_SECRET` é obrigatório: defina-o no `.env`.

```bash
cp .env.example .env            # e preencha TURN_SECRET com um segredo longo e aleatório
cd shared/types && npm install && npm run build && cd ../..
cd server && npm install && npm run build && cd ..
docker compose up -d --build
```

Para parar: `docker compose down`. A imagem do site (`client/Dockerfile`, Nginx na porta 8080 com proxy de `/socket.io` e `/download`) não faz parte do compose e precisa ser construída e publicada à parte. Os arquivos Docker **não foram testados** no ambiente de desenvolvimento do autor, e há uma suspeita conhecida: o compose usa `context: .` com `server/Dockerfile`, que copia `package*.json` e `dist` como se o contexto fosse `server/`. Se o build falhar, ajuste o contexto e abra uma issue. As imagens-base vêm de `registry.redhat.io`, que exige login.

### App desktop (som por aplicativo)

O navegador só consegue compartilhar o som do sistema inteiro. O app desktop (Electron) usa um módulo nativo em C++ para captar o som de programas específicos.

| Sistema | Tecnologia | Requisito |
|---|---|---|
| Windows | WASAPI Process Loopback | Windows 10 versão 2004 (build 19041) ou mais novo |
| macOS | ScreenCaptureKit | macOS 13 ou mais novo |

```bash
cd desktop
npm install
npm run build:native   # precisa do Visual Studio Build Tools (Windows) ou do Xcode CLT (macOS)
npm run dev            # com o Vite rodando em http://localhost:3000
npm start              # modo produção, usa client/dist
```

No modo produção o app abre em `app://app`; adicione essa origem ao `CLIENT_ORIGIN` do servidor.

### O que ainda não foi validado

Foi testado em Chrome real (`npm run e2e`) e por testes automatizados, mas **não** foi possível validar no ambiente de desenvolvimento: o instalador e o auto-update no Windows, a captura nativa de tela dentro do app já empacotado (só foi medida com o Electron avulso; jogos em tela cheia exclusiva, HDR e GPU híbrida também não foram testados), a captura de áudio por aplicativo, as imagens Docker, a execução dos workflows no GitHub, o comportamento com leitor de tela e o PWA instalado, e um TURN real (coturn ou Cloudflare).

### Ideias futuras (não implementadas)

SFU/WHIP para mais espectadores sem sobrecarregar o upload do apresentador, e controle remoto do computador. Ficaram fora por exigirem infraestrutura paga ou riscos de segurança que não se justificam para uso entre amigos e família.

Estado dos testes: no macOS o módulo compila e lista os aplicativos, mas a captura de áudio ao vivo ainda não foi validada. No Windows o instalador é gerado pelo GitHub Actions, mas a captura por aplicativo ainda precisa de testes em máquinas reais.

### Organização das pastas

```
server/            Servidor de sinalização e do site (Node.js, TypeScript)
client/            Interface de quem transmite e de quem assiste (React, Vite)
native/            Módulo C++ de captura de tela (DXGI) e de áudio por aplicativo
desktop/           App Electron
shared/types/      Tipos TypeScript usados pelo servidor e pelo cliente
scripts/           Comando `npm run share` e túnel da Cloudflare
.github/workflows/ CI, CodeQL e geração do instalador do Windows com releases
render.yaml        Configuração da hospedagem fixa no Render
```

---

## Atualização do app

O app para Windows tem o botão **Atualizar** na tela inicial. Ele procura a versão mais nova, baixa e instala por cima, sem precisar desinstalar. A pasta escolhida na primeira instalação é mantida.

- Cada push na `main` gera a release `v1.0.<número do build>`. Tags `v*` usam a própria tag. A release traz o `.exe` e o `latest.yml` que o app consulta.
- O app não guarda nenhum token, então o repositório de releases precisa ser público. Se ele voltar a ser privado, o app avisa que não achou versão; nesse caso, hospede `latest.yml`, o `.exe` e o `.blockmap` em um endereço https público e defina `KIARA_UPDATE_URL=https://.../` (em tempo de execução ou no build).
- A primeira instalação é manual. Só as seguintes se atualizam sozinhas.
- Em desenvolvimento (`npm run dev`) e fora do Windows, o botão fica desativado.

### Assinatura do instalador

O instalador ainda não é assinado digitalmente, e é por isso que o Windows mostra o aviso de "Editor desconhecido". A assinatura de verdade (não existe atalho que dispense isso) está preparada no workflow para a [SignPath Foundation](https://signpath.org/), que oferece assinatura gratuita para projetos de código aberto.

Como ligar, quando a SignPath aprovar o projeto:

1. Na SignPath, crie o projeto com a *artifact configuration* que está comentada no workflow.
2. No GitHub, em *Settings, Secrets and variables, Actions*, cadastre o segredo `SIGNPATH_API_TOKEN` e as variáveis `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` e `SIGNPATH_SIGNING_POLICY_SLUG`.
3. Publique uma tag `v*` (`git tag v1.1.0 && git push origin v1.1.0`). Cada assinatura precisa de uma aprovação manual no site da SignPath, por isso só as tags são assinadas.

Sem o segredo, o build continua funcionando e gera o instalador sem assinatura. Quando há assinatura, o workflow troca o `.exe`, recalcula o hash no `latest.yml` (para o auto-update continuar aceitando o arquivo) e confere se a assinatura é válida antes de publicar.

Mesmo assinado, o aviso do SmartScreen pode continuar aparecendo por um tempo: a reputação do programa cresce com o número de downloads. Alternativas pagas são um certificado comercial de assinatura de código ou publicar na Microsoft Store.

---

## Detalhes técnicos

### Áudio durante a transmissão

A faixa de áudio enviada pelo WebRTC é sempre a mesma: a saída de um mixer Web Audio criado quando a transmissão começa. Trocar de aplicativo, ligar ou desligar uma fonte, silenciar ou mudar o volume mexe só no grafo de áudio por trás dessa faixa. Não há `replaceTrack`, não há renegociação e o vídeo não é interrompido.

- **Desktop:** ao mudar a seleção, o app reinicia a captura nativa com o novo conjunto de PIDs. As fontes removidas são desconectadas antes, para não gerar eco nem duplicação.
- **Web:** o áudio do sistema (`getDisplayMedia`) passa pelo mixer. Desmarcar a fonte silencia sem encerrar a faixa, e ela pode ser religada. Se o navegador não compartilhou áudio, aparece um erro pedindo para reiniciar a transmissão marcando "Compartilhar áudio".
- Se uma troca falhar, a interface volta para a seleção que realmente está no ar e mostra o erro.

### Desempenho do WebRTC e Controle de Qualidade

| Ajuste | Motivo |
|---|---|
| `degradationPreference='maintain-framerate'` e `contentHint='motion'` | Com a rede apertada, o encoder reduz a resolução e não os quadros por segundo |
| `maxBitrate` e `maxFramerate` aplicados de fato | O `VideoConfig` agora chega ao sender |
| Codec automático (fixo, sem seletor na interface): H.265 se o apresentador codifica e o espectador decodifica por hardware, senão H.264, decidido por espectador | Nos testes em loopback com RTX 3070, o H.265 teve menos latência e menos tempo de encode que o H.264; VP9 e AV1 codificam em software nessa placa e não seguram 1080p60 |
| Captura nativa no app para Windows: DXGI com textura compartilhada na GPU, entregue ao WebRTC como `VideoFrame`. Se falhar (monitor girado, HDR, janela em vez de tela inteira), cai no `getDisplayMedia`. Para desligar: `localStorage['kiara:nativeCapture']='0'` | O capturador do Chromium ficou em 31 a 50 FPS; o nativo entregou cerca de 60 FPS no Electron avulso (veja a auditoria) |
| Controle individual de resolução para quem assiste | O espectador escolhe no player (Auto, 1080p, 720p, 480p, 360p) e o apresentador aplica `scaleResolutionDownBy` só para ele |
| App desktop com aceleração direta de GPU (NVENC/WebRTC) | Flags no Electron para codificação e decodificação aceleradas por hardware sem engasgos |
| `bundlePolicy: 'max-bundle'`, `rtcpMuxPolicy: 'require'`, `iceCandidatePoolSize: 2` | Uma única porta de transporte e ICE mais rápido |
| ICE restart: `disconnected` por 3 s ou `failed` chama `restartIce()` com nova offer; depois de 3 tentativas o peer é recriado | Recupera de troca de rede ou de Wi-Fi sem derrubar a sala |
| Controle AIMD de bitrate por espectador (perda acima de 8 % ou RTT acima de 400 ms por 3 amostras reduz 20 %; 3 amostras saudáveis sobem 15 % do alvo; piso de 1,5 Mbps, ou 0,8 Mbps com perda acima de 15 %) | Evita congestionamento sem mexer no FPS e nunca passa do alvo |

O overlay de estatísticas (a cada 2 s, pior caso entre os espectadores) mostra FPS, bitrate de vídeo e áudio, RTT, perda, jitter e o motivo de limitação do encoder. Para conferir à mão no console, com `pc` sendo o `RTCPeerConnection` de quem transmite:

```js
const r = await pc.getStats();
r.forEach((s) => {
  if (s.type === 'outbound-rtp' && s.kind === 'video')
    console.log('fps', s.framesPerSecond, 'limitação', s.qualityLimitationReason, 'bytes', s.bytesSent);
  if (s.type === 'remote-inbound-rtp' && s.kind === 'video')
    console.log('perda', s.fractionLost, 'jitter(s)', s.jitter, 'rtt(s)', s.roundTripTime);
  if (s.type === 'candidate-pair' && s.nominated)
    console.log('rtt do par', s.currentRoundTripTime, 'bitrate disponível', s.availableOutgoingBitrate);
});
```

Também vale abrir `chrome://webrtc-internals` durante a transmissão.

### Tecnologias

| Camada | O que usa |
|---|---|
| Servidor | Node.js 22, TypeScript, Express, Socket.IO, Helmet, Winston |
| Interface | React 18, TypeScript, Vite, React Router |
| Vídeo | WebRTC do navegador (`RTCPeerConnection`, `getDisplayMedia`) |
| App desktop | Electron (com Fuses e verificação de integridade do `cloudflared`) |
| Instalável | PWA (manifesto e service worker; no navegador, "Instalar app") |
| Vídeo no Windows (app) | C++17, DXGI Desktop Duplication, textura D3D11 compartilhada, Node Addon API |
| Áudio no Windows | C++17, WASAPI Process Loopback, Node Addon API |
| Áudio no macOS | Objective-C++, ScreenCaptureKit, Node Addon API |
| Contêineres | Docker, Docker Compose, Nginx, Red Hat UBI 9 |

### Segurança e privacidade

- Os serviços locais escutam só em `127.0.0.1`, a não ser que você defina `HOST` (no Render, `0.0.0.0` é necessário e já vem no `render.yaml`).
- O endereço de download só redireciona para arquivos `KIARA-Setup-*.exe` do repositório configurado. Qualquer outro link vindo do GitHub é ignorado.
- Os contêineres rodam como usuário comum (UID 1001), a partir de imagens `registry.redhat.io/ubi9/*`.
- O vídeo e o áudio são protegidos por DTLS 1.2 e SRTP, o padrão do WebRTC.
- As credenciais do TURN ficam só no servidor (variáveis de ambiente) e são entregues ao cliente como credenciais temporárias; nada vai para o bundle.
- Salas podem ter senha (guardada só como hash scrypt) e aprovação manual. Tentativas erradas de senha ou código são limitadas por conexão.
- O servidor usa Helmet (CSP, HSTS em produção), limite de requisições, limite de conexões por IP e valida todo payload de Socket.IO.
- Para reportar uma vulnerabilidade, veja [`SECURITY.md`](SECURITY.md).
- O túnel é temporário: o endereço do túnel pode mudar a cada sessão e nada fica gravado no servidor.

---

## Problemas comuns

**"Você precisa permitir o compartilhamento de tela".** O navegador pediu permissão e você negou ou fechou o seletor. Inicie de novo e autorize.

**"Você cancelou a seleção de tela".** Você fechou o seletor sem escolher nada. Inicie de novo e selecione uma janela ou monitor.

**O espectador não recebe o vídeo.** Veja se as portas UDP não estão bloqueadas. Em redes restritas (empresa, 4G), configure um servidor TURN (`TURN_URLS`/`TURN_SECRET` ou Cloudflare) no servidor.

**"Sala cheia".** A sala chegou ao limite de espectadores (`MAX_VIEWERS_PER_ROOM`, padrão 8). Peça ao apresentador para liberar uma vaga ou aumente o limite se o upload dele aguentar.

**`EADDRINUSE: address already in use :::3001`.** Já existe um servidor rodando. Encerre-o com `Ctrl+C` ou troque a porta no `.env` (`PORT=3002`) e no cliente (`VITE_SERVER_URL=http://127.0.0.1:3002`).

**Latência alta (mais de 300 ms).** Reduza o bitrate (2000 a 4000 kbps para 1080p), escolha uma resolução menor ou use um servidor TURN perto de você e do espectador.

**O módulo nativo não compila no Windows.** Instale o Visual Studio Build Tools com "Desenvolvimento para desktop com C++" e o Windows SDK 10.0.19041 ou mais novo, depois rode `npm run build:native` dentro de `desktop/`.

---

## Licença

O código do KIARA é distribuído sob a licença MIT, livre para uso pessoal e comercial. Texto completo em [`LICENSE`](LICENSE).

O instalador do Windows também leva programas de terceiros com licenças próprias, principalmente o Electron/Chromium e o `cloudflared` (Apache-2.0). A lista e os avisos estão em [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). As dependências npm usam licenças permissivas (MIT, ISC, BSD, Apache-2.0 e similares), compatíveis com a MIT.
