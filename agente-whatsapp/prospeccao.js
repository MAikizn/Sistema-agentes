// Prospecção ativa do Morfeus (módulo opcional, separado do agent.js).
// Lê a fila que o Neo monta (empresas sem site ou com site desatualizado), manda a primeira
// mensagem de pré-venda de site, marca o contato com uma tag e registra quem respondeu.
// Tudo é controlado por prospeccao-config.json, relido a cada minuto (liga/desliga sem reiniciar).
// Se este arquivo for apagado, o Morfeus volta a funcionar exatamente como antes.
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CFG_FILE = path.join(DIR, 'prospeccao-config.json');
const DADOS_FILE = path.join(DIR, 'prospeccao-dados.json');
const CSV_FILE = path.join(DIR, 'prospeccao-respostas.csv');
const PROMPT_FILE = path.join(DIR, 'prompt-prospeccao.txt');
const STATUS_FILE = path.join(DIR, 'prospeccao-status.json');

const lerCfg = () => { try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch { return { ativo: false }; } };
let dados = { contatos: {}, indice: {}, processados: {}, enviosPorDia: {}, ultimoEnvio: 0, proximoIntervaloMin: 0 };
try { dados = Object.assign(dados, JSON.parse(fs.readFileSync(DADOS_FILE, 'utf8'))); } catch {}
const salvarDados = () => { fs.writeFileSync(DADOS_FILE + '.tmp', JSON.stringify(dados, null, 1)); fs.renameSync(DADOS_FILE + '.tmp', DADOS_FILE); };

let ctx = null, timer = null, ocupado = false;
const so = x => String(x || '').replace(/\D/g, '');
const sorteio = (a, b) => Math.round(a + Math.random() * Math.max(0, b - a));

function agoraSP() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, semana: p.weekday };
}
const dataBR = iso => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';

// ---------- status (lido pelo painel do escritório) ----------
function gravarStatus(extra = {}) {
  try {
    const cfg = lerCfg(), { dia } = agoraSP();
    const regs = Object.values(dados.contatos);
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ em: new Date().toISOString(), ativo: !!cfg.ativo, simulacao: !!cfg.simulacao,
      enviadosHoje: dados.enviosPorDia[dia] || 0, limitePorDia: cfg.limitePorDia || 20, abordadosTotal: regs.length,
      responderam: regs.filter(r => r.respondeu).length, ultimoEnvio: dados.ultimoEnvio ? new Date(dados.ultimoEnvio).toISOString() : null,
      proximoEnvioAposMin: dados.proximoIntervaloMin || 0, ...extra }, null, 1));
  } catch {}
}

// ---------- fila do Neo ----------
function proximoLead(cfg) {
  let fila = [];
  try { fila = JSON.parse(fs.readFileSync(cfg.filaPath || path.join(DIR, '..', 'neo-prospeccao', 'fila.json'), 'utf8')); } catch { return { lead: null, pendentes: 0 }; }
  // no modo real, quem foi só simulado volta para a fila (a simulação não falou com ninguém)
  const pend = fila.filter(l => l && l.id && l.telefone && (!dados.processados[l.id] || (!cfg.simulacao && dados.processados[l.id].status === 'simulado')));
  return { lead: pend[0] || null, pendentes: pend.length };
}

function montarMensagem(cfg, lead) {
  const ganchos = cfg.ganchos || {};
  const gancho = ganchos[lead.situacaoSite] || ganchos.padrao || 'vi que vocês ainda não têm um site';
  return String(cfg.mensagemInicial || '').replace(/\{empresa\}/g, lead.empresa).replace(/\{nicho\}/g, lead.nicho || '').replace(/\{cidade\}/g, (lead.cidade || '').split(',')[0]).replace(/\{gancho\}/g, gancho).trim();
}

async function abordar(lead, cfg, dia) {
  const marcar = status => { dados.processados[lead.id] = { status, em: new Date().toISOString() }; salvarDados(); };
  const consumirVez = () => { dados.ultimoEnvio = Date.now(); const [a, b] = cfg.intervaloMinutos || [8, 20]; dados.proximoIntervaloMin = sorteio(a, b); dados.enviosPorDia = { [dia]: (dados.enviosPorDia[dia] || 0) + 1 }; };
  const msg = montarMensagem(cfg, lead);
  if (!msg) { ctx.log('🎯 Prospecção: mensagemInicial vazia no prospeccao-config.json, nada enviado'); return; }

  if (cfg.simulacao) { // modo de teste: não fala com ninguém, só mostra o que faria
    ctx.log(`🎯 [SIMULAÇÃO] abordaria "${lead.empresa}" (${lead.nicho}, ${lead.situacaoSite}) > ${msg.slice(0, 90)}`);
    marcar('simulado'); consumirVez(); salvarDados(); return;
  }

  // valida o número no WhatsApp (com e sem o 9), igual o Morfeus já faz para "outro número"
  const d = so(lead.telefone), ddd = d.slice(2, 4), resto = d.slice(4);
  const variantes = [...new Set([d, resto.length === 8 ? '55' + ddd + '9' + resto : null, resto.length === 9 && resto[0] === '9' ? '55' + ddd + resto.slice(1) : null].filter(Boolean))];
  let alvo = null;
  try { alvo = ((await ctx.sock.onWhatsApp(...variantes)) || []).find(r => r.exists); }
  catch (e) { // falha de conexão: tenta de novo depois, mas desiste do lead na 3ª vez
    lead._t = (dados.tentativas = dados.tentativas || {})[lead.id] = (dados.tentativas[lead.id] || 0) + 1;
    if (lead._t >= 3) marcar('erro_ao_verificar'); else salvarDados();
    ctx.log('🎯 Prospecção: erro ao verificar número:', e.message); return;
  }
  if (!alvo) { marcar('sem_whatsapp'); return; }
  const ids = [alvo.jid, alvo.lid].filter(Boolean), tel = alvo.jid.split('@')[0];
  if (!ctx.podeResponder(ids).ok) { marcar('contato_salvo'); return; }              // é contato da agenda do Mikhael: não aborda
  if (ids.some(id => ctx.db.optout[id])) { marcar('pediu_para_sair'); return; }     // já pediu para não receber
  if (dados.contatos[tel] || ids.some(id => (ctx.db.conversas[id] || []).length)) { marcar('ja_em_conversa'); return; }

  await ctx.enviar(ctx.sock, alvo.jid, msg);
  const agora = new Date().toISOString();
  dados.contatos[tel] = { tag: cfg.tag || 'prospeccao-site', leadId: lead.id, empresa: lead.empresa, nicho: lead.nicho || '', cidade: lead.cidade || '',
    telefone: tel, jid: alvo.jid, lid: alvo.lid || null, site: lead.site || '', situacaoSite: lead.situacaoSite || '', motivos: lead.motivos || [],
    mensagemInicial: msg, abordadoEm: agora, respondeu: false };
  for (const id of ids) { dados.indice[id] = tel; ctx.db.conversas[id] = [{ role: 'assistant', content: msg }]; } // a conversa continua com contexto
  ctx.salvar(); marcar('abordado'); consumirVez(); salvarDados();
  ctx.log(`🎯 Prospecção: abordou "${lead.empresa}" (${lead.nicho}) | tag ${dados.contatos[tel].tag} | ${dados.enviosPorDia[dia]}/${cfg.limitePorDia || 20} hoje`);
}

async function ciclo() {
  if (ocupado || !ctx) return;
  const cfg = lerCfg(), { dia, hora, semana } = agoraSP();
  let motivo = '';
  const [h0, h1] = cfg.horario || [8, 18];
  if (!cfg.ativo) motivo = 'desligado';
  else if (hora < h0 || hora >= h1) motivo = 'fora do horário';
  else if (Array.isArray(cfg.diasDaSemana) && cfg.diasDaSemana.length && !cfg.diasDaSemana.includes(semana)) motivo = 'dia da semana desativado';
  else if ((dados.enviosPorDia[dia] || 0) >= (cfg.limitePorDia || 20)) motivo = 'limite do dia atingido';
  else if (Date.now() - (dados.ultimoEnvio || 0) < (dados.proximoIntervaloMin || 0) * 60000) motivo = 'aguardando intervalo';
  if (motivo) { gravarStatus({ situacao: motivo }); return; }
  ocupado = true;
  try {
    const { lead, pendentes } = proximoLead(cfg);
    if (lead) await abordar(lead, cfg, dia);
    gravarStatus({ situacao: lead ? 'ativo' : 'fila vazia', naFila: Math.max(0, pendentes - (lead ? 1 : 0)) });
  } catch (e) { ctx.log('🎯 Prospecção: erro', e.message); }
  finally { ocupado = false; }
}

// ---------- ligação com o agent.js ----------
function iniciar(c) { // chamado a cada (re)conexão do WhatsApp
  ctx = c;
  if (!timer) { timer = setInterval(ciclo, 60000); const cfg = lerCfg(); ctx.log('🎯 Prospecção carregada:', cfg.ativo ? (cfg.simulacao ? 'LIGADA em modo simulação' : 'LIGADA') : 'desligada'); }
  gravarStatus({ situacao: 'carregado' });
}

function registroDe(jid, telefone) {
  const tel = dados.indice[jid] || (dados.contatos[so(telefone)] ? so(telefone) : null);
  return tel ? dados.contatos[tel] : null;
}

// Chamado antes de o Morfeus responder: se o contato tem a tag de prospecção, devolve o roteiro de pré-venda de site
function contexto(jid, telefone) {
  const reg = registroDe(jid, telefone);
  if (!reg) return null;
  let base; try { base = fs.readFileSync(PROMPT_FILE, 'utf8'); } catch { return null; }
  if (!dados.indice[jid]) dados.indice[jid] = reg.telefone;
  if (ctx && !(ctx.db.conversas[jid] || []).length && reg.mensagemInicial) ctx.db.conversas[jid] = [{ role: 'assistant', content: reg.mensagemInicial }];
  if (!reg.respondeu) { reg.respondeu = true; reg.respondeuEm = new Date().toISOString(); }
  reg.ultimaMensagemEm = new Date().toISOString();
  salvarDados(); gravarCsv();
  const system = base + `\n\n# EMPRESA DESTE CONTATO (foi você quem chamou primeiro)\nEmpresa: ${reg.empresa}\nNicho: ${reg.nicho || 'não informado'}\nCidade: ${reg.cidade || 'não informada'}\nSituação do site: ${reg.situacaoSite}${reg.motivos?.length ? ' (' + reg.motivos.join('; ') + ')' : ''}\nSite atual: ${reg.site || 'nenhum'}\nSua primeira mensagem para eles foi: "${reg.mensagemInicial}"`;
  return { system, tag: reg.tag };
}

// Chamado depois de o Morfeus responder: resume a conversa e atualiza a planilha
function aposResposta(jid, telefone, conv) {
  const reg = registroDe(jid, telefone);
  if (!reg) return;
  reg.trocas = (conv || []).filter(m => m.role === 'user').length;
  salvarDados(); gravarCsv();
  extrair(reg, conv).catch(e => ctx && ctx.log('🎯 Prospecção: resumo falhou:', e.message));
}

async function extrair(reg, conv) {
  if (!ctx || !conv || !conv.length) return;
  const transcricao = conv.map(m => (m.role === 'user' ? 'EMPRESA: ' : 'MORFEUS: ') + m.content).join('\n').slice(-6000);
  const r = await fetch(ctx.cfg.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ctx.cfg.llm.apiKey },
    body: JSON.stringify({ model: 'auto', temperature: 0, max_tokens: 400, reasoning_effort: 'low', messages: [
      { role: 'system', content: 'Você resume conversas de prospecção de sites. Responda SOMENTE com um JSON válido, sem texto antes ou depois, com as chaves: "interesse" (um de: "alto", "médio", "baixo", "sem interesse", "indefinido"), "nomeContato" (nome da pessoa ou ""), "resumo" (1 frase, até 160 caracteres, em português), "proximoPasso" (até 80 caracteres, em português). Use só o que está na conversa; não invente.' },
      { role: 'user', content: transcricao }] }) });
  if (!r.ok) return;
  const txt = ((await r.json()).choices?.[0]?.message?.content || '');
  const m = txt.match(/\{[\s\S]*\}/); if (!m) return;
  let j; try { j = JSON.parse(m[0]); } catch { return; }
  const limpa = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  reg.interesse = limpa(j.interesse, 20) || reg.interesse; reg.nomeContato = limpa(j.nomeContato, 60) || reg.nomeContato || '';
  reg.resumo = limpa(j.resumo, 200) || reg.resumo; reg.proximoPasso = limpa(j.proximoPasso, 120) || reg.proximoPasso;
  salvarDados(); gravarCsv();
}

// ---------- planilha (abre direto no Excel) ----------
function situacaoDe(reg) {
  if (!ctx) return 'respondeu';
  const ids = [reg.jid, reg.lid].filter(Boolean);
  if (ids.some(id => ctx.db.optout[id])) return 'pediu para sair';
  if (ids.some(id => (ctx.db.pausados[id] || 0) > Date.now())) return 'com o Mikhael (humano)';
  if ((ctx.db.leads || []).some(l => so(l.tel) === reg.telefone)) return 'call agendada';
  return 'em conversa';
}
function gravarCsv() {
  try {
    const cab = ['Data do contato', 'Data da resposta', 'Empresa', 'Nicho', 'Cidade', 'Telefone', 'Nome do contato', 'Situação do site', 'Site atual', 'Tag', 'Interesse', 'Resumo da conversa', 'Próximo passo', 'Situação', 'Mensagens da empresa', 'Última mensagem'];
    const cel = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ') + '"';
    const linhas = Object.values(dados.contatos).filter(r => r.respondeu).sort((a, b) => String(b.respondeuEm).localeCompare(String(a.respondeuEm))).map(r => [
      dataBR(r.abordadoEm), dataBR(r.respondeuEm), r.empresa, r.nicho, (r.cidade || '').split(',')[0], '+' + r.telefone, r.nomeContato || '',
      r.situacaoSite + (r.motivos?.length ? ': ' + r.motivos.join('; ') : ''), r.site || '', r.tag, r.interesse || 'indefinido', r.resumo || '', r.proximoPasso || '',
      situacaoDe(r), r.trocas || 1, dataBR(r.ultimaMensagemEm)].map(cel).join(';'));
    fs.writeFileSync(CSV_FILE, '﻿' + [cab.map(cel).join(';'), ...linhas].join('\r\n') + '\r\n');
  } catch (e) { if (ctx) ctx.log('🎯 Prospecção: não consegui gravar a planilha (está aberta no Excel?):', e.message); }
}

module.exports = { iniciar, contexto, aposResposta, _teste: { ciclo, montarMensagem, gravarCsv, dados, lerCfg } };
