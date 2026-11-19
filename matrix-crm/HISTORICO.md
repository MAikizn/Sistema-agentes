# MATRIX CRM — histórico

Diário do projeto. Entrada mais nova no topo. Toda tarefa que muda algo ganha uma entrada.
O git guarda o detalhe de cada arquivo (`git log`); aqui fica o porquê e o que ficou pendente.

Formato:

```
## AAAA-MM-DD — título curto
- Pedido: o que o Maike pediu
- Feito por: Claude / GPT via Arquiteto / Neo+Trinity
- Mudou: o que mudou e em quais arquivos
- Pendente: o que ficou faltando ou precisa de decisão
```

---

## 2026-11-19 — memória do projeto para os agentes
- Pedido: o Arquiteto (Claude planeja, GPT executa) e os outros agentes precisam entender todo o CRM e guardar o histórico.
- Feito por: Claude
- Mudou: criados `AGENTS.md` (guia lido automaticamente pelo Codex), `CLAUDE.md` (aponta para o guia), este `HISTORICO.md`, `.gitignore` e o repositório git local (primeira versão salva). Nenhum arquivo existente foi alterado.
- Pendente: nada. A partir daqui, cada tarefa acrescenta uma entrada aqui e salva uma versão no git.

## 2026-11-18 — domínio da empresa na Cloudflare (fora desta pasta)
- Feito por: Claude
- Mudou: domínio `oncadocerrado.com.br` passou a usar a Cloudflare; `cloudflared` instalado e logado. Nada desta pasta foi tocado.
- Pendente: decidir se o CRM vai usar um endereço do domínio (ex.: `crm.oncadocerrado.com.br`) quando for publicado.

## 2026-11-15 — etapa 2 do banco, telas do CRM com dados reais e ponte com o Morfeus
- Mudou: `schema-etapa2-crm.sql` (modelo adaptado do Twenty CRM, clone em `..\referencias\twenty-crm`); rotas de equipe, funil, oportunidades e pacientes em `functions/_middleware.js`; telas `funil`, `pacientes` e `paciente` ligadas à API; `publicar.js` passou a aplicar a etapa 2; `chave-integracao.js` + `LIGAR-MORFEUS-NO-CRM.bat` e a rota `POST /api/integracao/whatsapp` (lado do Morfeus: `..\agente-whatsapp\matrix.js`). Cópias anteriores em `backup-2026-11-15/`.
- Observação: celular gravado sem o 55.

## 2026-11-11 a 2026-11-13 — login real, subcontas e segurança
- Mudou: `schema.sql` (contas, usuários, sessões, auditoria, códigos de reserva); servidor em `functions/_middleware.js` com login PBKDF2, sessões, limite de tentativas, 2 fatores e isolamento por subconta; `publicar.js` e os `.bat` (testar no PC, publicar, recuperar 2 fatores); tela `agencia` para o dono gerenciar clientes; `site/perfil.js`.
- Testado no PC em 11/11 e 13/11 (`publicar.log`; os avisos "duplicate column name: totp_*" são esperados). Ainda não publicado na Cloudflare.

## 2026-11-10 — protótipo construído pela fábrica
- Feito por: Neo (FreeLLMAPI) + Trinity, supervisionados pelo Claude
- Mudou: `construir.js`, `telas.json`, `trinity.md`; telas geradas em `bruto/` e montadas em `site/` (style, shell, login, painel, conversas, pacientes, paciente, funil, agenda, agentes, automações, configurações, agência). Registro em `progresso.log`.

_As entradas de 10 a 15/11 foram reconstruídas em 19/11 a partir das datas dos arquivos, dos logs e das anotações; podem faltar detalhes._
