# KIARA — Guia de Desempenho e 60 FPS

## Arquitetura do Pipeline de Transmissão

```
[Apresentador]
  captureDisplay()          ← getDisplayMedia (browser) ou DXGI zero-copy (app Windows, com fallback)
       │
  MediaStreamTrack (vídeo, 60 FPS)
       │
  WebRTCBroadcaster
   ├─ setCodecPreferences()  ← por espectador: HEVC se os dois lados têm HW, senão H264 High
   ├─ applySenderParameters()← maxFramerate=60, degradationPreference='maintain-framerate'
   ├─ optimizeSdpForGaming() ← x-google-* GCC, b=TIAS, Opus CBR 192 kbps
   └─ RTCPeerConnection ──── ICE/DTLS/SRTP ──► [Espectador]
                                                  │
                                             WebRTCViewer
                                              ├─ tuneReceivers() ← jitterBufferTarget=0, playoutDelayHint=0
                                              └─ <video> srcObject ← reprodução nativa
```

## Configuração Padrão

| Parâmetro               | Valor padrão | Local de definição                        |
|-------------------------|-------------|-------------------------------------------|
| FPS alvo                | 60          | `webrtcService.ts` `DEFAULT_VIDEO_CONFIG` |
| Resolução padrão        | 1920×1080   | `webrtcService.ts` `DEFAULT_VIDEO_CONFIG` |
| Codec padrão            | `auto` (HEVC se encode e decode forem por hardware, senão H.264) | `codecSelection.ts` `resolveVideoCodec()` |
| Bitrate padrão          | **8000 kbps** | `webrtcService.ts` `DEFAULT_VIDEO_CONFIG` |
| `scalabilityMode` H264  | **L1T1**    | `webrtcService.ts` `applySenderParameters()` — sem B-frames |
| `scalabilityMode` AV1/VP9 | L1T3      | `webrtcService.ts` `applySenderParameters()` — 3 camadas temporais |
| FPS nativo (Electron)   | 60 (default)| `shared_capture.cpp` / `nativeCapture.ts` |
| Bitrate mín. SDP        | 3000 kbps   | `sdpTuning.ts` `DEFAULT_OPTIONS`          |
| Bitrate alvo SDP        | **8000 kbps** | `sdpTuning.ts` `DEFAULT_OPTIONS`        |
| Bitrate máx. SDP        | **16000 kbps** | `sdpTuning.ts` `DEFAULT_OPTIONS`       |
| Opus bitrate            | 192 kbps    | `sdpTuning.ts` `DEFAULT_OPTIONS`          |
| `jitterBufferTarget`    | 0           | `webrtcService.ts` `tuneReceivers()`      |
| `playoutDelayHint`      | 0           | `webrtcService.ts` `tuneReceivers()`      |
| `degradationPreference` | maintain-framerate / balanced (macOS) | `webrtcService.ts` |
| Piso AIMD normal        | **1500 kbps** | `bitrateController.ts` `MIN_BITRATE_BPS` |
| Piso AIMD severo (>15% perda) | **800 kbps** | `bitrateController.ts` `SEVERE_MIN_BITRATE_BPS` |
| Intervalo de stats      | 2 s         | `webrtcService.ts` `onStats()`            |
| Fila TSFN (nativo)      | 4 entradas  | `screen_capture.cpp` `StartCapture()`    |
| Pendentes máx. (nativo) | 2 frames    | `screen_capture.cpp` `DxgiCaptureLoop()` |

> A interface de vídeo foi simplificada: só há 1080p 60 FPS (FHD) e 1440p 60 FPS (2K), FPS fixo em 60, modo `game` e codec automático. Bitrate vai de 1 a 20 Mbps. Os demais valores desta página continuam existindo no código, mas não são mais escolhas do usuário.

## Alterações Realizadas

### 1. `native/src/screen_capture.cpp` (caminho antigo, com cópia pela CPU)

> Este arquivo ficou como alternativa. O app para Windows usa `native/src/shared_capture.cpp` (textura D3D11 compartilhada, sem cópia pela CPU). Detalhes e medições em `docs/AUDITORIA-STREAMING.md`.

**Problemas corrigidos:**
- FPS padrão era **30** — alterado para **60**
- `BlockingCall` bloqueava a thread de captura até o JS processar o frame (latência adicional)
- Textura D3D11 de staging era criada e destruída **a cada frame** (overhead de alocação GPU por ciclo a 60 FPS)
- Fila ThreadSafeFunction sem limite (`0`) — crescimento ilimitado de memória e latência

**Soluções:**
- FPS padrão: 60
- `NonBlockingCall` — a thread de captura nunca bloqueia aguardando o JS
- Textura de staging **reutilizada** entre frames; recriada apenas quando a resolução muda
- Fila TSFN limitada a **4 entradas**
- Backpressure: descarta frames quando há ≥ 2 frames pendentes no JS (evita crescimento de latência)
- Temporização em microssegundos (`std::chrono::microseconds`) para maior precisão
- AcquireNextFrame timeout calibrado ao FPS alvo (`1000/fps - 1` ms)
- `StopCapture()` libera explicitamente a textura de staging antes de destruir o device

### 2. `shared/types/index.ts` + `shared/types/dist/index.d.ts`

**Campos adicionados ao `StreamStats`:**
```typescript
encodedWidth?: number;       // Resolução efetiva codificada
encodedHeight?: number;
framesDropped?: number;      // Frames descartados pelo encoder
framesSent?: number;         // Total de frames enviados
framesDecoded?: number;      // Frames decodificados (receptor)
framesReceived?: number;     // Frames recebidos (receptor)
framesLost?: number;         // Frames perdidos (receptor)
decodeTimeMs?: number;       // Tempo médio de decode por frame
decodeTimeP95Ms?: number;    // P95 do tempo de decode
```

### 3. `client/src/services/statsService.ts`

**Melhorias:**
- Coleta `encodedFrameWidth`, `encodedFrameHeight`, `framesDropped`, `framesSent` do `outbound-rtp`
- Coleta `framesDecoded`, `framesReceived`, `framesDropped`, `totalDecodeTime` do `inbound-rtp` (receptor)
- Calcula tempo médio de decodificação por frame em ms
- Calcula P95 do tempo de decodificação usando janela deslizante de 120 amostras
- `clearPeerSample()` também limpa os mapas de decode time
- `hasUsefulEntries` agora inclui `inbound-rtp` como entrada válida

### 4. `client/src/services/sdpTuning.ts`

**Problemas corrigidos:**
- Detecção de Opus dependia de payload type hardcoded (`111`) — **frágil**
- `tuneVideoBitrateSdp` aplicava `x-google-*` a **todas** as linhas `a=fmtp`, incluindo áudio

**Soluções:**
- Detecção de Opus via `a=rtpmap` (extrai o payload type real do SDP)
- `tuneVideoBitrateSdp` agora segmenta o SDP por seção `m=` e aplica apenas na seção de vídeo
- Remoção de parâmetros duplicados ao reaplicar (idempotência)

### 5. `client/src/components/UI/StatsOverlay.tsx`

**Melhorias:**
- Aceita `targetFps` para mostrar FPS real vs. alvo (ex.: "57 / 60 FPS")
- Cor do FPS varia por atingimento: verde (≥ 93%), amarelo (≥ 75%), vermelho (< 75%)
- Exibe: resolução codificada, perda de pacotes, jitter, frames descartados, frames perdidos no receptor, tempo de decode (avg/P95)
- Indicador de `qualityLimitation` (CPU, Rede, Outro) quando ativo
- Modo minimizado mostra FPS colorido, RTT e perda de pacotes

### 6. `client/src/pages/BroadcastPage.tsx` + `ViewerPage.tsx`

- Passa `targetFps={videoConfig.frameRate}` para `StatsOverlay`

## Como Executar os Testes

```bash
# No diretório client/
npm test

# Ou com vitest diretamente:
npx vitest run

# Modo watch para desenvolvimento:
npx vitest
```

### Suítes de teste incluídas

| Arquivo                                     | Cobertura                                         |
|---------------------------------------------|---------------------------------------------------|
| `statsService.test.ts`                      | parseRTCStats, classifyQuality, métricas estendidas, P95 decode time |
| `bitrateController.test.ts`                 | AIMD, piso, recuperação, amostras intermediárias  |
| `sdpTuning.test.ts`                         | Opus (pt dinâmico), vídeo (somente seção m=video), idempotência |
| `webrtcService.test.ts`                     | orderCodecs, degradation preference, ICE restart  |
| `performance.test.ts`                       | 60 FPS padrão, sustentação 5 min, P95              |

## Diagnóstico em Tempo Real

Abra o painel **Telemetria KIARA** (ícone de gráfico na barra de controles) para monitorar:

- **Taxa de Quadros**: FPS atual vs. alvo (colorido)
- **Resolução Codificada**: confirma que o encoder não reduziu a resolução
- **Vídeo / Áudio**: bitrate em tempo real
- **Latência RTT**: tempo de ida e volta (não é latência ponta a ponta)
- **Perda de Pacotes**: percentual no último intervalo
- **Jitter**: variação no atraso de chegada dos pacotes
- **Frames Descartados**: frames que o encoder descartou por falta de recursos
- **Frames Perdidos (RX)**: frames que o receptor não recebeu
- **Decode (avg / P95)**: tempo médio e P95 de decodificação em ms

### Identificando a causa de quedas de FPS

| Sintoma                                    | Causa provável                    | Ação                                      |
|--------------------------------------------|-----------------------------------|-------------------------------------------|
| FPS baixo + `qualityLimitation: cpu`       | CPU sobrecarregada                | Reduzir resolução ou FPS alvo             |
| FPS baixo + `qualityLimitation: bandwidth` | Rede insuficiente                 | Reduzir bitrate ou resolução              |
| FPS normal, frames descartados alto        | Encoder congestionado             | Verificar uso de CPU/GPU                  |
| FPS OK, decode time alto (> 10ms)          | GPU do receptor lenta             | Verificar aceleração por hardware         |
| Perda de pacotes > 1%                      | Problemas de rede                 | Usar TURN, verificar Wi-Fi                |
| Jitter alto (> 30ms)                       | Rede instável                     | Usar conexão cabeada                      |
| RTT > 150ms na LAN                         | Rede lenta ou TURN ativo          | Verificar roteamento ICE                  |
| FPS real < FPS configurado                 | Hardware não suporta              | Normal em hardware limitado               |

## Limitações Conhecidas

### Por que 60 FPS pode não ser atingido

1. **Hardware de captura**: `getDisplayMedia` no navegador tem precisão limitada — muitos sistemas entregam 30 FPS mesmo quando 60 é solicitado. A chamada `applyConstraints()` após a captura tenta forçar o FPS, mas não há garantia.

2. **macOS VideoToolbox**: O encoder H.264 no macOS prefere `balanced` ao invés de `maintain-framerate` porque o VideoToolbox tolera melhor oscilações mistas de fps+resolução do que resolução travada em alta carga.

3. **WebRTC GCC (Google Congestion Control)**: O controle de congestionamento do WebRTC pode reduzir o bitrate em movimentos de tela rápidos, que são interpretados como aumento de carga de rede. Os parâmetros `x-google-min-bitrate` e `x-google-start-bitrate` mitigam isso.

4. **Modo Electron (nativo)**: a captura zero-copy (`shared_capture.cpp`) evita a cópia pela CPU, mas só vale para tela inteira no Windows. Janelas, monitor girado, HDR e falhas de inicialização caem no `getDisplayMedia`, que tem o teto de FPS descrito no item 1. Não foi medida no app empacotado.

5. **Resolução 4K**: A 3840×2160 @ 60 FPS, o custo de captura e codificação é alto. Recomenda-se reduzir para 1080p ou 1440p em hardware médio.

6. **Rede com perda de pacotes**: Em redes com > 2% de perda, o `BitrateController` reduz o bitrate, o que pode causar queda de qualidade e FPS.

### Latência ponta a ponta

A **latência ponta a ponta** (da tela capturada até ser exibida no espectador) inclui:
- Captura: 1–5ms (DXGI) ou variável (getDisplayMedia, depende do SO)
- Codificação: 2–8ms (hardware) ou 10–30ms (software)
- Rede (RTT/2): metade do RTT reportado
- Decodificação: 1–5ms (hardware)
- Renderização: 1 frame / frequência do monitor (ex.: ~16ms a 60Hz)
- Buffer de jitter: alvo configurado para 0 ms, mas o Chromium ainda acumula ~60-105 ms de atraso médio medido no loopback (ver docs/AUDITORIA-STREAMING.md)

**Em LAN com hardware moderno**: < 100ms é alcançável.  
**Em WAN ou com TURN**: 150–400ms é típico.

O RTT reportado na telemetria é o tempo de ida **e volta**, aproximadamente o dobro da latência de rede unidirecional.

## Requisitos de Rede (Upload do Apresentador)

O KIARA envia **um fluxo por espectador conectado** — o consumo de upload escala linearmente.

### Margem recomendada: 1,5× o bitrate configurado

Reserve essa margem para absorver oscilações de rede sem saturar o uplink:

| Bitrate configurado | Upload estimado (1 espectador) | **Upload recomendado disponível** |
|---|---|---|
| 5 Mbps | 5 Mbps | **7,5 Mbps** |
| 8 Mbps (padrão) | 8 Mbps | **12 Mbps** |
| 12 Mbps | 12 Mbps | **18 Mbps** |
| 20 Mbps | 20 Mbps | **30 Mbps** |

> Esses são valores de orientação, não requisitos absolutos. Conexões com QoS ou baixa variância podem operar bem com menos margem.

### Múltiplos espectadores

O upload se multiplica pelo número de espectadores. Com 3 espectadores a 8 Mbps:

- Upload usado: **24 Mbps**
- Upload recomendado disponível: **36 Mbps**

A interface não mostra mais essa estimativa; use a tabela acima como referência.

> **Nota sobre servidores de mídia:** Esta estimativa vale para o modo P2P (WebRTC direto). Se no futuro o servidor atuar como SFU/MCU distribuindo o fluxo, o apresentador envia apenas **um fluxo ao servidor** e o consumo de upload se torna fixo, independente do número de espectadores.

## Requisitos de Hardware Recomendados para 60 FPS

| Componente | Mínimo (720p 60fps) | Recomendado (1080p 60fps) | Ideal (1440p 60fps) |
|---|---|---|---|
| CPU | Intel i5 8ª gen / Ryzen 5 2000 | Intel i7 10ª gen / Ryzen 7 3000 | Intel i9 / Ryzen 9 |
| GPU | Intel UHD 630 / Radeon RX 560 | NVIDIA GTX 1060 / Radeon RX 580 | NVIDIA RTX 2060+ |
| RAM | 8 GB | 16 GB | 32 GB |
| Rede | 12 Mbps upload (1,5× de 8 Mbps) | 18 Mbps upload (1,5× de 12 Mbps) | 30 Mbps upload (1,5× de 20 Mbps) |
| Monitor | 60 Hz | 60 Hz | 120+ Hz |

## Dependências de Build (Módulo Nativo)

O módulo nativo (`native/`) requer:

```
node-gyp
Windows: Visual Studio Build Tools + Windows SDK
```

O módulo usa:
- **Windows**: DXGI Desktop Duplication API (d3d11, dxgi1_2) para vídeo e WASAPI Process Loopback para áudio por aplicativo
- **Linux**: Stub — usar `getDisplayMedia` no navegador
- **macOS**: vídeo não suportado pelo módulo nativo (usar `getDisplayMedia`); áudio por aplicativo via ScreenCaptureKit, ainda sem validação da captura ao vivo

