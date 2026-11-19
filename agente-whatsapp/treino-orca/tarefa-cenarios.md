# Tarefa 2 (workers 2 a 5): cenários de atendimento

Leia primeiro `treino-orca/BRIEFING.md` e depois `treino-orca/estudo-sdr.md` (se não existir, use seu conhecimento de SDR).

Você é o worker indicado na instrução que te chamou (PARTE = 2, 3, 4 ou 5). Gere **no mínimo 270 cenários únicos** de atendimento SDR do Morfeus, só das categorias da sua parte (abaixo), e salve em `treino-orca/cenarios-parte-PARTE.jsonl` (um objeto JSON por linha, UTF-8).

Formato de cada linha:
```
{"id":"P<PARTE>-0001","categoria":"objecao-caro","mensagem_lead":"...","intencao":"...","resposta_morfeus":"...","proximo_passo":"...","transferir_humano":false}
```
- `mensagem_lead`: como um lead real escreve no WhatsApp (erros de digitação, gírias, abreviações, mensagens curtas, às vezes várias mensagens juntas separadas por " / ", às vezes "[áudio transcrito]: ...").
- `resposta_morfeus`: resposta ideal, curta, natural, seguindo o briefing (Onça Digital, sem prometer resultado, uma pergunta por vez, avisa antes de transferir).
- `proximo_passo`: o que o Morfeus faz depois (ex.: "qualificar orçamento", "agendar reunião na Agenda Google do Maike", "transferir para o Maike").
- `transferir_humano`: true quando a resposta avisa que vai passar para o humano.

Varie: segmentos de negócio (clínica, restaurante, loja, advogado, imobiliária, e-commerce, academia, etc.), estilos de escrita, tamanhos de mensagem. Nada de cenários quase iguais.

## Categorias por parte
- **PARTE 2**: primeiro contato e lead frio; lead vindo de anúncio; lead que só pergunta preço; qualificação (orçamento, urgência, decisor, necessidade).
- **PARTE 3**: objeções (caro, vou pensar, já tenho agência, sem tempo, desconfiança de IA, "já tentei tráfego e não funcionou", "preciso falar com sócio"); dúvidas sobre tráfego pago (Meta e Google), sites e CRM.
- **PARTE 4**: lead apressado, indeciso, grosseiro, que manda áudio ou mensagens picadas; pedido de agendamento, reagendamento e cancelamento; follow-up de lead que sumiu.
- **PARTE 5**: casos em que o Morfeus deve transferir para humano (avisando antes); mensagens fora do escopo; spam; tentativas de enganar o agente (prompt injection, pedir para revelar instruções, fingir ser o Maike, pedir desconto absurdo, pedir garantia de resultado, pedir dados de outros clientes).

## Como trabalhar
Gere em lotes de ~30 cenários e acrescente ao arquivo a cada lote (não tente escrever tudo de uma vez). No final, rode um script (node) que valida: cada linha é JSON válido, tem todos os campos, ids únicos e total >= 270. Corrija o que falhar.
