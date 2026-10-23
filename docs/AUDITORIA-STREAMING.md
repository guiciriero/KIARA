# KIARA — Auditoria de Streaming 1080p60 de baixa latência

Branch: `audit/streaming-1080p60` · Data: auditoria feita sobre `d6fc1cd` · Máquina de teste: Ryzen 5 5600, RTX 3070 (NVENC/NVDEC), Windows, Ethernet 1 Gbps, monitor 2560x1440@99 Hz, Chrome 156.

> **Leia primeiro (limites honestos da medição).** Os benchmarks abaixo rodam em **Chrome real, loopback na mesma máquina e mesma página**. Medem bem: encode, bandwidth-estimation (GCC), pacing do WebRTC, jitter buffer, decode e apresentação. **Não medem:** captura de tela do SO, o app Electron empacotado (os PoCs da seção 4.2 rodam no Electron 44.7.2 avulso, não no instalador empacotado), rede real, Wi-Fi, TURN nem Brasil↔exterior. "100% de fluidez" depende de hardware e rede; a seção 6 diz onde estão os limites.

---

## 0. Resumo executivo

1. **O app desktop hoje é Electron + `getDisplayMedia` + WebRTC P2P mesh.** Ele NÃO usa captura DXGI zero-copy nem encode nativo. O módulo C++ de vídeo (`native/src/screen_capture.cpp`) **está compilado e empacotado, mas nunca é chamado** (nenhum `startCapture`/`listCaptureSources` em `desktop/` ou `client/`). Só o áudio por aplicativo (WASAPI) é realmente usado. **Atualização:** agora existe também `shared_capture.cpp` (DXGI zero-copy), ainda não ligado ao app; PoC medido na seção 4.2 (captura→encode 50 → 60 fps).
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

### 2.3b Experimento: WGC por flag do Chromium (descartado)

O `chrome.dll` 156 contém `WgcCapturerWin` e a feature `WebRtcAllowWgcUsingTexture`. Rodei o mesmo `capture-probe.mjs` com `PROBE_FLAGS="--enable-features=WebRtcAllowWgcUsingTexture"`:

| Cenário | Base (sem flag, esta rodada) | Com a flag |
|---|---|---|
| 1080p60 `none` | 38,1 fps (p99 34 ms) | **21,4 fps (p99 529 ms)** |
| 1080p60 `crop-and-scale` | 31,9 fps | 30,9 fps |
| 1440p60 `none` | 31,4 fps | 31,9 fps |

A flag não melhorou nada e piorou a cauda no primeiro cenário (uma rodada cada; não repeti). Conclusão: não há atalho por flag; o teto de ~31–43 fps do `getDisplayMedia` continua. (Dados: `docs/benchmarks/capture-base.txt`, `capture-wgctex.txt`.)

### 2.4 Hardware encode confirmado

`nvidia-smi` durante o teste: H.264 e HEVC = **NVENC 14–22%**; VP9/AV1 = **NVENC 0%** (encode em CPU). NVDEC 10–27% em todos.

---

### 2.5 Codec automático (HEVC com fallback H.264) — antes/depois

Implementado em `client/src/services/codecSelection.ts` + `webrtcService.ts`. O padrão deixou de ser `H264` e passou a ser `auto`:

1. O espectador consulta `MediaCapabilities.decodingInfo({type:'webrtc'})` (1080p60, 15 Mbps) e envia `hwDecode` (ex.: `['H265','H264','AV1','VP9']`) em `room:join`. O servidor valida/filtra (só codecs conhecidos, sem repetição, máx. 16) e repassa em `room:viewer-joined`.
2. O apresentador consulta `encodingInfo` uma vez e, **por espectador**, escolhe `H265` somente se encode **e** decode forem `supported && smooth && powerEfficient`; caso contrário `H264`. Se o espectador não informar (cliente antigo, API ausente, timeout de 1,5 s), usa `H264`.
3. Com HEVC escolhido, as preferências ficam `H265, H264, …`, então um espectador que na prática não negocie HEVC cai em H.264 e não em VP8.
4. A escolha manual no `VideoConfigPanel` (agora com a opção "Automático") é respeitada sem alteração.

Medido neste Chrome 156 / RTX 3070: `encodingInfo` e `decodingInfo` reportam HEVC como `powerEfficient=true` (e AV1 só em decode; VP9/AV1 encode = `false`, o que bate com o NVENC 0% da seção 2.4).

Benchmark (1080p60, pedido 15 Mbps, 15 s, `bench.mjs`; 3 rodadas por modo, dados em `docs/benchmarks/codec-auto*.json`):

| Modo | Codec negociado (3/3) | G2G p50 (ms) | G2G p95 (ms) | Encode (ms) | FPS apresentado | Freezes / drops |
|---|---|---|---|---|---|---|
| H264 manual | H264 | 164, 127, 128 | 176, 146, 146 | 6,5 / 5,1 / 5,1 | 44,5 / 47,9 / 47,4 | 0 / 0 |
| H265 manual | H265 | 93, 109, 109 | 113, 116, 114 | 4,8 / 4,4 / 4,3 | 50,0 / 49,9 / 47,4 | 0 / 0 |
| **auto** | **H265 (3/3)** | 110, 93, 101 | 115, 111, 115 | 4,7 / 4,3 / 4,4 | 48,6 / 48,1 / 48,0 | 0 / 0 |

Leitura: `auto` negociou HEVC em 3/3 e ficou no nível do HEVC manual; frente ao H.264, a latência p50 caiu cerca de 20–35 ms (a primeira rodada de H.264, 164 ms, é a mais alta; as outras duas ficaram em ~128 ms). O bitrate real variou bastante entre rodadas (H.264 4,6–6,9 Mbps; HEVC 7,8–13,3 Mbps), então **não comparei qualidade de imagem**: HEVC pode estar usando mais bits na mesma cena.

Limites: (a) o benchmark roda encode e decode no **mesmo** Chrome/GPU, então o caminho de fallback (espectador sem HEVC) só está coberto por testes unitários (`codecSelection.test.ts`, `webrtcService.codecAuto.test.ts`: 18 testes), não por um segundo navegador real; (b) o **Electron 44 empacotado não foi medido**: se o Chromium dele não oferecer HEVC por hardware, a detecção devolve `[]`/`undefined` e o resultado é H.264 (comportamento seguro, mas sem o ganho); (c) `powerEfficient` é um indicador do navegador, não prova de uso da GPU; (d) Firefox/Safari como espectador não foram testados.

### 2.6 Servidor/sinalização: o que mudou

`JoinRoomPayload.hwDecode?` e `ViewerJoinedPayload` em `shared/types`; `sanitizeHwDecode` em `validators.ts`; mapa `socketHwDecode` no `signalingHandler.ts` (limpo na desconexão, como o de apelidos). `ALLOWED_VIDEO_CODECS` do `sanitizeStreamConfig` passou a aceitar `'auto'`. Servidor: 84/84 testes (2 novos).

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
| Preferir **HEVC** quando o espectador decodificar em HW; senão H.264 | Alto (≈-20 a -35 ms G2G, +1–3 fps apres. no loopback) | Baixo | Médio (compat. web) | ✅ **Feito e medido** (seção 2.5); falta medir no Electron empacotado |
| Corrigir docs falsas: "jitter 0 ms" (PERFORMANCE.md) e "até 4K a 60 FPS" (README) | Médio (honestidade) | Baixo | Nenhum | ✅ Feito (README agora fala em alvo 1080p60 e aponta para este relatório) |
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

### 4.1 Captura nativa de vídeo: toolchain (RESOLVIDO)

Na primeira verificação o `node-gyp configure` falhou (sem workload C++ nem Windows SDK; não escrevi C++ às cegas). Depois que você instalou a workload "Desenvolvimento para desktop com C++", `npx node-gyp rebuild` em `native/` compila (MSVC 14.51.36231, Windows SDK 10.0.26100.0) e o `.node` exporta as funções esperadas. Observação: `node-gyp build` incremental deu `LNK1103` (objeto corrompido); use sempre `rebuild`.

### 4.2 Captura nativa: resultados medidos (E0–E4)

Todas as medições: RTX 3070, Ryzen 5 5600, monitor 0 = 2560x1440@99 Hz, página animada em rAF (barra vermelha em `n*29 mod largura`), Electron 44.7.2 (Chromium 152) onde indicado. Scripts em `client/e2e/`.

**E0 — toolchain:** ok (acima).

**E1 — captura DXGI nativa existente (com readback CPU)**
- *Bug encontrado:* no monitor 0 todos os frames vinham **pretos**. Causa medida: o 1º frame da duplicação tem `LastPresentTime==0` e formato `R16G16B16A16_FLOAT` (sem imagem), e o código o enviava como se fosse BGRA. O rótulo `format:"bgra"` era fixo, mesmo para outros formatos. Corrigido: frames sem imagem são descartados e o frame expõe `dxgiFormat`/`hasImage`.
- *Teto de ~31 fps:* a causa era o **timer do Windows a 15,6 ms** (`sleep_until` arredonda para 2 ticks = ~31 ms), mais deriva por usar `frameStart` de "agora" a cada ciclo. Correção: `timeBeginPeriod(1)` + prazo absoluto. Evidência: **30,2–31,4 → 54–55 → 57,7 callbacks/s** (3 execuções, intervalo p50 16,6 ms, p99 ~21 ms).
- Linha de base nativa válida (barra decodificada, 100 % dos frames distintos): **57,7 fps reais**, mas ~850 MB/s copiados para o JS e ~80 % de um núcleo do Node. Dados: [`benchmarks/native-dxgi-after.json`](benchmarks/native-dxgi-after.json).

**E2 — o que o Windows consegue entregar (WGC standalone, `GraphicsCaptureSession`, sem readback)**
| Configuração | fps medido | intervalo p50 |
|---|---|---|
| WGC padrão | 49,8–50,0 | 20 ms |
| WGC + CopyResource GPU→GPU | 50,0 | 20 ms |
| WGC com `MinUpdateInterval=0` | **99,8–99,9** (= refresh do monitor) | 10 ms |
| WGC com `MinUpdateInterval=16,6 ms` | 50,0 | 20 ms |
Leitura: o WGC padrão é limitado a ~50 fps nesta tela (99 Hz); com `MinUpdateInterval` o teto sobe ao refresh. **Hipótese não verificada:** o `getDisplayMedia` do Chromium usa WGC com intervalo padrão, o que explicaria o teto ~50 no Electron.

**Captura do Electron 44 (`getDisplayMedia` via `desktopCapturer`, o caminho que o app usa)** — [`e2e/electron-capture-probe.cjs`](../client/e2e/electron-capture-probe.cjs):
- 1080p60: **48,5–50,0 fps** em 3 de 4 execuções (2 delas com ~49,8); numa sequência posterior caiu para **~31,7–32 fps** e para **38,7–39,3 fps** a 1440p. Ou seja, a captura do Electron **oscila entre ~32 e ~50 fps** entre execuções; **não identifiquei a causa dessa variação** (nenhum processo órfão; suspeita não confirmada: estado do compositor/MPO/ocultação da janela). O Chrome 156 deu 31–43 fps.

**Captura DXGI zero-copy implementada** (`native/src/shared_capture.cpp`, funções `startSharedCapture/releaseSharedFrame/stopSharedCapture`): cada frame é copiado GPU→GPU para uma textura BGRA compartilhada (NT handle) de um anel de 4 slots; o JS recebe só o handle (8 bytes). Sem readback, sem `memcpy` de 15 MB por frame. Mede **60,0 fps** de entrega ao renderer (`gotFramesPerSec` 59,4–60,1, 0–5 descartes em ~670).

**E3 — encode nativo por Media Foundation: NÃO implementado.** Decisão técnica registrada abaixo (E4): o Chromium já codifica por hardware (`MediaFoundationVideoEncodeAccelerator`, "NVIDIA H.264/HEVC Encoder MFT", medido) a 4,7–7,3 ms/frame, então um encoder nativo próprio não acrescenta nada enquanto o transporte for o `RTCPeerConnection`, que não aceita frames já codificados.

**E4 — ligação ao WebRTC (opção "a"): PROVADA em protótipo** — [`e2e/electron-native-poc.cjs`](../client/e2e/electron-native-poc.cjs). Pipeline: addon (DXGI→textura compartilhada) → `sharedTexture.importSharedTexture` (main) → `sendSharedTexture` → `getVideoFrame()` (renderer, textura na GPU) → `MediaStreamTrackGenerator` → `RTCPeerConnection` loopback (encode/decode do Chromium). Funciona com `contextIsolation:true` e `sandbox:true` (as mesmas flags do `desktop/src/main.js`). Nenhum erro de transferência (`sendErrors=0`).

Comparação no mesmo harness, 1080p60, 15 Mbps pedido, H.265 (`--scale=1.3333` no nativo porque a captura é 2560x1440; no `gdm` o Chromium já reduz para 1080p), 3 pares alternados:

| Origem | fps de captura→encode | fps apresentado (rVFC) | encode ms | freezes |
|---|---|---|---|---|
| `getDisplayMedia` | **49,4 / 50,0 / 50,0** | 42,1 / 43,0 / 42,4 | 5,5–6,0 | 0 |
| Nativa zero-copy | **60,1 / 60,0 / 60,1** | 45,2 / 44,4 / 44,9 | 5,7–6,2 | 0 |

- **Ganho medido na captura/encode: ~50 → 60 fps (+20 %)**, estável, com o mesmo encoder por hardware.
- **O fps apresentado no espectador subiu só ~42 → ~45**, e não 60. Os intervalos apresentados ficam em 30 ms (p50) em várias execuções (mas 10 ms em outras), o que aponta para a **cadência de apresentação da janela de teste** (vsync/compositor com a janela pequena e parcialmente coberta), **não** para a captura. Não consegui isolar essa causa; o `shownFps` deste harness não deve ser lido como o fps do espectador real.
**G2G (vidro-a-vidro) medido: nativo vs `getDisplayMedia`** — mesmo harness, 1080p60, 15 Mbps, 3 execuções alternadas por célula (a página desenha o ID do frame em blocos; o espectador lê o ID de volta; relógio comum). Dados: [`benchmarks/native-vs-gdm-g2g.jsonl`](benchmarks/native-vs-gdm-g2g.jsonl).

| Codec | Origem | G2G p50 (3 execuções, ms) | fps de encode |
|---|---|---|---|
| H.264 | nativa zero-copy | 36,3 / 47,5 / 45,8 | 58,5–60,1 |
| H.264 | `getDisplayMedia` | 57,6 / 66,3 / 68,0 | 49,4–49,9 |
| H.265 | nativa zero-copy | **126,3** / 46,6 / 47,0 | 56,2–60,0 |
| H.265 | `getDisplayMedia` | 66,2 / 87,4 / 88,5 | 49,7–49,8 |

- A mediana do G2G ficou ~20 ms menor no caminho nativo (H.264: ~46 vs ~64 ms; H.265: ~47 vs ~87 ms, ignorando um outlier). **Uma das 12 execuções (nativo/H.265, 126 ms) foi um outlier que não expliquei**; incluí na tabela. Isso é loopback na mesma máquina, sem rede, e o G2G depende da leitura do ID no espectador, que tem custo próprio (quando essa leitura é feita também no lado da captura, o G2G sobe, ver "limites" abaixo).
- Cursor: o addon desenha o cursor (o DXGI não o inclui). Medi 3 pares com/sem: p50 28–47 ms com cursor e 48–58 ms sem; a diferença não é consistente o bastante para atribuir ao cursor, então **não concluo nada sobre custo do cursor**.

**Integração ao app — feita.** Fluxo: `captureService.captureDisplay` → se `window.screenShareHost.nativeCapture` existe, o desktop é Windows e a fonte é tela inteira (ou padrão), usa a captura nativa; qualquer falha (addon ausente, monitor rotacionado, HDR/formato não-BGRA8, sem frames em 3 s) cai no `getDisplayMedia`. Peças:
- `native/src/shared_capture.cpp`: anel de 6 slots, cursor, seleção do monitor por coordenadas (casa com `desktopCapturer`), recuperação de `DXGI_ERROR_ACCESS_LOST` por até ~20 s, aviso de fim (`access-lost`, `resolution-changed`, `unsupported-format`, `acquire-failed`), recusa de monitor rotacionado.
- `desktop/src/nativeCapture.js` (+ IPC `native-capture:*` em `main.js`, parada em navegação/fechamento/atualização) e `preload.js` (`screenShareHost.nativeCapture`).
- `client/src/services/nativeCapture.ts`: textura → `VideoFrame` → `MediaStreamTrackGenerator`, descarta frame quando o pipeline atrasa, repete o último frame após 250 ms de tela parada, reinicia até 2 vezes após `access-lost`/`resolution-changed`, `track.stop()` encerra o addon.
- `webrtcService.ts`: `computeScaleDown` reduz 1440p→1080p no sender (`scaleResolutionDownBy`) pelo tamanho real da captura.
- Interruptor para desligar: `localStorage['kiara:nativeCapture']='0'`.

**Medição do caminho real do app** (`client/e2e/electron-app-integration.cjs`: `main` real + `preload.js` real com `contextIsolation`+`sandbox`, `captureDisplay()` do cliente, 3 pares alternados, 8 s). Dados: [`benchmarks/app-integration-fps.json`](benchmarks/app-integration-fps.json).

| Origem | fps apresentado (3 exec.) | intervalo p99 | início da captura |
|---|---|---|---|
| Nativa | **59,9 / 60,0 / 58,7** | 30–40 ms | ~200 ms |
| `getDisplayMedia` | 49,6 / 49,8 / 49,7 | 40–50 ms | ~1,0–1,1 s |

Aqui o espectador (um `<video>` na mesma janela) apresentou ~60 fps com a nativa, contra ~50 com o `getDisplayMedia`, e a captura inicia 5× mais rápido. Isto mede captura→apresentação da faixa local, **não** a cadeia WebRTC completa dentro do app (que o PoC acima cobre).

**Limites que continuam valendo:** só Windows (macOS segue com `getDisplayMedia`); só tela inteira (janelas usam `getDisplayMedia`); HDR/10 bits e monitor rotacionado caem no fallback; jogos em tela cheia exclusiva e vários adaptadores/GPUs híbridas não foram testados; sincronia A/V com o áudio WASAPI não foi medida; **não rodei o app empacotado** (`electron-builder`), só o Electron 44.7.2 avulso com os mesmos arquivos `main`/`preload`; o Electron `getDisplayMedia` oscilou entre ~32 e ~50 fps em outras execuções, então a vantagem de "+10 fps" é medida contra o caso bom dele.
## 5. Pendências e decisões suas

0. **Captura nativa integrada ao app** (seção 4.2), ligada por padrão no Windows com fallback automático para `getDisplayMedia` e interruptor `localStorage['kiara:nativeCapture']='0'`. Decida se mantém ligada por padrão depois de testar o app empacotado e jogos reais (tela cheia exclusiva, HDR, GPU híbrida).
1. **Escopo da reescrita:** manter Electron (rápido, teto ~43 fps de captura) ou investir em captura/encode nativos (semanas, ganho grande)? Eu recomendo o nativo.
2. **Hospedagem:** pagar um VPS/nó em São Paulo? (custo mensal + banda de saída). Sem isso, sem UDP próprio e sem SFU.
3. **HEVC como padrão:** já implementado como modo `auto` (seção 2.5), com H.264 de fallback por espectador. Decida se mantém `auto` como padrão ou volta a H.264 fixo; a escolha manual continua no painel.
4. **Gravar sessões reais de FPS** (CS2/Valorant/Warzone) para validar qualidade de imagem com VMAF; eu não tenho esses jogos aqui.
5. **Medir o Electron empacotado:** medi o Electron 44.7.2 avulso (captura e PoC); rode `npm run bench` e o `capture-probe.mjs` dentro do app instalado para confirmar as seções 2.3 e 2.5. No Electron avulso o encoder foi `MediaFoundationVideoEncodeAccelerator` (NVIDIA H.264/HEVC MFT), isto é, o HEVC por hardware funciona lá.
6. **Segurança:** trocar o `TURN_SECRET` do `docker-compose.yml` antes de qualquer deploy.

## 6. Limites honestos da meta "100% de fluidez"

- **60 fps a partir de um desktop** só existe se o capturador entregar 60 fps. Medido: Chrome 156 entrega 31–43 fps; o Electron 44 oscilou entre ~32 e ~50 fps; a captura DXGI nativa entregou 57,7 fps (com readback) e 60 fps (zero-copy, PoC); WGC standalone chega a 99,8 fps com `MinUpdateInterval=0` (seção 4.2).
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
node e2e/native-capture-bench.mjs --duration 8   # captura DXGI nativa (precisa de native/build; node-gyp rebuild)
# Electron avulso (npm i electron@44.7.2 num diretório temporário; não é dependência do client):
<electron.exe> e2e/electron-capture-probe.cjs --secs=6
<electron.exe> e2e/electron-native-poc.cjs --source=native --codec=H265 --scale=1.3333 --isolated=1 --secs=8   # --source=gdm compara com getDisplayMedia
```

Dados brutos: [`docs/benchmarks/matrix-after.json`](benchmarks/matrix-after.json) e [`docs/benchmarks/matrix-before-h264.json`](benchmarks/matrix-before-h264.json).

