# native/ — módulo nativo `screen_capture` (Windows)

Addon N-API (`node-addon-api`, `NAPI_VERSION=8`) que captura vídeo (DXGI) e áudio por
aplicativo (WASAPI process loopback). Carregado pelo processo principal do Electron em
`resources/native/screen_capture.node`.

## Requisitos

**Windows (único alvo funcional)**
- Windows 10 2004+ / 11 (build 19041+ para o loopback de áudio por processo).
- Visual Studio com workload "Desenvolvimento para desktop com C++" (MSVC + Windows SDK).
- Python 3 (usado pelo node-gyp) e Node.js 22 (o mesmo do CI).

**macOS**
- Os fontes de captura de áudio/vídeo para macOS (`.mm`, ScreenCaptureKit) exigem Xcode
  Command Line Tools (`xcode-select --install`) e macOS 13+.
- O app desktop distribuído é só Windows; no Mac o addon serve apenas para desenvolvimento.

## Como compilar

```bash
cd native
npm install --ignore-scripts   # evita o node-gyp rebuild automático do npm
npm run build                  # gera build/Release/screen_capture.node
```

- Windows: use o `node-gyp` local (devDependency) — o embutido no npm antigo não reconhece
  versões novas do Visual Studio.
- macOS: o mesmo comando; requer as ferramentas do Xcode.
- Por ser N-API (ABI estável), não é preciso recompilar para a versão do Electron.
- O `.node` compilado é empacotado por `desktop/electron-builder.yml` (`extraResources`).

## Testes

**Não existem testes unitários C++ neste módulo.** A validação hoje é manual, em uma
máquina Windows real (captura de tela + áudio de um aplicativo).

Lista do que deveria ser coberto (por ordem de risco):
1. **Ring buffer de áudio**: escrita/leitura com wrap-around, overflow (descarte controlado),
   underflow, produtor e consumidor em threads distintas.
2. **Ciclo de vida de threads**: start/stop repetidos, stop durante captura, destruição do
   objeto sem deadlock, sem callbacks após `stop`.
3. **Validação de PIDs**: PID 0, inexistente, já encerrado, reutilizado, de outro usuário.
4. **Tratamento de HRESULT**: propagação de falhas de `ActivateAudioInterfaceAsync`,
   dispositivo removido (`AUDCLNT_E_DEVICE_INVALIDATED`), perda de acesso DXGI
   (`DXGI_ERROR_ACCESS_LOST`) e conversão em erros JS legíveis.
