# KIARA

Compartilhe sua tela e o som do computador com quem você quiser, direto do navegador ou do app para Windows. Quem assiste só precisa abrir um link.

O KIARA transmite vídeo de até 4K a 60 FPS, ligando você e os espectadores de forma direta (WebRTC). No app desktop dá para escolher de quais programas o som sai, por exemplo o vídeo sim e o jogo não.

---

## Para quem só quer usar

### Instalar no Windows

1. Abra a página de [Releases](../../releases/latest) e baixe o `KIARA-Setup-<versão>.exe`.
2. Dê dois cliques no arquivo. O instalador deixa você escolher a pasta e não pede senha de administrador.
3. Abra o KIARA pelo atalho na Área de Trabalho e clique em **Iniciar Transmissão**.
4. Copie o link que aparece e mande para quem vai assistir (no WhatsApp, por exemplo). A pessoa abre no navegador, sem instalar nada.

**Sobre o aviso do Windows.** Na primeira vez, o Windows pode mostrar "O Windows protegeu seu computador". Isso acontece com qualquer programa novo ou pouco baixado, e não quer dizer que o arquivo tenha algo errado. Para continuar, clique em **Mais informações** e depois em **Executar assim mesmo**. Se quiser se certificar de que o arquivo é o original, veja [como conferir o instalador](#conferir-que-o-instalador-é-o-original).

### Assistir uma transmissão

1. Abra o link que a pessoa mandou.
2. Clique em **Ativar Som da Transmissão** para ouvir o áudio (os navegadores bloqueiam o som até você clicar).
3. Para sair, clique em **Sair**.

Se preferir, abra a página inicial no navegador, digite o código de 6 caracteres (ou cole o link) e clique em **Entrar**. No app instalado, cole o link completo.

### Dicas

- O app precisa ficar aberto no computador de quem transmite.
- O link muda a cada vez que o app é aberto. Quando você fecha, a sala acaba.
- Quem tiver o link e o código consegue assistir, então envie só para quem você confia.
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

- Node.js 20 ou mais novo, com npm 10 ou mais novo
- Git

### Um comando só

```bash
npm run share
```

Na primeira vez ele instala as dependências, compila o site, sobe o servidor e cria um link público pela Cloudflare (grátis, sem conta). Para isso você precisa do `cloudflared`:

- macOS: `brew install cloudflared`
- Windows: `winget install --id Cloudflare.cloudflared` (reabra o terminal depois)
- Linux: veja a [documentação oficial](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

Para abrir o app desktop, com som por aplicativo, use `npm run share:desktop`.

Se o vídeo não conectar em redes muito restritas (empresas, alguns planos 4G), será preciso um servidor TURN próprio. O Open Relay que vem no `.env.example` serve só para testes.

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

Depois abra http://localhost:3000 (Chrome ou Edge funcionam melhor). Copie `.env.example` para `.env` se quiser mudar portas ou o servidor TURN. O TURN do cliente (`VITE_TURN_*`) só é usado quando URL, usuário e credencial estão preenchidos juntos.

| Serviço | Porta | Onde mudar |
|---|---|---|
| Interface (Vite) | 3000 | `client/vite.config.ts` |
| Servidor de sinalização | 3001 | `.env`, variável `PORT` |

### Qualidade do código

```bash
cd client
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (cliente e lógica de atualização do desktop)
npm run build       # typecheck e build de produção
npm run e2e         # WebRTC e áudio em um Chrome de verdade (veja client/e2e/README.md)
```

### Hospedagem fixa no Render (grátis, sem depender do seu PC)

O repositório tem um [`render.yaml`](render.yaml) que publica site e servidor num único Web Service do plano Free.

1. Suba o repositório para o GitHub.
2. No [Render](https://dashboard.render.com), clique em **New**, **Blueprint**, escolha o repositório e confirme.
3. Preencha `VITE_TURN_URL`, `VITE_TURN_USER` e `VITE_TURN_CREDENTIAL` com o seu servidor TURN (os três juntos, ou deixe vazio). Depois de mudar esses valores, faça um novo deploy, porque eles entram no build do site.
4. Quando terminar, o endereço `https://<nome>.onrender.com` é o seu KIARA fixo. O `PUBLIC_URL` é preenchido sozinho a partir de `RENDER_EXTERNAL_URL`. Com domínio próprio, defina `PUBLIC_URL` no painel.

Limites do plano Free: o serviço hiberna após 15 minutos sem tráfego (a primeira visita seguinte demora cerca de 1 minuto), e uma reinicialização derruba as salas ativas, que ficam só na memória. Para evitar a hibernação, use um monitor gratuito (por exemplo UptimeRobot) chamando `https://<nome>.onrender.com/health` a cada 5 minutos.

### Docker

Se não quiser instalar o Node.js:

```bash
cp .env.example .env
cd shared/types && npm install && npm run build && cd ../..
cd server && npm install && npm run build && cd ..
cd client && npm install && npm run build && cd ..
docker-compose up -d
```

Acesse http://localhost:3000. Para parar: `docker-compose down`.

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

Estado dos testes: no macOS o módulo compila e lista os aplicativos, mas a captura de áudio ao vivo ainda não foi validada. No Windows o instalador é gerado pelo GitHub Actions, mas a captura por aplicativo ainda precisa de testes em máquinas reais.

### Organização das pastas

```
server/            Servidor de sinalização e do site (Node.js, TypeScript)
client/            Interface de quem transmite e de quem assiste (React, Vite)
native/            Módulo C++ de captura de áudio por aplicativo
desktop/           App Electron
shared/types/      Tipos TypeScript usados pelo servidor e pelo cliente
scripts/           Comando `npm run share` e túnel da Cloudflare
.github/workflows/ Gera o instalador do Windows e publica as releases
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

### Desempenho do WebRTC

| Ajuste | Motivo |
|---|---|
| `degradationPreference='maintain-framerate'` e `contentHint='motion'` | Com a rede apertada, o encoder reduz a resolução e não os quadros por segundo |
| `maxBitrate` e `maxFramerate` aplicados de fato | O `VideoConfig` agora chega ao sender |
| Codec escolhido primeiro; H.264 prefere o perfil High | Melhor qualidade por bit em hardware |
| `bundlePolicy: 'max-bundle'`, `rtcpMuxPolicy: 'require'`, `iceCandidatePoolSize: 2` | Uma única porta de transporte e ICE mais rápido |
| ICE restart: `disconnected` por 3 s ou `failed` chama `restartIce()` com nova offer; depois de 3 tentativas o peer é recriado | Recupera de troca de rede ou de Wi-Fi sem derrubar a sala |
| Controle AIMD de bitrate por espectador (perda acima de 5 % ou RTT acima de 300 ms por 2 amostras reduz para 75 %; 5 amostras saudáveis sobem 10 % do alvo) | Evita congestionamento sem mexer no FPS e nunca passa do alvo |

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
| Servidor | Node.js 20, TypeScript, Express, Socket.IO, Winston |
| Interface | React 18, TypeScript, Vite, React Router |
| Vídeo | WebRTC do navegador (`RTCPeerConnection`, `getDisplayMedia`) |
| App desktop | Electron |
| Áudio no Windows | C++17, WASAPI Process Loopback, Node Addon API |
| Áudio no macOS | Objective-C++, ScreenCaptureKit, Node Addon API |
| Contêineres | Docker, Docker Compose, Nginx, Red Hat UBI 9 |

### Segurança e privacidade

- Os serviços locais escutam só em `127.0.0.1`.
- Os contêineres rodam como usuário comum (UID 1001), a partir de imagens `registry.redhat.io/ubi9/*`.
- O vídeo e o áudio são protegidos por DTLS 1.2 e SRTP, o padrão do WebRTC.
- As credenciais do TURN ficam só no `.env`, nunca no código.
- O túnel é temporário: as salas e os links mudam a cada sessão e nada fica gravado.

---

## Problemas comuns

**"Você precisa permitir o compartilhamento de tela".** O navegador pediu permissão e você negou ou fechou o seletor. Inicie de novo e autorize.

**"Você cancelou a seleção de tela".** Você fechou o seletor sem escolher nada. Inicie de novo e selecione uma janela ou monitor.

**O espectador não recebe o vídeo.** Veja se as portas UDP não estão bloqueadas. Em redes restritas (empresa, 4G), configure um servidor TURN no `.env`. Para testes, o Open Relay serve: https://www.metered.ca/tools/openrelay/

**`EADDRINUSE: address already in use :::3001`.** Já existe um servidor rodando. Encerre-o com `Ctrl+C` ou troque a porta no `.env` (`PORT=3002`) e no cliente (`VITE_SERVER_URL=http://127.0.0.1:3002`).

**Latência alta (mais de 300 ms).** Reduza o bitrate (2000 a 4000 kbps para 1080p), escolha uma resolução menor ou use um servidor TURN perto de você e do espectador.

**O módulo nativo não compila no Windows.** Instale o Visual Studio Build Tools com "Desenvolvimento para desktop com C++" e o Windows SDK 10.0.19041 ou mais novo, depois rode `npm run build:native` dentro de `desktop/`.

---

## Licença

MIT, livre para uso pessoal e comercial. Texto completo em [`LICENSE`](LICENSE).
