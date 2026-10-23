# KIARA — Auditoria de Streaming 1080p60 de baixa latência

Branch: `audit/streaming-1080p60` · Data: auditoria feita sobre `d6fc1cd` · Máquina de teste: Ryzen 5 5600, RTX 3070 (NVENC/NVDEC), Windows, Ethernet 1 Gbps, monitor 2560x1440@99 Hz, Chrome 156.

> **Leia primeiro (limites honestos da medição).** Os benchmarks abaixo rodam em **Chrome real, loopback na mesma máquina e mesma página**. Medem bem: encode, bandwidth-estimation (GCC), pacing do WebRTC, jitter buffer, decode e apresentação. **Não medem:** captura de tela do SO, o app Electron empacotado (não há `electron.exe` nem MSVC nesta máquina para compilá-lo), rede real, Wi-Fi, TURN nem Brasil↔exterior. "100% de fluidez" depende de hardware e rede; a seção 6 diz onde estão os limites.

---

## 0. Resumo executivo

1. **O app desktop hoje é Electron + `getDisplayMedia` + WebRTC P2P mesh.** Ele NÃO usa captura DXGI zero-copy nem encode nativo. O módulo C++ de vídeo (`native/src/screen_capture.cpp`) **está compilado e empacotado, mas nunca é chamado** (nenhum `startCapture`/`listCaptureSources` em `desktop/` ou `client/`). Só o áudio por aplicativo (WASAPI) é realmente usado.
2. **Achado de maior impacto (corrigido e medido):** o Chrome só lê `x-google-start/max-bitrate` da descrição **remota**. O broadcaster é quem envia o offer, então essas dicas só valem se vierem na **answer** do espectador, e o código nunca as devolvia. Resultado medido: o GCC partia de baixo, caía para 720p/540p e ficava `qualityLimitation=bandwidth` **mesmo em Ethernet gigabit sem perda**. Com a correção, 1080p é mantido em 3/3 rodadas (antes: 0/3).
3. **O servidor não é um SFU.** É só sinalização Socket.IO. Cada espectador recebe um fluxo separado do PC do apresentador (mesh). Com 8 espectadores a 15 Mbps = 120 Mbps de upload. Isso invalida a meta de qualidade para mais de 1–2 espectadores.
4. **A versão web já existe e funciona** (viewer React + `<video>` + WebRTC). É o lado mais maduro do projeto.
5. **Hospedagem atual (Render Free):** hiberna, não expõe UDP, região fora do Brasil. Serve para sinalização, **não** para mídia.
6. **Honesto sobre a meta:** com a pilha atual (Chrome/WebRTC) não dá para garantir 1080p60 "100% fluido" em qualquer rede/GPU. Dá para chegar perto no app **se** a captura e o encode saírem do Chromium (seção 3).

---

## 1. Diagnóstico — o que existe e o que falta

### 1.1 Estado por lado

| Componente | App desktop | Viewer web |
|---|---|---|
| UI / lógica | React 18 + Vite (o **mesmo** bundle roda nos dois) | idem |
| Casca | Electron 44, `app://` + servidor Node embutido + túnel `cloudflared` | navegador |
| Captura de vídeo | `desktopCapturer` → `getDisplayMedia` (Chromium) | n/a (web só assiste; mas o `ViewerPage` ainda oferece "Também transmitir") |
| Captura de áudio | **WASAPI process-loopback nativo (C++), por aplicativo**: ponto forte real | `getDisplayMedia` áudio do sistema |
| Encode | Chromium WebRTC (NVENC via MediaFoundation/D3D11 quando disponível) | n/a |
| Transporte | WebRTC P2P, 1 `RTCPeerConnection` por espectador (mesh) | idem |
| Decode/render | `<video>` (Chromium) | `<video>` |
| Sinalização | Socket.IO (Express) | idem |
| Persistência | arquivo JSON local (`permanent_rooms.json`) | n/a |
| Hospedagem | Render Free (+ túnel Cloudflare no app), coturn só no `docker-compose` | idem |

**A criar do zero (não existe):** captura nativa de vídeo ligada ao pipeline, encoder nativo, SFU/relay de mídia, controle remoto, métricas de servidor, testes de rede ruim, ABR/simulcast.

### 1.2 Pipeline atual e custo por etapa (medido onde possível)

```
[Captura getDisplayMedia] → [Encode Chromium] → [RTP/SRTP, pacer GCC] → [P2P/TURN] → [jitter buffer] → [Decode] → [<video> + compositor]
```

| Etapa | Medido/estimado | Fonte |
|---|---|---|
| Captura de tela (Chromium, desktop 1440p estático→dinâmico) | **só entrega 31–43 fps** em 1080p/1440p com conteúdo animado; intervalos de 31 ms (cadência de 30 Hz) e picos de 60 ms | `capture-probe.mjs`, sec. 2.3 |
| Encode H.264 NVENC 1080p | **5,2–6,8 ms/frame** (NVENC ocupado ~14–22%) | benchmark |
| Encode HEVC | 5,1–5,6 ms/frame | benchmark |
| Encode VP9 / AV1 | **13–14 ms / 11–12 ms** (software — NVENC 0%); inviável para 1080p60 | benchmark + `nvidia-smi` |
| Decode (NVDEC) | 0,6–0,9 ms/frame | benchmark |
| Jitter buffer | 60–105 ms médios no loopback (dominante) | benchmark |
| Glass-to-glass (loopback, sem captura de SO nem rede) | **H.264 ≈ 130 ms, HEVC ≈ 95–103 ms** | benchmark |

### 1.3 Gargalos, em ordem de impacto

1. **Estimativa de banda mal inicializada** (corrigido): ver seção 2.1.
2. **Captura via `getDisplayMedia` a ~30–43 fps** nesta máquina com conteúdo em movimento (seção 2.3). Esse teto está no capturador do Chromium, antes de qualquer encode. É o principal limitador do 1080p60 no app e **não é corrigível por tuning de SDP**.
3. **Mesh P2P:** upload = bitrate × nº de espectadores (confirmado no código: 1 `RTCPeerConnection` por espectador). O Chromium tende a encodar uma vez por conexão; não medi isso com 2+ espectadores.
4. **Jitter buffer** de 60–105 ms mesmo com `jitterBufferTarget=0` (o valor é lido de volta como 0, mas o Chromium ainda acumula `jitterBufferDelay` médio de 60–100 ms no loopback). Em cenas de alta atividade (explosões) o decoder ainda espera frame completo.
5. **Servidor:** Socket.IO com `pingInterval 5 s`, sinalização única, sem métricas (não verifiquei se `stream:quality-request` tem limite de taxa além do `safe()`).
6. **Código nativo de vídeo morto:** `screen_capture.cpp` ainda copia GPU→CPU (`CopyResource` + `Map` + `memcpy` + `Buffer::Copy`) e seria *pior* que `getDisplayMedia`, então o fato de não ser usado é, hoje, até benéfico.

### 1.4 Qualidade de código, segurança, observabilidade

- **Pontos fortes:** TypeScript estrito, 249 testes de cliente + 82 de servidor passando, CSP, validação de IPC no Electron, fuses, rate-limits de join, TURN com credencial efêmera (HMAC), ICE restart com backoff, rotina de CI, e2e em Chrome real. Código de áudio por app (WASAPI) é diferenciado.
- **Fracos:** `README`/`PERFORMANCE.md` prometem "até 4K a 60 FPS" sem base medida; `PERFORMANCE.md` afirma "Buffer de jitter: 0 ms" (**falso** como medido: 60–105 ms); `DEFAULT_VIDEO_CONFIG` pede 8 Mbps mas o teto prático medido sob o GCC era ~4 Mbps; o `BitrateController` AIMD calcula um `maxBitrate` que nunca ultrapassa o que o GCC já limita; um teste (`performance.test.ts`) estava falhando no baseline (corrigido).
- **Observabilidade:** stats só no cliente (a cada 2 s); servidor sem métricas, sem tracing, logs Winston simples.
- **Segurança:** `docker-compose.yml` traz `TURN_SECRET` fixo no repositório (`kiara_turn_secret_change_me_in_production`) e `TURN_URLS` apontando para `127.0.0.1`; precisa ser trocado antes de qualquer uso real.

---

## 2. Benchmarks reais (números)

### 2.1 Achado principal: GCC preso em baixo bitrate (A/B, 3 rodadas cada)

Cenário idêntico (1080p60, H.264, bitrate pedido 15 Mbps, cena sintética de FPS, loopback sem perda):

| | Altura da imagem nos 7 amostras de 2 s | `qualityLimitation` | FPS enviado | Freezes |
|---|---|---|---|---|
| **Antes** (`d6fc1cd`) | 1080 → **720 e fica em 720** (3/3 rodadas) | `bandwidth` | 48,9 / 50,4 / 49,0 | 8 / 1 / 5 |
| **Depois** (`mirrorVideoBitrateHints`, versão com min/max/start) | **1080 em todas** (3/3) | `none` | 56,9 / 56,9 / 56,7 | 1 / 1 / 2 |

Causa provável (hipótese consistente com o A/B, não confirmada no código-fonte do Chromium): o Chrome parece honrar `x-google-start/max-bitrate` apenas quando vêm na descrição **remota** do emissor. O código as inseria só no offer (descrição local do broadcaster) e a answer do espectador não as repetia. O que está medido é o efeito: com o espelhamento, 1080p se mantém. Correção em `client/src/services/sdpTuning.ts` (`mirrorVideoBitrateHints`) e `webrtcService.ts` (`handleOffer`). A versão final **não** espelha `x-google-min-bitrate` (vira piso e pode agravar filas em links fracos; é um risco de projeto, não medido). Reteste só com max/start: 2/2 rodadas mantiveram 1080p, `limit=none`, ~56,7 fps.

### 2.2 Matriz codec × bitrate (1080p60, 15 s por célula, GPU NVIDIA, depois da correção)

| Codec | Bitrate pedido | FPS enviado | FPS apresentado | Resolução | Encode ms | Pacing >40 ms | G2G p50 / p95 ms |
|---|---|---|---|---|---|---|---|
| H.264 | 8 / 15 / 25 Mbps | 56,1 / 56,1 / 55,5 | 44,5 / 44,6 / 42,9 | 1080p / 1080p / 1080p | 5,9 / 6,3 / 6,8 | 4,6 / 7,3 / 10,6 % | 138/164 · 131/149 · 131/151 |
| **HEVC** | 8 / 15 / 25 | 55,8 / 56,6 / 56,0 | **47,2 / 48,2 / 45,9** | 1080p | **5,6 / 5,4 / 5,2** | **4,1 / 3,6 / 5,5 %** | **95/114 · 95/115 · 103/130** |
| AV1 | 8 / 15 / 25 | 38,0 / 50,5 / 52,1 | 30,4 / 36,5 / 41,1 | 540p / 1080p / 1080p | 7,6–12,4 | 21 / 14 / 8 % | 40/611 · 157/291 · 200/321 |
| VP9 | 8 / 15 / 25 | 24,8 / 41,0 / 26,7 | 20,5 / 34,9 / 22,9 | 540p / 720p / 720p | 13,3–13,9 | 53 / 16 / 42 % | 42/266 · 143/246 · 193/416 |

Conclusões: **HEVC é o melhor codec no hardware testado** (menor latência, menor encode, melhor pacing, nenhum freeze); H.264 é um bom segundo lugar e o mais compatível; **VP9 e AV1 não servem para 1080p60 tempo real aqui** (encode em software, resolução cai, G2G com cauda de 250–600 ms). O encode de VP9/AV1 mostrou NVENC 0% no `nvidia-smi`.

> **Ressalva importante:** o bitrate **real** ficou em ~4 Mbps (H.264) e não nos 15–25 Mbps pedidos, porque a cena sintética, mesmo com grão, é de baixa entropia para o encoder rápido. A matriz comprova *comportamento do pipeline*, não a qualidade de imagem em um jogo real. Para avaliar qualidade (VMAF/PSNR) é preciso gravar uma sessão real de FPS; ver pendências.

### 2.3 Captura de tela (`getDisplayMedia`, Chrome 156, tela 2560x1440, página animada em rAF)

| Pedido | Entregue (settings) | FPS real | Intervalo p50 / p99 / máx |
|---|---|---|---|
| 1920×1080@60 `resizeMode:none` | 1920×1080@60 | **42,9** | 19,3 / 60,5 / 62,3 ms |
| 1920×1080@60 `crop-and-scale` | 1920×1080@60 | **31,6** | 31,2 / 61,4 / 63,1 ms |
| 2560×1440@60 `none` | 2560×1440@60 | **31,3** | 31,2 / 62,5 / 62,9 ms |

O `track.getSettings()` **reporta 60 fps, mas a entrega real é 31–43 fps**, e o intervalo de 31 ms indica cadência travada em ~30 Hz. É o limitador nº 1 do "60 fps fluido" no app atual; o `applyConstraints` do `captureService.ts` não resolve isso. Medição indicativa (uma máquina, janela do Chrome ocupando a tela; o Electron usa o mesmo capturador, mas **não** foi medido).

### 2.4 Hardware encode confirmado

`nvidia-smi` durante o teste: H.264 e HEVC = **NVENC 14–22%**; VP9/AV1 = **NVENC 0%** (encode em CPU). NVDEC 10–27% em todos.

---

## 3. Recomendação de arquitetura-alvo

### 3.1 App desktop — **Tauri 2 (Rust) + núcleo de mídia nativo em Rust**, UI React reaproveitada

| Opção | Desempenho / controle de GPU | Tamanho | Manutenção | Veredito |
|---|---|---|---|---|
| **Electron (atual)** | Preso ao capturador/encoder/jitter do Chromium; teto de 31–43 fps medido | ~150 MB | Baixa (já existe) | Bom para UI; **não** alcança Parsec |
| **Tauri 2 + núcleo Rust** | Captura WGC/DXGI e encode NVENC/AMF/QSV via FFI direto, zero-copy GPU, pacing/FEC próprios | ~10–20 MB | Média (Rust) | **Recomendado**, reaproveita 100% da UI React |
| Qt/C++ nativo | Máximo controle | ~40 MB | Alta; reescreve UI | Só se quiser abandonar React |
| C#/WinUI | Bom no Windows | médio | Média; só Windows | Descartado (perde Mac/Linux) |

**Caminho em duas fases** (decisão sua, seção 5): (A) manter Electron e trocar apenas captura+encode por um addon nativo (WGC → D3D11 → NVENC/AMF/QSV → pacotes RTP entregues ao WebRTC via `RTCRtpScriptTransform`/encoded insertable streams, ou transporte próprio); (B) migrar para Tauri quando o núcleo Rust estiver estável.

### 3.2 Transporte

- **App↔app/servidor:** protocolo UDP próprio estilo Moonlight/Parsec (RTP/FEC Reed-Solomon, NACK seletivo, pacing por frame, IDR sob demanda, sem B-frames, intra-refresh) **ou** WebRTC com encoder externo. Para o menor risco, **começar com WebRTC (libwebrtc/Pion) + encode nativo** e só criar UDP próprio se a medição mostrar necessidade.
- **Web:** WebRTC padrão, H.264 Constrained High como base, HEVC quando o navegador decodificar em hardware, AV1 como bônus.

### 3.3 Servidor / SFU — **LiveKit (Go, baseado em Pion)** como recomendação

| SFU | Pontos fortes | Pontos fracos | Veredito |
|---|---|---|---|
| **LiveKit** | Go/Pion, SDKs prontos (JS, Rust, Swift…), simulcast/SVC/dynacast, TURN embutido, escala horizontal, Cloud opcional | Opinativo | **Recomendado** |
| mediasoup | C++ worker muito rápido, controle fino | Você escreve a sinalização; Node | 2º lugar |
| Janus | Maduro, C | Plugins em C, DX mais difícil | Não |
| Pion puro | Máximo controle | Escrever tudo | Só para o relay "app direto" |

**Duas camadas** (como você pediu): (1) **caminho do app** = SFU sem transcode que repassa pacotes do stream principal; (2) **camada web** = o mesmo SFU, mas com **simulcast** (camada H.264 de compatibilidade + camada principal) para que a web nunca afete o app. Nenhuma transcodificação no caminho quente.

### 3.4 Dados e hospedagem

- **BD:** manter JSON/SQLite para salas fixas. **Só** adicionar Redis quando houver mais de um nó (presença/rooms); ClickHouse só se quiser analytics sério. Não migrar agora (sem problema real).
- **Hospedagem:** o Render Free não serve (sem UDP, hiberna). Recomendo **VPS/bare-metal de rede forte com UDP livre**: Hetzner/OVH para custo; **para latência no Brasil**, um nó em São Paulo (AWS `sa-east-1`, GCP `southamerica-east1`, Oracle ou Magalu Cloud/Locaweb) — mais caro em tráfego de saída, mas é o que mantém RTT < 20 ms. Estratégia de custo: mídia no VPS barato BR/EU + Cloudflare só para estático/sinalização.

---

## 4. Roadmap priorizado

### Quick wins (dias)
| Item | Impacto | Esforço | Risco | Status |
|---|---|---|---|---|
| Espelhar `x-google-start/max-bitrate` na answer | **Alto** (1080p estável) | Baixo | Baixo | ✅ **Feito e medido** |
| Corrigir teste de AIMD quebrado no baseline | Baixo | Baixo | Nenhum | ✅ Feito |
| Ferramenta de benchmark reproduzível (`npm run bench`) | Alto (base de tudo) | Médio | Nenhum | ✅ Feito |
| Preferir **HEVC** quando o espectador decodificar em HW; senão H.264 | Alto (≈-35 ms G2G, +2–3 fps apres. no loopback) | Baixo | Médio (compat. web) | ⏳ Proposto (não implementado) |
| Corrigir docs falsas: "jitter 0 ms" (PERFORMANCE.md) e "até 4K a 60 FPS" (README) | Médio (honestidade) | Baixo | Nenhum | ⏳ Jitter corrigido; **README ainda promete 4K60** |
| Trocar o `TURN_SECRET` fixo do compose | Segurança | Baixo | Nenhum | ✅ Feito (agora obrigatório via env) |

### Médio prazo (semanas)
1. **Addon nativo de captura WGC→NVENC** (hoje o `screen_capture.cpp` é código morto e faz readback na CPU): maior ganho possível em fluidez (elimina o teto de 31–43 fps).
2. **SFU LiveKit/Pion** no lugar do mesh; reduz upload do apresentador de N×bitrate para 1×bitrate.
3. **Overlay de stats no servidor + exportação Prometheus**; testes de rede ruim (`tc netem`/`clumsy`).
4. Modos "Fluidez" vs "Qualidade" realmente distintos (hoje só mudam `degradationPreference`).

### Estrutural (meses)
1. Núcleo Rust (captura + encode + transporte) e migração para Tauri.
2. Protocolo UDP próprio com FEC adaptativo, se a medição justificar.
3. Controle remoto (teclado/mouse/gamepad), HDR/10-bit (HEVC Main10/AV1), multi-região.

---

## 5. Pendências e decisões suas

1. **Escopo da reescrita:** manter Electron (rápido, teto ~43 fps de captura) ou investir em captura/encode nativos (semanas, ganho grande)? Eu recomendo o nativo.
2. **Hospedagem:** pagar um VPS/nó em São Paulo? (custo mensal + banda de saída). Sem isso, sem UDP próprio e sem SFU.
3. **HEVC como padrão:** aceita perder compatibilidade em navegadores sem decode HEVC (Firefox, parte do Chrome/Linux)? Sugestão: HEVC no app, H.264 na web.
4. **Gravar sessões reais de FPS** (CS2/Valorant/Warzone) para validar qualidade de imagem com VMAF; eu não tenho esses jogos aqui.
5. **Medir o Electron empacotado:** esta máquina não tem Visual Studio nem `electron.exe`; recomendo rodar `npm run bench` e o `capture-probe.mjs` dentro do app instalado para confirmar os números da seção 2.3.
6. **Segurança:** trocar o `TURN_SECRET` do `docker-compose.yml` antes de qualquer deploy.

## 6. Limites honestos da meta "100% de fluidez"

- **60 fps a partir de um desktop** só existe se o capturador entregar 60 fps. Medido: Chrome entrega 31–43 fps; WGC/DXGI nativo pode chegar a 60, mas **não foi medido aqui**.
- **0 frames dropados** é alcançável em LAN/fibra com a pilha corrigida (medido: `framesDropped=0` em todas as células), mas "fluido" no olho exige apresentação regular; medi 3,6–10,6 % dos intervalos >40 ms mesmo no melhor caso, causados por vsync a 99 Hz + jitter buffer.
- **< 60 ms glass-to-glass** exige remover o jitter buffer do Chromium (60–105 ms no loopback). Só um pipeline próprio de decode (WebCodecs/nativo) consegue isso. No loopback o melhor caso medido foi ~95 ms (HEVC), **sem** contar captura do SO nem rede.
- **Wi-Fi, 4G e TURN** adicionam 20–150+ ms e perda: nenhuma otimização elimina isso; só FEC + bitrate adaptativo reduzem o impacto.
- **VP9/AV1 a 1080p60** dependem de encoder HW (RTX 40/Arc/RDNA3). Esta RTX 3070 só decodifica AV1.

---

## 7. Como reproduzir

```bash
cd client
npm run bench -- --codec H264,H265 --bitrate 15000 --duration 15 --warmup 8
node e2e/bench.mjs --codec H264 --bitrate 15000 --duration 15 --warmup 8 --out ../docs/benchmarks/x.json
node e2e/capture-probe.mjs            # mede getDisplayMedia (abre uma janela do Chrome e captura a tela)
```

Dados brutos: [`docs/benchmarks/matrix-after.json`](benchmarks/matrix-after.json) e [`docs/benchmarks/matrix-before-h264.json`](benchmarks/matrix-before-h264.json).

