# Contribuindo com o KIARA

Obrigado por ajudar! Este guia resume como preparar o ambiente e o que esperamos de uma contribuição.

## Requisitos

- Node.js **22** ou superior (`node -v`)
- Google Chrome (apenas para o teste e2e)
- Windows com Visual Studio Build Tools e Python, somente para compilar o módulo nativo (`native/`)

## Setup

```bash
git clone <url-do-repositorio>
cd kiara
cp .env.example .env            # ajuste se necessário; nunca commite o .env
npm run setup                   # instala dependências e compila shared/types
```

Rodar em desenvolvimento (dois terminais):

```bash
cd server && npm run dev        # sinalização em http://127.0.0.1:3001
cd client && npm run dev        # site em http://localhost:3000
```

Para compartilhar com outra pessoa via túnel: `npm run share` (ou `npm run share:desktop`).

## Comandos de qualidade

Antes de abrir um PR, rode na raiz:

```bash
npm run verify
```

Ele executa, em sequência, o que a CI executa para servidor e cliente. Individualmente:

| Onde      | Comandos                                                                    |
| --------- | --------------------------------------------------------------------------- |
| `server/` | `npm run typecheck`, `npm test`, `npm run build`                            |
| `client/` | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`            |
| `desktop/`| `node --check src/**/*.js`; os testes de `desktop/src` rodam via `client`   |

### Testes

- Unitários: `npm test` em `server/` e `client/` (Vitest). O `client` também executa os testes de `desktop/src`.
- Ponta a ponta (Chrome real): `cd client && npm run e2e`. Use `CHROME_PATH=/caminho/do/chrome` se o Chrome não estiver no local padrão.
- Módulo nativo (`native/`): não há testes unitários C++; veja `native/README.md`.

## Padrão de commits

Usamos o formato `tipo(escopo opcional): descrição`, com apenas quatro tipos:

```
feat(server): limita espectadores por sala
fix(client): corrige reconexão após troca de rede
update(deps): atualiza vitest
refactor(client): centraliza cores em tokens CSS
```

Tipos: `feat` (nova funcionalidade), `fix` (correção), `update` (atualizações, documentação e configuração) e `refactor` (mudança interna sem alterar comportamento).

## Pull requests

- Mantenha o PR pequeno e focado; descreva o que muda e como testar.
- Inclua testes para comportamento novo e corrija o que a CI apontar.
- Atualize o `CHANGELOG.md` (seção *Unreleased*) quando houver impacto para o usuário.
- Nunca inclua segredos, tokens ou credenciais. Vulnerabilidades: siga o `SECURITY.md`.
- Comentários e documentação em português do Brasil.
