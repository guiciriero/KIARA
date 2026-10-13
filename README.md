# ✦ KIARA — Compartilhamento de Tela em Alta Fidelidade

**KIARA** é uma plataforma moderna e ultrarrápida de compartilhamento de tela e áudio P2P em tempo real, com suporte a captura de áudio isolado por processo/aplicativo, codecs adaptativos de vídeo até 4K a 60 FPS e interface de estúdio e player com design refinado.

---

## ✨ Recursos Principais

| Recurso | Detalhes |
|---|---|
| **Transmissão de Vídeo** | Até 4K (3840×2160), 60 FPS, codecs H.264 / VP9 / H.265 adaptativos |
| **Captura de Áudio Isolado** | No app desktop: áudio por aplicativo individual — WASAPI Process Loopback (Windows 10 2004+) / ScreenCaptureKit (macOS 13+). No navegador: áudio do sistema |
| **Conexão WebRTC P2P** | Comunicação direta ponto a ponto com fallback STUN/TURN, suporte a múltiplos espectadores simultâneos |
| **Sinalização em Tempo Real** | Node.js + Socket.IO com reconexão automática e telemetria de latência |
| **Código e Link de Convite** | Código seguro de 6 caracteres gerado automaticamente com cópia em 1 clique |
| **Telemetria / HUD de Estatísticas** | FPS, bitrate de vídeo/áudio, latência RTT em milissegundos e qualidade de rede em tempo real |
| **Player do Espectador** | Modo cinematográfico com autohide de controles, volume local independente, botão de ativação de áudio e tela cheia |

---

## 🏗️ Estrutura do Projeto

```
screen-share-app/
├── server/           → Servidor de sinalização e entrega estática (Node.js + TypeScript)
├── client/           → Interface web do Host e Viewer (React 18 + TypeScript + Vite)
├── native/           → Módulo nativo C++ de captura de áudio por app (WASAPI / ScreenCaptureKit)
├── desktop/          → Shell Desktop Electron (captura de áudio por processo)
├── shared/types/     → Definições de tipos TypeScript compartilhadas
├── scripts/          → Scripts de automação e túnel (Cloudflared)
├── docker-compose.yml
└── .env.example
```

---

## 🚀 Como Rodar Localmente

### Pré-requisitos

- **Node.js** 20 LTS ou superior
- **npm** 10+
- **Git**

---

### Execução Rápida (Comando Único)

```bash
cd screen-share-app
npm run share
```

Para abrir o aplicativo Desktop com captura de áudio isolado por app:
```bash
npm run share:desktop
```

---

### Execução em Modo de Desenvolvimento

1. **Tipos Compartilhados:**
   ```bash
   cd shared/types
   npm install
   npm run build
   ```

2. **Servidor de Sinalização:**
   ```bash
   cd ../server
   npm install
   npm run dev
   ```

3. **Interface do Usuário (Cliente Web):**
   ```bash
   cd ../client
   npm install
   npm run dev
   ```

Acesse **http://localhost:3000** no navegador (Chrome, Edge, Firefox, Safari).

---

### Qualidade (cliente)

```bash
cd client
npm run lint        # ESLint (flat config)
npm run typecheck   # tsc --noEmit
npm test            # Vitest (cliente + lógica de atualização do desktop)
npm run build       # typecheck + build de produção
npm run e2e         # WebRTC + áudio dinâmico em Chrome real (precisa do Google Chrome; veja client/e2e/README.md)
```

Variáveis de ambiente: veja `.env.example`. O TURN do cliente (`VITE_TURN_*`) só é usado
se URL, usuário e credencial estiverem definidos juntos.

---

## 🎧 Áudio durante a transmissão

A faixa de áudio enviada ao WebRTC é **sempre a mesma** (saída de um mixer Web Audio criada
no início da live). Trocar de aplicativo, ligar/desligar uma fonte, mutar ou mudar o volume
altera só o grafo de áudio atrás dessa faixa — sem `replaceTrack`, sem renegociar e sem
interromper o vídeo.

- **Desktop:** ao mudar a seleção, o app reinicia a captura nativa com o novo conjunto de PIDs;
  fontes removidas são desconectadas antes (sem eco nem duplicação).
- **Web:** o áudio do sistema (`getDisplayMedia`) passa pelo mixer; desmarcar a fonte silencia sem
  encerrar a faixa, e ela pode ser religada. Se o navegador não compartilhou áudio, aparece um erro
  pedindo para reiniciar a transmissão marcando "Compartilhar áudio".
- Se uma troca falhar, a interface volta à seleção que realmente está no ar e mostra o erro.

---

## 📈 Desempenho e diagnóstico (WebRTC)

| Ajuste | Por quê |
|---|---|
| `degradationPreference='maintain-framerate'` + `contentHint='motion'` | Sob pressão de rede o encoder reduz resolução, não FPS |
| `maxBitrate`/`maxFramerate` aplicados de fato (o broadcaster agora recebe o `VideoConfig`) | Antes bitrate/fps/codec nunca chegavam ao sender |
| Codec escolhido primeiro; H.264 prefere perfil High (`profile-level-id=64…`, `packetization-mode=1`) | Melhor qualidade por bit em hardware |
| `bundlePolicy: 'max-bundle'`, `rtcpMuxPolicy: 'require'`, `iceCandidatePoolSize: 2` | Uma só porta de transporte e ICE mais rápido |
| ICE restart: `disconnected` + 3 s de tolerância ou `failed` → `restartIce()` + nova offer; após 3 tentativas recria o peer | Recupera de troca de rede/Wi-Fi sem derrubar a sala |
| Controle AIMD de bitrate por espectador (perda > 5 % ou RTT > 300 ms por 2 amostras → ×0,75; saudável por 5 → +10 % do alvo) | Evita congestionamento sem mexer no FPS; nunca passa do alvo configurado |

Métricas no overlay (a cada 2 s, pior caso entre espectadores): FPS, bitrate de vídeo/áudio, RTT,
perda %, jitter e motivo de limitação do encoder. Para conferir manualmente no console do app:

```js
// pc = RTCPeerConnection do apresentador
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

Também vale abrir `chrome://webrtc-internals` no navegador durante a live.

---

## 🔒 Segurança e Privacidade

- Conexões com serviços locais restritas a `127.0.0.1` (sem binding em interfaces abertas).
- Mídia transmitida com criptografia ponta a ponta **DTLS 1.2 + SRTP**.
- Túnel efêmero: salas temporárias e links únicos a cada sessão.

---

## 📄 Licença

MIT — livre para uso pessoal e comercial. Texto completo em [`LICENSE`](../LICENSE).

## Atualização do aplicativo

O app desktop (Windows) tem o botão **Atualizar** na tela inicial: verifica, baixa e instala a versão mais recente sem desinstalar nada (electron-updater; o instalador NSIS por usuário atualiza por cima, mesmo `appId`).

**Como funciona**
- Cada push na `main` gera uma release `v1.0.<run_number>` (e tags `v*` usam a própria tag) com `KIARA-Setup-x.y.z.exe`, `.blockmap` e `latest.yml`, publicada só com o `github.token` do workflow.
- O app instalado consulta o feed, baixa a versão nova e, em "Reiniciar e atualizar", fecha túnel/servidor/áudio e roda o instalador.
- Em desenvolvimento (`npm run dev`) e fora do Windows o botão fica desativado.

**Repositório público**
O app não embute token: o feed de releases precisa ser legível sem autenticação, por isso o repositório é público. Se voltar a ser privado, o app mostra "O repositório de releases é privado ou ainda não há versão publicada"; nesse caso copie `latest.yml`, `.exe` e `.blockmap` para um local público https e defina `KIARA_UPDATE_URL=https://.../` (em tempo de execução ou no build, que embute o valor em `build-info.json`).

**Limitações**
- Sem assinatura de código: o Windows SmartScreen mostra "Editor desconhecido" (Mais informações > Executar assim mesmo). Assinar não remove o aviso de imediato — a reputação se acumula com o tempo. Opções avaliadas: SignPath Foundation (gratuito para open source; exige LICENSE OSI, releases publicadas, MFA e aprovação manual por release) ou um certificado comercial. O Microsoft Artifact Signing é pago e não atende contas individuais/organizações no Brasil.
- Rate limit do GitHub (403/429) é tratado com mensagem amigável.
- A primeira instalação com o auto-update ainda é manual; só versões posteriores se atualizam sozinhas.
