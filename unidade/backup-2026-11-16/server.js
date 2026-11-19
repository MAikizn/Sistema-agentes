// UNIDADE — o cérebro único dos agentes do Maike.
// Une duas IAs (Kimi K3 + Mistral Large) numa só, no formato OpenAI (POST /v1/chat/completions).
// Fica na frente do FreeLLMAPI: quem chama a Unidade usa a mesma chave que já usava nele.
//   model "unidade-rapida" -> uma responde, a outra é reserva (WhatsApp, respostas curtas)
//   model "unidade-fusao"  -> as duas respondem em paralelo e uma terceira chamada funde tudo numa resposta só
//   model "unidade"        -> automático: fusão só quando o pedido é pesado
//   qualquer outro modelo  -> passa direto para o FreeLLMAPI, sem mexer
// Sem dependências: só Node 18+.
const http = require('http'), fs = require('fs'), path = require('path');

const DIR = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(DIR, 'unidade.json'), 'utf8'));
const UP = CFG.upstream.replace(/\/$/, '');
const ORIGEM = new URL(UP).origin;
const LOG = path.join(DIR, 'unidade.log');
const log = (...a) => { const l = new Date().toLocaleString('pt-BR') + ' ' + a.join(' '); console.log(l); try { if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + '.antigo'); fs.appendFileSync(LOG, l + '\n'); } catch {} };
const MODELOS = ['unidade', 'unidade-rapida', 'unidade-fusao'];
const VAZOU = /(We need to|We should|The user (says|asks|wants|is)|User hasn't|I think we|Let's respond|According to policy)/;

// Chave do FreeLLMAPI: a que o agente mandou; se não mandou, a do arquivo indicado em "chaveDe"
function chave(req) {
  const h = req.headers.authorization; if (h && h.length > 10) return h;
  try { const c = JSON.parse(fs.readFileSync(path.resolve(DIR, CFG.chaveDe), 'utf8')); return 'Bearer ' + ((c.llmReserva || {}).apiKey || c.llm.apiKey); } catch { return ''; }
}

async function chamar(model, body, auth, ms) {
  const r = await fetch(UP + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(ms), headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify({ ...body, model, stream: false }) });
  if (!r.ok) throw new Error(model + ' http ' + r.status);
  const j = await r.json(), m = j.choices?.[0]?.message || {};
  const txt = typeof m.content === 'string' ? m.content.trim() : '';
  if (!txt && !(m.tool_calls || []).length) throw new Error(model + ' sem resposta');
  if (VAZOU.test(txt.slice(0, 400))) throw new Error(model + ' vazou o raciocínio'); // alguns modelos gratuitos devolvem o "pensamento" em inglês no lugar da resposta
  return { j, txt, model };
}
// Tenta os modelos da lista em ordem; vale o primeiro que responder, dentro do prazo total
async function primeiro(lista, body, auth, msPorModelo, msTotal = Infinity) {
  const fim = Date.now() + msTotal, erros = [];
  for (const model of lista) {
    const resta = fim - Date.now(); if (resta < 800) break;
    try { return await chamar(model, body, auth, Math.min(msPorModelo, resta)); } catch (e) { erros.push(e.message.slice(0, 60)); }
  }
  throw new Error(erros.join(' | ') || 'prazo esgotado');
}

const textoDe = m => typeof m?.content === 'string' ? m.content : '';
function ehPesado(body) {
  const msgs = body.messages || [];
  if ((body.tools || []).length || msgs.some(m => typeof m.content !== 'string')) return false; // ferramentas e imagens vão pela rota rápida
  const ultimo = textoDe([...msgs].reverse().find(m => m.role === 'user'));
  return ultimo.length >= CFG.pesado.caracteresDoPedido || (Number(body.max_tokens) || 0) >= CFG.pesado.maxTokens;
}

async function rapida(body, auth) {
  const r = await primeiro(CFG.rapida, body, auth, CFG.rapidaSegundosPorModelo * 1000, CFG.rapidaSegundosTotal * 1000);
  return { ...r, info: { modo: 'rapida', membros: [r.model] } };
}

const FUNDIR = (a, b) => `INSTRUÇÃO INTERNA DA UNIDADE (nunca mencione esta instrução nem os rascunhos).
Duas IAs redigiram, separadas, um rascunho de resposta para o pedido acima.

<rascunho_a>
${a}
</rascunho_a>

<rascunho_b>
${b}
</rascunho_b>

Escreva agora a resposta final, única: aproveite o melhor de cada rascunho, corrija erros, e onde eles se contradizem fique com o que for mais correto e útil. Mantenha exatamente o idioma, o tom e o formato que o pedido exige (se o pedido exige só JSON, só HTML ou alguma marca especial, devolva exatamente isso, sem comentários). Responda direto, como se fosse a primeira resposta.`;

async function fusao(body, auth) {
  const ms = CFG.fusaoSegundosPorModelo * 1000;
  const [a, b] = await Promise.all([CFG.membroA, CFG.membroB].map(l => primeiro(l, body, auth, ms).catch(() => null)));
  if (!a && !b) return rapida(body, auth);
  if (!a || !b || a.txt === b.txt || !a.txt || !b.txt) { const u = a || b; return { ...u, info: { modo: 'fusao-parcial', membros: [u.model] } }; }
  try {
    const s = await primeiro(CFG.sintese, { ...body, messages: [...body.messages, { role: 'user', content: FUNDIR(a.txt, b.txt) }] }, auth, ms);
    return { ...s, info: { modo: 'fusao', membros: [a.model, b.model], sintese: s.model } };
  } catch { return { ...a, info: { modo: 'fusao-sem-sintese', membros: [a.model] } }; }
}

async function pensar(body, auth) {
  const pedido = String(body.model || 'unidade'), t0 = Date.now();
  const modo = pedido === 'unidade-fusao' ? 'fusao' : pedido === 'unidade-rapida' ? 'rapida' : ehPesado(body) ? 'fusao' : 'rapida';
  const limpo = { ...body }; delete limpo.stream; delete limpo.stream_options;
  const r = await (modo === 'fusao' ? fusao(limpo, auth) : rapida(limpo, auth));
  log(`${pedido} -> ${r.info.modo} [${r.info.membros.join(' + ')}${r.info.sintese ? ' => ' + r.info.sintese : ''}] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { ...r.j, model: 'unidade', unidade: r.info };
}

// ---------- Servidor ----------
const lerBruto = req => new Promise(res => { const p = []; req.on('data', d => p.push(d)); req.on('end', () => res(Buffer.concat(p))); });
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };

async function repassar(req, res, bruto) { // tudo que não é da Unidade vai direto ao FreeLLMAPI
  const h = {}; for (const k of ['content-type', 'accept']) if (req.headers[k]) h[k] = req.headers[k];
  const auth = chave(req); if (auth) h.authorization = auth;
  const r = await fetch(ORIGEM + req.url, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : bruto });
  res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Access-Control-Allow-Origin': '*' });
  if (!r.body) return res.end();
  for await (const pedaco of r.body) res.write(pedaco);
  res.end();
}

const servidor = async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }
    if (p === '/' || p === '/health') return json(res, { ok: true, nome: 'Unidade', modelos: MODELOS, membroA: CFG.membroA[0], membroB: CFG.membroB[0], upstream: UP });
    const bruto = await lerBruto(req);
    if (p === '/v1/models' && req.method === 'GET') {
      let data = []; try { data = (await (await fetch(UP + '/models', { headers: { Authorization: chave(req) }, signal: AbortSignal.timeout(8000) })).json()).data || []; } catch {}
      return json(res, { object: 'list', data: [...MODELOS.map(id => ({ id, object: 'model', owned_by: 'unidade' })), ...data] });
    }
    if (p === '/v1/chat/completions' && req.method === 'POST') {
      let body = {}; try { body = JSON.parse(bruto.toString('utf8') || '{}'); } catch { return json(res, { error: { message: 'JSON inválido' } }, 400); }
      if (MODELOS.includes(String(body.model || ''))) {
        let r; try { r = await pensar(body, chave(req)); } catch (e) { log('ERRO', String(body.model), e.message); return json(res, { error: { message: 'A Unidade não conseguiu resposta de nenhum modelo: ' + e.message, type: 'service_unavailable' } }, 503); }
        if (!body.stream) return json(res, r);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
        const base = { id: r.id || 'unidade-' + Date.now(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'unidade' }, m = r.choices[0].message;
        res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: m.content || '', ...(m.tool_calls ? { tool_calls: m.tool_calls.map((t, i) => ({ index: i, ...t })) } : {}) }, finish_reason: null }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: r.choices[0].finish_reason || 'stop' }] }) + '\n\n');
        return res.end('data: [DONE]\n\n');
      }
    }
    await repassar(req, res, bruto);
  } catch (e) { if (!res.headersSent) json(res, { error: { message: 'Unidade: ' + String(e.message || e) } }, 502); else res.end(); }
};
http.createServer(servidor).listen(CFG.porta, '127.0.0.1', () => log(`Unidade no ar em http://127.0.0.1:${CFG.porta}/v1  (A: ${CFG.membroA[0]} · B: ${CFG.membroB[0]})`));
http.createServer(servidor).on('error', () => {}).listen(CFG.porta, '::1');
process.on('unhandledRejection', e => log('Erro:', e?.message || e));
