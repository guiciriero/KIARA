# Uso de subagentes (regra permanente do projeto)

Sempre considere usar subagentes (`spawn_subagent`) quando isso trouxer ganho de paralelismo, velocidade ou qualidade. Esta regra vale para todas as tarefas deste projeto, sem o usuário precisar repeti-la.

## Como aplicar

1. **Avalie antes de começar.** Em qualquer tarefa não trivial, pergunte-se se ela se divide em partes independentes (pesquisa no código, módulos separados, testes, revisão, empacotamento/CI).
2. **Feche os contratos primeiro.** Antes de disparar, defina o que é compartilhado entre as partes: tipos, interfaces, formato de API, `.gitignore`, estrutura de pastas. Faça isso você mesmo, para os subagentes não entrarem em conflito.
3. **Dispare em paralelo.** Chame todos os `spawn_subagent` independentes no mesmo turno. Dê a cada um posse exclusiva de arquivos ou pastas e diga explicitamente o que ele NÃO pode editar.
4. **Tarefas pequenas ou sequenciais: faça direto.** Não crie subagentes para leituras simples, buscas pontuais ou passos que dependem do anterior.
5. **Integre e revise.** Ao final, leia os resultados dos subagentes, resolva inconsistências e rode build, tipos e testes antes de reportar. Não confie só no relatório do subagente.

## Boas práticas aprendidas neste projeto

- Tarefas muito grandes estouram o limite de resposta do subagente (já aconteceu no backend macOS). Mantenha cada tarefa enxuta e peça para gravar o arquivo logo no início.
- Subagentes não podem compilar para Windows num Mac. Peça que declarem explicitamente o que NÃO foi testado.
- Peça relatório curto: arquivos alterados, resultado dos testes e ressalvas.
- Ao final, diga ao usuário o que foi e o que não foi validado.
