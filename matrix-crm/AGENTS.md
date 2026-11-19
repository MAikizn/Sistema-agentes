# MATRIX CRM — guia para agentes (GPT/Codex, Claude, Arquiteto)

Leia este arquivo inteiro e o `HISTORICO.md` antes de qualquer tarefa nesta pasta.
Responda e escreva em português do Brasil. O dono do projeto é o Maike (empresa Onçadigital), que não é programador: explique de forma simples.

## O que é

CRM + chatbot + automações vendido para pequenas empresas brasileiras. Primeiro cliente: clínica odontológica.
Quem usa: donas de clínica, recepcionistas e dentistas. Tudo precisa ser claro, bonito e fácil.
Modelo de negócio: o Maike (dono da plataforma) cria **subcontas** (uma por cliente) na tela Agência; cada cliente tem seus usuários e seus dados isolados.
Integração principal: o **Morfeus** (agente de WhatsApp em `..\agente-whatsapp`) manda as conversas para o CRM.

## Tecnologia

- **Cloudflare Pages** servindo a pasta `site/` (HTML, CSS e JS puros, sem framework e sem build).
- **Pages Functions**: todo o servidor está em `functions/_middleware.js` (login, sessões, API, isolamento por subconta).
- **Banco D1** (SQLite da Cloudflare), binding `DB`, nome `matrix-crm`. Configuração em `wrangler.toml`.
- Ferramenta: `npx wrangler` (Node 24). Não há `package.json` nem dependências.

## Estado atual (atualize quando mudar)

- Roda **só no PC** (`TESTAR-NO-PC.bat` → http://localhost:8788). **Ainda não foi publicado** na Cloudflare: em `wrangler.toml` o `database_id` está `"PENDENTE"` (o `publicar.js nuvem` cria o banco e grava o id na primeira publicação).
- Domínio da empresa já na Cloudflare: `oncadocerrado.com.br` (ainda não ligado ao CRM).

## Pastas e arquivos

| Caminho | O que é |
|---|---|
| `site/` | Telas publicadas: `login.html`/`index.html`, `painel`, `conversas`, `pacientes`, `paciente`, `funil`, `agenda`, `agentes`, `automacoes`, `configuracoes`, `agencia` (painel do dono), `style.css`, `perfil.js` |
| `bruto/` | Versões cruas das telas geradas pela IA (rascunho). Não é publicado. |
| `functions/_middleware.js` | Servidor inteiro (ver API abaixo) |
| `schema.sql` | Banco etapa 1: `subcontas`, `usuarios`, `sessoes`, `tentativas`, `auditoria`, `codigos_reserva` |
| `schema-etapa2-crm.sql` | Banco etapa 2 (modelo adaptado do Twenty CRM): `empresas`, `pacientes`, `funil_etapas`, `oportunidades`, `tarefas`, `tarefa_alvos`, `notas`, `nota_alvos`, `anexos`, `linha_do_tempo`, `integracoes`, `campos_personalizados`. Só acrescenta tabelas. |
| `construir.js` + `CONSTRUIR.bat` | "Fábrica": o Neo (FreeLLMAPI) e a Trinity geram as telas a partir de `telas.json` e `trinity.md`. Precisa do FreeLLMAPI aberto. |
| `telas.json` | Pedido de cada tela para a fábrica |
| `trinity.md` | Regras de design (Trinity, diretora de UI/UX) — seguir sempre |
| `publicar.js` | Prepara o banco, cria o login do dono e publica. `node publicar.js local` (PC) ou `nuvem` (Cloudflare); `nuvem reset2f` zera o 2 fatores do dono |
| `TESTAR-NO-PC.bat`, `PUBLICAR-NA-CLOUDFLARE.bat`, `RECUPERAR-2-FATORES-DO-DONO.bat` | Atalhos do `publicar.js` |
| `chave-integracao.js` + `LIGAR-MORFEUS-NO-CRM.bat` | Liga o Morfeus a uma subconta: gera chave, guarda só o hash no banco e grava a chave em `..\agente-whatsapp\config.json` (bloco `matrix`) |
| `progresso.log`, `publicar.log` | Registros automáticos da fábrica e da publicação |
| `backup-2026-11-15/` | Cópias antes das mudanças de 15/11/2026 |
| `.wrangler/` | Banco local e cache do wrangler (não mexer, não versionar) |

## API (`functions/_middleware.js`, prefixo `/api/`)

- Públicas: `POST login`, `POST integracao/whatsapp` (Morfeus, autenticada por chave da integração).
- Sessão: `POST sair`, `GET eu`, `POST senha`, `POST 2f/iniciar`, `POST 2f/confirmar`, `PATCH agentes`.
- CRM (dentro da subconta): `GET equipe`, `GET funil`, `POST funil/etapas`, `POST oportunidades`, `GET/POST pacientes`.
- Dono/admin: `POST entrar-como`, `GET/POST subcontas`, `PATCH subcontas/:id`, `GET/POST subcontas/:id/usuarios`, `PATCH/DELETE usuarios/:id`.
- Segurança já implementada: senhas PBKDF2 (100 mil iterações), cookie `__Host-sessao` (12 h), limite de tentativas (15 min), 2 fatores TOTP + códigos de reserva, tabela `auditoria`, funções `dono | admin | atendente | dentista`. Toda consulta do CRM filtra por `subconta_id`.

## Regras para qualquer agente

1. **Não publicar** na Cloudflare (`publicar.js nuvem`, `wrangler pages deploy`, `d1 ... --remote`) sem o Maike pedir claramente.
2. **Nunca** mexer em `..\.cloudflared`, em túneis, em `wrangler.toml` (exceto quando a publicação gravar o id) ou em `.wrangler/`.
3. **Nenhum segredo** em arquivo, log ou resposta: chaves, tokens, senhas, `config.json` do Morfeus.
4. Antes de alterar uma tela ou o servidor, guarde a versão anterior (o git já faz isso; para mudanças grandes, também em `backup-AAAA-MM-DD/`).
5. Telas: seguir `trinity.md` (HTML/CSS/JS puros, sem CDN, PT-BR, cor da marca só por `--marca`/`--marca-2`, responsivo, contraste AA, alvos de 40 px).
6. Banco: só acrescentar (novas tabelas/colunas com `IF NOT EXISTS`); nunca apagar dados nem colunas sem pedido explícito.
7. Mantenha o isolamento por subconta em toda rota nova (filtrar por `subconta_id` da sessão).
8. Teste no PC (`TESTAR-NO-PC.bat`) antes de dizer que está pronto, quando a mudança afetar telas ou API.
9. **Ao terminar qualquer tarefa que mude algo**, acrescente uma entrada no topo de `HISTORICO.md` (formato lá dentro) e, se o estado do projeto mudou, atualize a seção "Estado atual" deste arquivo.
