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

## 🔒 Segurança e Privacidade

- Conexões com serviços locais restritas a `127.0.0.1` (sem binding em interfaces abertas).
- Mídia transmitida com criptografia ponta a ponta **DTLS 1.2 + SRTP**.
- Túnel efêmero: salas temporárias e links únicos a cada sessão.

---

## 📄 Licença

MIT — livre para uso pessoal e comercial.
