# Avisos de software de terceiros

O código do KIARA é distribuído sob a licença MIT (veja [`LICENSE`](LICENSE)). Esta página lista os
componentes de terceiros que acompanham o app e o site, cada um sob a sua própria licença. Ela é um
resumo de boa-fé, não substitui os textos originais de cada projeto.

## O que vai dentro do instalador do Windows

| Componente | Licença | Observação |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | O instalador inclui `LICENSE.electron.txt` e `LICENSES.chromium.html`, gerados pelo electron-builder |
| [Chromium](https://www.chromium.org/chromium-os/licensing-and-credits/) (dentro do Electron) | BSD-3-Clause e licenças de seus componentes | Lista completa em `LICENSES.chromium.html`, na pasta do app instalado |
| [cloudflared](https://github.com/cloudflare/cloudflared) | Apache-2.0 | Binário oficial baixado da release do GitHub, com SHA-256 conferido (`desktop/scripts/prepare-resources.mjs`) |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | Atualização automática |
| Servidor embutido (`server.cjs`) | MIT, ISC, Apache-2.0, BSD | Express, Socket.IO, Helmet, Winston e dependências, empacotados com esbuild |
| [node-addon-api](https://github.com/nodejs/node-addon-api) | MIT | Usado pelo módulo nativo `screen_capture.node` |
| Site (`client/dist`) | MIT, ISC, Apache-2.0 | React, React Router, Socket.IO client e dependências, empacotados com Vite |

## Site

As fontes **Inter** e **JetBrains Mono** (SIL Open Font License 1.1) são carregadas do Google Fonts
em `client/index.html`; não ficam dentro do repositório nem do instalador.

## Dependências de desenvolvimento

Não são distribuídas ao usuário final. Pelos `package-lock.json`, são em sua maioria MIT, ISC, BSD,
Apache-2.0 e BlueOak-1.0.0. As exceções encontradas:

| Pacote | Licença | Onde |
|---|---|---|
| `lightningcss` (e binários por plataforma) | MPL-2.0 | Só desenvolvimento do `server/` (via Vitest/Vite). Não é modificado nem distribuído |
| `caniuse-lite` | CC-BY-4.0 | Só desenvolvimento do `client/` |
| `argparse` | Python-2.0 | Desenvolvimento do `client/`; no `desktop/` aparece como dependência de produção (via `js-yaml`, usado pelo `electron-updater`) e pode ir no instalador. A licença é permissiva, mas exige manter o aviso |
| `sanitize-filename`, `truncate-utf8-bytes`, `utf8-byte-length` | WTFPL (ou ISC/MIT) | Só desenvolvimento do `desktop/` (electron-builder) |
| `tslib` | 0BSD | Só desenvolvimento do `desktop/` |

Os totais acima refletem os lockfiles na data desta revisão e podem mudar. Para conferir de novo
antes de uma release, rode `npx license-checker --production` em `server/`, `client/` e `desktop/`.

## Serviços de terceiros usados em tempo de execução

STUN público do Google e da Cloudflare (`rtcConfig.ts`, `iceServers.ts`) e, opcionalmente, TURN
próprio (coturn) ou Cloudflare Realtime TURN. Cada um segue os termos de uso do respectivo provedor.
