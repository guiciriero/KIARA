# Política de segurança

## Versões suportadas

Damos suporte de segurança apenas à versão mais recente:

| Versão                                   | Suporte |
| ---------------------------------------- | ------- |
| Branch `main` / última release publicada | Sim     |
| Releases anteriores                      | Não — atualize para a mais recente |

O app desktop atualiza-se sozinho pela aba de atualização; o site e o servidor seguem a `main`.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública.** Use o *Private Vulnerability Reporting* do GitHub:

1. Abra a aba **Security** do repositório.
2. Clique em **Report a vulnerability**.
3. Descreva o problema, o impacto e os passos para reproduzir (prova de conceito, se possível).

Responderemos o mais rápido possível, normalmente em até 7 dias, e manteremos você informado até a correção e a divulgação coordenada. Pedimos que não divulgue o problema antes da correção estar disponível.

## Escopo

Dentro do escopo:

- servidor de sinalização (`server/`): salas, senhas/aprovação, limites, credenciais TURN efêmeras, CORS e cabeçalhos;
- site (`client/`): XSS, vazamento de links/tokens, WebRTC, PWA/service worker;
- app desktop (`desktop/`): Electron, IPC, atualização, binário `cloudflared`, módulo nativo (`native/`);
- infraestrutura do repositório: workflows, Dockerfiles e configuração de implantação.

Fora do escopo:

- vulnerabilidades em serviços de terceiros (Cloudflare, Render, GitHub, provedores de TURN);
- ataques que exijam acesso físico ou máquina já comprometida;
- negação de serviço volumétrica e *spam* sem falha de lógica;
- SmartScreen exibindo "Editor desconhecido" em builds sem assinatura (comportamento conhecido).

## Boas práticas do projeto

- Nenhum segredo no repositório; use variáveis de ambiente (`.env.example` lista todas).
- Credenciais TURN são geradas pelo servidor, efêmeras, e nunca entram no bundle do cliente.
- Ações do GitHub fixadas por SHA, CodeQL e Dependabot ativos.
