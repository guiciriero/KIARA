# e2e em Chrome real

Valida, num navegador de verdade, o que os testes unitários só cobrem com fakes:
troca de áudio em runtime sem renegociar o WebRTC, `replaceVideoTrack`, mute/unmute,
`getStats()` reais e a conexão WebRTC ponta a ponta (host ⇄ espectador na mesma página).

## Como rodar

```bash
cd client
npm run e2e                                   # detecta o Chrome automaticamente
CHROME_PATH=/caminho/do/chrome npm run e2e    # Chrome em outro lugar
```

Ordem de busca do Chrome: `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, depois no `PATH`
`google-chrome-stable`, `google-chrome`, `chromium`, `chromium-browser`, e por fim
`/Applications/Google Chrome.app` (macOS).

- Fora do `npm test`. Duração ≈ 15–20 s.
- Código de saída: `0` tudo certo, `1` algum cenário falhou, `2` Chrome não encontrado.
- O bundle (esbuild) vai para `e2e/.build/` (ignorado pelo git); o servidor escuta só em `127.0.0.1`
  e o perfil do Chrome é temporário (apagado ao final). `--no-sandbox` só é usado com `CI=true`.

## O que cobre

Conexão, troca A→B→A, A+B, mute/unmute (sem reiniciar a captura), `sync([])`,
`replaceVideoTrack` (cor do vídeo remoto + áudio contínuo), `onStats`/`getStats`/`getParameters`,
falha controlada de `host.audio.start`, `destroy` (faixas `ended`, `AudioContext` fechado, listeners
alheios preservados) e ICE restart (falha simulada). O áudio é medido no espectador via FFT.

## O que NÃO cobre

- Áudio real do sistema / captura nativa (o host é falso e gera PCM sintético).
- Electron (preload, protocolo `app://`, CSP).
- Rede real, NAT e TURN (ambos os pares estão na mesma máquina/página).
- Tela real via `getDisplayMedia` (o vídeo vem de `canvas.captureStream`).
- No ICE restart a falha é simulada (`defineProperty` no pc), não há queda de rede real.
