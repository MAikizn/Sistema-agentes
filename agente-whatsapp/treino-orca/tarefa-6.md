# Tarefa 3 (worker 6): consolidação

Leia primeiro `treino-orca/BRIEFING.md`. Depois leia `treino-orca/estudo-sdr.md` e `../prompt.txt`.

1. Escreva um script node `treino-orca/consolidar.js` que lê todos os `treino-orca/cenarios-parte-*.jsonl`, descarta linhas inválidas, remove duplicados (mesma mensagem_lead normalizada, ou mensagem_lead + resposta quase iguais), renumera ids (`C-0001`...) e salva `treino-orca/cenarios-final.json` (array JSON, UTF-8, indentado). Rode o script.
2. Corrija inconsistências com as regras do Morfeus nos cenários: nome antigo da empresa em vez de "Onça Digital", promessa de resultado garantido, preço ou prazo inventado, transferência sem aviso, respostas longas demais, mais de uma pergunta na mesma mensagem, resposta a grupo. Faça isso por script (busca de padrões) + revisão manual de uma amostra. Registre o número de correções.
3. Gere `treino-orca/prompt-sistema-morfeus.md`: um prompt de sistema melhorado para o Morfeus, partindo do `../prompt.txt` atual e incorporando o estudo SDR (qualificação, objeções, agendamento, transferência com aviso, segurança contra manipulação), em português, pronto para colar. Inclua ~15 exemplos curtos tirados dos cenários.
4. Gere `treino-orca/regras-top20.md`: as 20 regras mais importantes do Morfeus, numeradas, uma linha cada.
5. Gere `treino-orca/consolidacao-log.md` com: total de cenários por parte, duplicados removidos, inválidos descartados, correções feitas, total final.

Não altere `../prompt.txt` nem nenhum arquivo fora de `treino-orca/`.
