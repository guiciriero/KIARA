# 🖥️ ScreenShare — Compartilhamento de Tela em Tempo Real

Aplicação completa de compartilhamento de tela com captura de áudio por aplicativo individual, transmissão P2P via WebRTC e interface web responsiva — semelhante ao recurso de compartilhamento de tela do Discord.

---

## ✨ O que o aplicativo faz

| Funcionalidade | Detalhes |
|---|---|
| **Captura de vídeo** | Até 4K (3840×2160), 60 FPS, codecs H.264 / VP9 / H.265 |
| **Captura de áudio** | No app desktop: por aplicativo — WASAPI Process Loopback (Windows 10 2004+) / ScreenCaptureKit (macOS 13+). No navegador: áudio do sistema inteiro |
| **Transmissão WebRTC** | Peer-to-peer com fallback STUN/TURN, múltiplos espectadores simultâneos |
| **Sinalização** | Node.js + Socket.IO com reconexão automática |
| **Código de convite** | Código de 6 dígitos gerado automaticamente, copiável com um clique |
| **Overlay de estatísticas** | FPS, bitrate de vídeo/áudio, latência e qualidade em tempo real |
| **Docker** | `docker-compose.yml` pronto para uso |

---

## 🏗️ Estrutura do Projeto

```
screen-share-app/
├── server/           → Servidor de sinalização WebRTC (Node.js + TypeScript)
├── client/           → Interface do usuário (React 18 + TypeScript + Vite)
├── native/           → Módulo C++ de captura de áudio por app (Windows/macOS)
├── desktop/          → App Electron (habilita o áudio por aplicativo)
├── shared/types/     → Tipos TypeScript compartilhados entre servidor e cliente
├── docker-compose.yml
└── .env.example
```

---

## 🚀 Como Rodar Localmente

### Pré-requisitos

Instale as seguintes ferramentas antes de começar:

| Ferramenta | Versão mínima | Como instalar |
|---|---|---|
| **Node.js** | 20 LTS | [nodejs.org](https://nodejs.org) ou `nvm install 20` |
| **npm** | 10+ | Incluído com o Node.js |
| **Git** | qualquer | [git-scm.com](https://git-scm.com) |

> **Para o módulo nativo C++ (opcional — só se quiser captura de áudio por app no Electron):**
> - Windows: Visual Studio 2019+ com "Ferramentas de build para C++" e Python 3
> - Linux: `sudo apt install build-essential python3 libpipewire-0.3-dev libx11-dev`

---

## 🌍 Usar com outra pessoa (redes diferentes) — modo fácil

Um comando sobe o servidor e cria um link público HTTPS (Cloudflare Quick Tunnel — grátis, sem conta). **Quem assiste não precisa instalar nada**, só abrir o link no navegador.

1. **Instale o `cloudflared`** (uma vez só):
   - macOS: `brew install cloudflared`
   - Windows: `winget install --id Cloudflare.cloudflared` (reabra o terminal depois)
   - Linux: [documentação oficial](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. **Rode** na pasta do projeto: `npm run share` (na primeira vez instala as dependências e faz o build sozinho).
3. **Copie o link** impresso no quadro "Pronto!" e envie à outra pessoa (por exemplo, no WhatsApp). Você abre `http://localhost:3001`, inicia a transmissão e envia o link `/view/CÓDIGO` que o app mostra com botão de copiar.
4. O espectador abre o link no navegador e **clica em "Ativar som"** para ouvir o áudio.

Para compartilhar o áudio de um aplicativo específico, use `npm run share:desktop`.

> 🔒 **Privacidade:** quem tiver o link **e** o código consegue assistir. O endereço muda a cada execução; quando terminar, feche o terminal (Ctrl+C) para derrubar tudo.
>
> ⚠️ **Redes muito restritivas:** se o vídeo não conectar (redes corporativas, alguns 4G), será preciso um servidor TURN próprio. O Open Relay do `.env.example` serve apenas para testes.

---

### Passo 1 — Clonar e entrar na pasta do projeto

```bash
git clone <url-do-repositorio>
cd screen-share-app
```

---

### Passo 2 — Configurar as variáveis de ambiente

```bash
# Cria o arquivo .env a partir do modelo
cp .env.example .env
```

Abra o arquivo `.env` e verifique as configurações:

```env
# Porta em que o servidor de sinalização vai rodar
PORT=3001

# Endereço do cliente — usado para configurar o CORS
CLIENT_ORIGIN=http://localhost:3000

# Nível de detalhe dos logs (info | debug | warn | error)
LOG_LEVEL=info

# ─── Servidor TURN (necessário apenas em redes com NAT restritivo) ───────────
# Sem um servidor TURN, a conexão pode falhar em redes corporativas ou 4G.
# Serviço gratuito para testes: https://www.metered.ca/tools/openrelay/
VITE_TURN_URL=turn:openrelay.metered.ca:80
VITE_TURN_USER=openrelayproject
VITE_TURN_CREDENTIAL=openrelayproject
```

> ⚠️ **Nunca commite o arquivo `.env`** — ele pode conter credenciais sensíveis.

---

### Passo 3 — Instalar as dependências

Execute os três blocos abaixo **um de cada vez**:

```bash
# 1. Tipos compartilhados (deve ser o primeiro — servidor e cliente dependem dele)
cd shared/types
npm install
npm run build
cd ../..
```

```bash
# 2. Servidor de sinalização
cd server
npm install
cd ..
```

```bash
# 3. Interface do usuário
cd client
npm install
cd ..
```

---

### Passo 4 — Iniciar o servidor e o cliente

Abra **dois terminais separados**:

**Terminal 1 — Servidor de sinalização:**

```bash
cd server
npm run dev
```

Você deverá ver algo como:
```
[HH:MM:SS] info: Servidor de sinalização iniciado em http://127.0.0.1:3001
[HH:MM:SS] info: Aceitando conexões de: http://localhost:3000
```

**Terminal 2 — Interface do usuário:**

```bash
cd client
npm run dev
```

Você deverá ver algo como:
```
  VITE v5.x.x  ready in Xms

  ➜  Local:   http://localhost:3000/
```

Acesse **http://localhost:3000** no seu navegador (Chrome ou Edge para melhor compatibilidade).

---

### Portas utilizadas por padrão

| Serviço | Porta | Configurável em |
|---|---|---|
| Interface do usuário (Vite) | `3000` | `vite.config.ts` → `server.port` |
| Servidor de sinalização | `3001` | `.env` → `PORT` |

---

## 🎮 Como Usar

### Para compartilhar sua tela

1. Acesse `http://localhost:3000`
2. Clique no botão **"Iniciar Compartilhamento"**
3. Na barra lateral esquerda, configure:
   - **Resolução e FPS** desejados
   - **Codec de vídeo** (H.264 é o mais compatível)
   - **Fontes de áudio** — marque os aplicativos cujo áudio você quer transmitir
4. Clique em **"▶ Iniciar Compartilhamento"**
5. O navegador exibirá um seletor — escolha a **janela**, o **monitor** ou a **aba** que deseja compartilhar
6. Após confirmar, o código de 6 dígitos aparecerá na tela — compartilhe com quem quiser assistir
7. Use **"⏸ Pausar"** para congelar a imagem sem encerrar a transmissão
8. Use **"⏹ Encerrar"** para finalizar tudo e fechar a sala

### Para assistir uma transmissão

1. Acesse `http://localhost:3000` (ou o link de convite recebido diretamente)
2. Digite o **código de 6 dígitos** no campo de entrada
3. Clique em **"Entrar"**
4. O vídeo do apresentador aparecerá automaticamente após a conexão ser estabelecida
5. As estatísticas de qualidade (FPS, bitrate, latência) ficam no canto inferior esquerdo do vídeo
6. Clique em **"Sair"** para deixar a sala a qualquer momento

---

## 🐳 Executar com Docker Compose

Se preferir não instalar Node.js localmente, use Docker:

### Pré-requisitos

- Docker 26+ e Docker Compose instalados

### Passos

```bash
# 1. Configure o .env
cp .env.example .env

# 2. Compile os projetos TypeScript (necessário antes do build das imagens)
cd shared/types && npm install && npm run build && cd ../..
cd server && npm install && npm run build && cd ..
cd client && npm install && npm run build && cd ..

# 3. Suba os containers
docker-compose up -d

# 4. Acompanhe os logs se quiser
docker-compose logs -f server
docker-compose logs -f client
```

Acesse **http://localhost:3000**.

Para parar os containers:
```bash
docker-compose down
```

---

## 🖥️ App Desktop (áudio por aplicativo)

O navegador só consegue compartilhar o áudio do **sistema inteiro**. Para transmitir o áudio de
apenas alguns aplicativos (ex.: o vídeo, sem o som do jogo) use o app desktop (Electron).

| Sistema | Tecnologia | Requisito |
|---|---|---|
| Windows | WASAPI Process Loopback | Windows 10 versão 2004 (build 19041) ou superior |
| macOS | ScreenCaptureKit | macOS 13 ou superior |

### Compilar e rodar

```bash
# 1. Compilar o módulo nativo (Windows: Visual Studio Build Tools com C++; macOS: Xcode Command Line Tools)
cd desktop
npm install
npm run build:native

# 2. Modo desenvolvimento (com o Vite rodando em http://localhost:3000)
npm run dev

# 3. Modo produção (usa client/dist)
cd ../client && npm run build && cd ../desktop
npm start
```

> No modo produção o app abre em `app://app`; adicione essa origem ao `CLIENT_ORIGIN` do servidor.

### Como usar
1. Abra o app desktop e vá em **Compartilhar Tela**.
2. Escolha a tela/janela no seletor de captura.
3. Em **Fontes de Áudio**, marque só os aplicativos desejados e ajuste o volume de cada um.
4. Inicie. Somente o áudio dos apps marcados vai para os espectadores. A seleção vale ao iniciar a transmissão.

### Permissões
- **macOS:** conceda **Gravação de Tela e Áudio do Sistema** em Ajustes do Sistema > Privacidade e Segurança e reinicie o app.
- **Windows:** nenhuma permissão extra.

### Status de testes
- macOS: módulo compila e lista aplicativos. A captura de áudio ao vivo ainda não foi validada.
- Windows: o código foi escrito, mas **ainda não foi compilado nem testado**.

### 📦 Instalador para Windows (para quem não usa terminal)

**Gerar o instalador (pelo GitHub):**
1. No GitHub, abra **Actions > Build Windows > Run workflow** e aguarde terminar.
2. Na página da execução, baixe o artifact **ScreenShare-Setup-windows** (contém `ScreenShare-Setup-<versão>.exe`).
3. Alternativa: crie uma tag `v1.0.0` (`git tag v1.0.0 && git push origin v1.0.0`); o instalador é publicado em **Releases**.

**Instalar:** dê duplo clique no `.exe`. Não precisa de administrador. Como o instalador não é assinado, o Windows SmartScreen mostra o aviso "Editor desconhecido": clique em **Mais informações > Executar assim mesmo**.

**Usar:**
1. Abra o **Screen Share** (atalho na Área de Trabalho) e clique em **Compartilhar**.
2. Copie o link gerado e cole no WhatsApp (ou onde quiser).
3. Para assistir: cole o link no navegador **ou** use o campo de link dentro do app.

**Privacidade:** a transmissão passa do seu computador direto para quem tem o link (túnel Cloudflare); nada fica gravado. Compartilhe o link só com quem você confia.

**Limitações:** o app precisa ficar aberto no computador de quem transmite, e o endereço (link) muda a cada vez que o app é aberto.


---

## 🔒 Detalhes de Segurança

- Todos os serviços escutam em `127.0.0.1` (nunca `0.0.0.0`)
- Containers Docker rodam como usuário não-root (UID 1001)
- Imagens base: `registry.redhat.io/ubi9/*` (Red Hat Universal Base Image)
- A comunicação WebRTC é protegida por **DTLS 1.2 + SRTP** (padrão do protocolo)
- Credenciais TURN ficam **somente no `.env`** — nunca no código-fonte

---

## 🐛 Solução de Problemas

### "Você precisa permitir o compartilhamento de tela"
O navegador pediu permissão e você clicou em "Negar" ou fechou o seletor. Clique em "Iniciar Compartilhamento" novamente e autorize quando solicitado.

### "Você cancelou a seleção de tela"
Você fechou o seletor de janelas sem escolher nada. Clique em "Iniciar" novamente e selecione uma janela ou monitor.

### O espectador não recebe o vídeo
1. Verifique se ambos estão na mesma rede ou se as portas UDP estão abertas
2. Em redes com NAT restritivo (corporativo, 4G), configure um servidor TURN no `.env`
3. Use o serviço gratuito do Open Relay para testes: https://www.metered.ca/tools/openrelay/

### Erro "EADDRINUSE: address already in use :::3001"
Outra instância do servidor já está rodando. Encerre com `Ctrl+C` ou altere a porta no `.env`:
```env
PORT=3002
```
E também no cliente:
```env
VITE_SERVER_URL=http://127.0.0.1:3002
```

### Alta latência (mais de 300ms)
- Reduza o bitrate de vídeo no painel (recomendado: 2000–4000 kbps para 1080p)
- Escolha uma resolução menor (ex.: 720p) para conexões lentas
- Configure um servidor TURN geograficamente próximo a você e ao espectador

### O módulo nativo não compila no Windows
Instale o Visual Studio Build Tools com "Desenvolvimento para desktop com C++" e o Windows SDK 10.0.19041 ou superior, depois rode `npm run build:native` em `desktop/`.

---

## 🛠️ Scripts Disponíveis

### Servidor (`/server`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Inicia em modo de desenvolvimento com recarregamento automático |
| `npm run build` | Compila TypeScript para JavaScript (pasta `dist/`) |
| `npm start` | Inicia a versão compilada (use após `build`) |

### Cliente (`/client`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Inicia o servidor de desenvolvimento Vite com hot-reload |
| `npm run build` | Compila a aplicação para produção (pasta `dist/`) |
| `npm run preview` | Visualiza o build de produção localmente |

### Tipos compartilhados (`/shared/types`)

| Comando | O que faz |
|---|---|
| `npm run build` | Compila as definições TypeScript |
| `npm run dev` | Recompila automaticamente ao salvar |

---

## 📦 Tecnologias Utilizadas

| Camada | Tecnologia |
|---|---|
| Servidor de sinalização | Node.js 20, TypeScript 5, Express 4, Socket.IO 4, Winston |
| Interface do usuário | React 18, TypeScript 5, Vite 5, React Router 6 |
| Transmissão de vídeo | WebRTC nativo do navegador (`RTCPeerConnection`, `getDisplayMedia`) |
| App desktop | Electron |
| Captura de áudio (Windows) | C++17, WASAPI Process Loopback, Node Addon API |
| Captura de áudio (macOS) | Objective-C++, ScreenCaptureKit, Node Addon API |
| Containerização | Docker, Docker Compose, Nginx, Red Hat UBI 9 |

---

## 📄 Licença

MIT — livre para uso pessoal e comercial.
