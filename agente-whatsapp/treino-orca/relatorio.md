# Relatório: treino do Morfeus via Codex

Data: 17/11/2026, das 01:17 às 01:44. Todo o trabalho pesado foi feito por workers do Codex (crédito do ChatGPT, modelo gpt-6.1-sol). O Claude só planejou, orquestrou e revisou.

## O que foi feito
| Entrega | Arquivo | Resultado |
|---|---|---|
| Estudo de SDR e vendas (worker 1) | `estudo-sdr.md` | 1.137 linhas, 16 vídeos do YouTube citados com link; 18 trechos marcados como "conhecimento geral, sem fonte confirmada" |
| Cenários (workers 2 a 5, em paralelo) | `cenarios-parte-2..5.jsonl` | 270 + 270 + 270 + 271 = 1.081 cenários |
| Consolidação (worker 6) | `cenarios-final.json` | 1.081 cenários únicos (0 duplicados), 13 sinalizados por quebra de regra, 13 corrigidos |
| Prompt de sistema melhorado | `prompt-sistema-morfeus.md` | 427 linhas, apresenta o Morfeus como Onça Digital e mantém as marcações do agent.js (`[TRANSFERIR]`, `[LEAD_QUALIFICADO]`, `[CHAMAR_NUMERO]`) |
| 20 regras mais importantes | `regras-top20.md` | pronto |
| Log da consolidação | `consolidacao-log.md` | números detalhados |

## Revisão por amostragem (30 cenários)
- Tom bom: respostas curtas (média de 120 caracteres), naturais, uma pergunta por vez, sem valores e sem promessa de resultado.
- Apresentação como "Agente de IA da Onça Digital" em 287 cenários; nenhum usa mais "agente do Mikhael".
- 184 cenários transferem para humano e todos avisam antes.
- Pontos fracos encontrados: alguns textos com "o Maike, o Mikhael Santos" (nome duplicado e estranho); algumas respostas a spam respondem em vez de simplesmente ignorar; poucas respostas longas, com duas ideias numa frase só.

## O que ficou pendente
1. ~~Aplicar o prompt novo~~ **Aplicado em 17/11 às 08:45** (backup em `prompt.backup-2026-11-17.txt`). Ajustes feitos na instalação: a seção de agendamento foi reescrita, porque o Morfeus transferia em vez de agendar (quem registra na agenda é o sistema, a partir do `[LEAD_QUALIFICADO]`); ficou obrigatória a palavra "transferir" no aviso de transferência (exigência do `agent.js:244`); as crases foram tiradas das marcações. No simulador `treinar.js`: 5 agendamentos e 3 transferências corretas em 10 cenários.
2. Os 16 links do YouTube citados no estudo não foram abertos um a um para confirmar que existem.
3. Os cenários ainda não são usados pelo Morfeus em lugar nenhum. Falta decidir como: exemplos no prompt, base de busca ou teste automático com o `treinar.js`.
4. 1 cenário continua sinalizado depois da correção (ver `consolidacao-log.md`).
5. Mudança de rota: a interface do Orca não foi usada. O sandbox do Codex no Windows caiu para somente leitura e bloqueou até a leitura dos arquivos. Por isso o `orquestrar.js` chama o `codex exec` direto: o Codex só gera texto, e o script grava os arquivos. Para rodar de novo: `node treino-orca\orquestrar.js` (ele pula o que já existe).
