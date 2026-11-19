// Agente de WhatsApp: SÓ responde quem chama. Nunca inicia conversa nem faz disparo.
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
let audio = null; try { audio = require('./audio'); } catch (e) { console.log('Skill de áudio indisponível:', e.message); }
let prosp = null; try { prosp = require('./prospeccao'); } catch (e) { console.log('Prospecção indisponível:', e.message); } // módulo opcional: prospecção de sites (Neo -> Morfeus)
// Contatos salvos na agenda: id -> nome salvo
const CONT_FILE = path.join(__dirname, 'contatos.json');
let contatos = {}; try { contatos = JSON.parse(fs.readFileSync(CONT_FILE, 'utf8')); } catch {}
let tContatos; const salvarContatos = () => { clearTimeout(tContatos); tContatos = setTimeout(() => fs.writeFileSync(CONT_FILE, JSON.stringify(contatos, null, 1)), 2000); };
function registrarContatos(lista) {
  for (const c of lista || []) {
    if (!c || !c.id || c.name === undefined) continue;
    const ids = [c.id, c.lid, c.jid, c.phoneNumber].filter(Boolean);
    for (const id of ids) { if (c.name) contatos[id] = c.name; else delete contatos[id]; }
  }
  salvarContatos();
}
// Descobre o código LID de cada contato salvo (o WhatsApp esconde o número em algumas conversas)
async function mapearLids(sock) {
  const fones = Object.keys(contatos).filter(k => !k.startsWith('__')).filter(k => k.endsWith('@s.whatsapp.net'));
  const conhecidos = new Set(Object.values(contatos.__lidDe || {}));
  const faltam = fones.filter(f => !conhecidos.has(f));
  contatos.__lidDe = contatos.__lidDe || {};
  let n = 0;
  for (let i = 0; i < faltam.length; i += 40) {
    try {
      const res = await sock.onWhatsApp(...faltam.slice(i, i + 40));
      for (const r of res || []) if (r.lid && contatos[r.jid]) { contatos[r.lid] = contatos[r.jid]; contatos.__lidDe[r.lid] = r.jid; n++; }
    } catch (e) { log('Mapeamento LID falhou:', e.message); }
    await espera(1500);
  }
  if (n > 0 || !faltam.length) contatos.__mapeado = true;
  salvarContatos(); log('🔗 Contatos salvos mapeados para LID:', n);
}
// Responde só: contato NÃO salvo, ou salvo com "cliente" no nome
function podeResponder(ids) {
  if (ids.some(id => (cfg.numerosTeste || []).some(n => id.startsWith(String(n))))) return { ok: true, nome: 'teste' };
  for (const id of ids) { if (id.startsWith('__')) continue; const n = contatos[id]; if (typeof n === 'string' && n) return /cliente/i.test(n) ? { ok: true, nome: n } : { ok: false, nome: n }; }
  return { ok: true, nome: null };
}

const DIR = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const PROMPT = () => fs.readFileSync(path.join(DIR, 'prompt.txt'), 'utf8');
let n8n = null; try { n8n = require('./n8n')(cfg, (...a) => log(...a)); } catch (e) { console.log('Ponte com o n8n indisponível:', e.message); } // módulo opcional: atendimento e automações pelo n8n
let matrix = null; try { matrix = require('./matrix')(cfg, (...a) => log(...a)); } catch (e) { console.log('Ponte com o Matrix CRM indisponível:', e.message); } // módulo opcional: registra as conversas no Matrix CRM (config.json > matrix)
const DB_FILE = path.join(DIR, 'dados.json');
let db = { conversas: {}, pausados: {}, optout: {}, leads: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
const salvar = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
const log = (...a) => { const l = new Date().toLocaleString('pt-BR') + ' ' + a.join(' '); console.log(l); try { fs.appendFileSync(path.join(DIR, 'agente.log'), l + '\n'); } catch {} };
const status = (estado, extra = {}) => { try { fs.writeFileSync(path.join(DIR, 'status.json'), JSON.stringify({ estado, em: new Date().toISOString(), ...extra }, null, 1)); } catch {} };
const espera = ms => new Promise(r => setTimeout(r, ms));
const OPTOUT = /\b(sair|parar|pare|stop|descadastrar|n[ãa]o quero mais|n[ãa]o me mande)\b/i;
const fila = new Map(); // uma resposta por vez em cada conversa
const buffers = new Map(); // mensagens em espera por conversa
const enviadasPeloRobo = new Set(); // ids das mensagens que o próprio robô mandou
// Comandos por arquivo (funcionam sem reiniciar): limpar-conversas.txt zera conversas/pausas/opt-out (teste)
setInterval(() => {
  const f = path.join(DIR, 'limpar-conversas.txt');
  const af = path.join(DIR, 'gerar-amostras.txt');
  if (fs.existsSync(af) && audio) { fs.unlinkSync(af); audio.gerarAmostras(path.join(DIR, 'amostras-de-voz')).then(f => log('🎙️ Amostras de voz geradas:', f.length)).catch(e => log('Amostras falharam:', e.message)); }
  const amf = path.join(DIR, 'amostra.json');
  if (fs.existsSync(amf) && audio) { const o = JSON.parse(fs.readFileSync(amf, 'utf8')); fs.unlinkSync(amf);
    (o.gemini ? audio.gravarGemini(o.frase, { ...cfg, vozGemini: o.voz || cfg.vozGemini }) : audio.gravar(o.frase, o.voz || cfg.vozAudio, o.prosodia || cfg.vozProsodia || {})).then(b => { fs.mkdirSync(path.join(DIR, 'amostras-de-voz'), { recursive: true }); fs.writeFileSync(path.join(DIR, 'amostras-de-voz', o.arquivo), b); log('🎙️ Amostra gerada:', o.arquivo); }).catch(e => log('Amostra falhou:', e.message)); }
  const tf = path.join(DIR, 'testar-audio.txt');
  if (fs.existsSync(tf)) { fs.unlinkSync(tf); log('🧪 Treino de áudio iniciado'); require('child_process').execFile(process.execPath, [path.join(DIR, 'teste-audio.js')], { cwd: DIR }, (e, out) => log('🧪 Treino de áudio concluído', e ? 'com erro: ' + e.message.slice(0, 100) : '')); }
  const rf = path.join(DIR, 'reiniciar.txt');
  if (fs.existsSync(rf)) { fs.unlinkSync(rf); log('🔄 Reiniciando para aplicar atualização...'); salvar(); setTimeout(() => process.exit(0), 1000); }
  if (fs.existsSync(f)) { db.conversas = {}; db.pausados = {}; db.optout = {}; db.redirecionados = {}; db.falhasAudio = {}; salvar(); fs.unlinkSync(f); log('🧹 Conversas reiniciadas (modo teste)'); }
}, 5000);
if (fs.existsSync(path.join(DIR, 'limpar-pausas.txt'))) { db.pausados = {}; salvar(); fs.unlinkSync(path.join(DIR, 'limpar-pausas.txt')); console.log('Pausas zeradas.'); }

function umaPergunta(txt) { // corta tudo depois da 1ª pergunta (exceto as marcas finais)
  const m = txt.match(/\n?\[(TRANSFERIR|LEAD_QUALIFICADO)\][^\n]*$/); const tag = m ? m[0] : '';
  let corpo = tag ? txt.slice(0, txt.length - tag.length) : txt;
  const i = corpo.indexOf('?'); if (i >= 0) corpo = corpo.slice(0, i + 1);
  return (corpo.trim() + (tag ? '\n' + tag.trim() : '')).trim();
}
// Quem pensa pelo Morfeus, nesta ordem (cada passo só entra se o anterior falhar):
//   1) n8n     - o fluxo "Morfeus - Atendimento" que o Maike edita (config.json > n8n)
//   2) Unidade - o cérebro da estrutura, Kimi K3 + Mistral Large (config.json > unidade)
//   3) FreeLLMAPI direto - o caminho antigo (config.json > llm)
async function ia(historico, system, meta = {}) {
  const sys = (system || PROMPT()) + '\n\n# AGORA\nData e hora atual: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' (horário de Brasília).';
  const u = cfg.unidade || {};
  const rotas = [...(u.ativo === true && u.baseUrl ? [{ baseUrl: u.baseUrl, model: [u.model || 'unidade-rapida'], ms: (u.timeoutSegundos || 24) * 1000 }] : []), { baseUrl: cfg.llm.baseUrl, model: [].concat(cfg.llm.model || 'auto', 'auto'), ms: 20000 }];
  const vazou = r => !r || /(We need|We should|The user|User hasn't|I think we|Let's respond)/.test(r);
  if (n8n) { const txt = await n8n.resposta({ system: sys, historico, ...meta }); if (txt && !vazou(txt)) return umaPergunta(txt); }
  for (const rota of rotas) for (const model of rota.model) {
    try {
      const r = await fetch(rota.baseUrl.replace(/\/$/, '') + '/chat/completions', { method: 'POST',
        signal: AbortSignal.timeout(rota.ms), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.llm.apiKey },
        body: JSON.stringify({ model, temperature: 0.5, max_tokens: 1200, reasoning_effort: 'low',
          messages: [{ role: 'system', content: sys }, ...historico] }) });
      if (!r.ok) continue;
      const j = await r.json();
      const txt = (j.choices?.[0]?.message?.content || '').trim();
      const cortado = j.choices?.[0]?.finish_reason === 'length';
      if (!vazou(txt) && !cortado) return umaPergunta(txt);
    } catch {}
  }
  if (!ia._retry) { ia._retry = true; await new Promise(r => setTimeout(r, 8000)); try { return await ia(historico, system, meta); } finally { ia._retry = false; } }
  throw new Error('nenhum modelo respondeu bem');
}

function texto(m) {
  const msg = m.message || {};
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || '';
}

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(DIR, 'sessao'));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }),
    browser: ['Agente', 'Chrome', '1.0'], markOnlineOnConnect: false, syncFullHistory: false });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', registrarContatos);
  sock.ev.on('contacts.update', registrarContatos);
  sock.ev.on('messaging-history.set', ({ contacts }) => registrarContatos(contacts));
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.clear(); log('Escaneie o QR code abaixo no WhatsApp > Aparelhos conectados:'); qrcode.generate(qr, { small: true }); status('aguardando_qr'); }
    if (connection === 'open') { log('✅ Conectado! O agente está respondendo quem chamar.');
      if (prosp) try { prosp.iniciar({ sock, db, salvar, log, enviar, cfg, podeResponder }); } catch (e) { log('Prospecção: falha ao iniciar', e.message); }
      if (!Object.keys(contatos).length && sock.resyncAppState) setTimeout(() => sock.resyncAppState(['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'], true).then(() => { log('📇 Agenda sincronizada:', Object.keys(contatos).length, 'registros'); return mapearLids(sock); }).catch(e => log('Agenda: falha ao sincronizar', e.message)), 5000); status('conectado', { numero: sock.user?.id?.split(':')[0] });
      if (Object.keys(contatos).length) setTimeout(() => mapearLids(sock), 8000); }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) { log('❌ Sessão encerrada no celular. Apague a pasta "sessao" e rode de novo para novo QR.'); status('deslogado'); process.exit(1); }
      log('Conexão caiu (' + code + '). Reconectando em 10s...'); status('reconectando', { codigo: code }); setTimeout(iniciar, 10000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // ignora histórico antigo
    for (const m of messages) {
      const jid = m.key.remoteJid || '';
      if (!/@(s\.whatsapp\.net|lid)$/.test(jid) || m.key.participant || /@(g\.us|broadcast|newsletter)/.test(jid)) continue; // NUNCA responde grupos, comunidades, status, listas ou canais
      const tel = String(m.key.senderPn || m.key.remoteJidAlt || jid).split('@')[0];
      log('· msg', m.key.fromMe ? '(enviada por você/robô)' : '(recebida)', 'de', tel);
      let t = texto(m).trim();
      const ehAudio = !!m.message?.audioMessage && !m.key.fromMe;
      let naoEntendi = null;
      if (ehAudio) {
        const seg = m.message.audioMessage.seconds || 0;
        let res = { tipo: 'falha' };
        if (audio) try { res = await audio.transcrever(await downloadMediaMessage(m, 'buffer', {}), cfg, seg); } catch (e) { log('🎧 Erro ao baixar áudio:', e.message); }
        if (res.tipo === 'ok') { t = '[áudio do cliente] ' + res.texto; log('🎧 Áudio transcrito:', res.texto.slice(0, 80)); }
        else { naoEntendi = res.tipo; t = '(áudio)'; log('🎧 Áudio não entendido:', res.tipo, '(' + seg + 's)'); }
      }
      if (m.key.fromMe) { // humano respondeu pelo celular -> pausa o robô nessa conversa
        const id = m.key.id;
        setTimeout(() => { // espera o envio do robô terminar para não confundir eco com humano
          if (enviadasPeloRobo.has(id) || fila.has(jid + ':bot')) return;
          db.pausados[jid] = Date.now() + cfg.pausaAposHumanoHoras * 3600e3; salvar();
          log('⏸️ Você respondeu manualmente: robô pausado nessa conversa por', cfg.pausaAposHumanoHoras + 'h');
          if (matrix) matrix.registrar('humano', { jid, telefone: tel, texto: t });
        }, 3000);
        continue;
      }
      if (!t || db.optout[jid]) continue;
      const pr = podeResponder([jid, m.key.senderPn, m.key.remoteJidAlt].filter(Boolean));
      if (!pr.ok) { log('⏭️ Ignorado: contato salvo como "' + pr.nome + '"'); continue; }
      const ci = m.message?.extendedTextMessage?.contextInfo || {};
      const deAnuncio = !!(ci.externalAdReply || ci.entryPointConversionSource || m.message?.extendedTextMessage?.contextInfo?.conversionSource);
      if (ci.isForwarded || ci.forwardingScore) { log('⏭️ Ignorado: mensagem encaminhada (corrente/divulgação)'); continue; }
      const lidSemNumero = jid.endsWith('@lid') && !m.key.senderPn && !pr.nome;
      if (lidSemNumero && !deAnuncio && !contatos.__mapeado && !cfg.responderNumerosOcultos && !(db.conversas[jid] || []).length) {
        log('⏭️ Ignorado: agenda ainda não mapeada — por segurança não respondo número oculto');
        continue;
      }
      if ((db.pausados[jid] || 0) > Date.now()) { log('⏸️ Não respondido: conversa pausada (atendimento humano)'); continue; }
      // Junta mensagens seguidas (a pessoa manda 2-3 balões): espera ela parar de digitar e responde UMA vez
      if (naoEntendi) { const ant = fila.get(jid) || Promise.resolve(); fila.set(jid, ant.then(() => responder(sock, jid, t, tel, ehAudio, naoEntendi)).catch(e => log('❌ Erro:', e.message))); continue; }
      const b = buffers.get(jid) || { textos: [], audio: false };
      b.textos.push(t); b.audio = b.audio || ehAudio; clearTimeout(b.timer);
      b.timer = setTimeout(() => {
        buffers.delete(jid);
        const junto = b.textos.join('\n');
        const ant = fila.get(jid) || Promise.resolve();
        fila.set(jid, ant.then(() => responder(sock, jid, junto, tel, b.audio, null)).catch(e => { log('❌ Erro:', e.message); status('erro', { erro: e.message }); }));
      }, (cfg.esperaJuntarSegundos || 8) * 1000);
      buffers.set(jid, b);
    }
  });
}

async function responder(sock, jid, t, telefone, veioAudio = false, naoEntendi = null) {
  if (naoEntendi) { // resposta fixa, sem IA, para áudio não compreendido
    db.falhasAudio = db.falhasAudio || {}; db.falhasAudio[jid] = (db.falhasAudio[jid] || 0) + 1; salvar();
    if (db.falhasAudio[jid] >= 3) {
      db.falhasAudio[jid] = 0; db.pausados[jid] = Date.now() + cfg.pausaAposHumanoHoras * 3600e3; salvar();
      await enviarAudio(sock, jid, 'Poxa, tô com dificuldade pra ouvir seus áudios. Vou te passar agora pro Mikhael, que já te responde por aqui, beleza?');
      await avisar(sock, `🙋 Morfeus não entendeu 3 áudios seguidos e transferiu para você\nContato: ${telefone}`);
      return;
    }
    const msg = audio ? audio.RESPOSTAS_NAO_ENTENDI[naoEntendi] || audio.RESPOSTAS_NAO_ENTENDI.falha : 'Não consegui ouvir seu áudio, pode escrever aqui?';
    await (audio ? enviarAudio(sock, jid, msg) : enviar(sock, jid, msg));
    return;
  }
  if (veioAudio && db.falhasAudio) { db.falhasAudio[jid] = 0; }
  let pctx = null; if (prosp) try { pctx = prosp.contexto(jid, telefone); } catch (e) { log('Prospecção: erro no contexto', e.message); } // contato com tag de prospecção usa o roteiro de site
  const conv = db.conversas[jid] = db.conversas[jid] || [];
  if (t.toLowerCase() === '#reset') { db.conversas[jid] = []; delete db.pausados[jid]; salvar(); await enviar(sock, jid, 'Conversa reiniciada (teste).'); return; }
  if (OPTOUT.test(t)) {
    db.optout[jid] = Date.now(); salvar();
    await enviar(sock, jid, 'Tudo bem! Não vamos mais te enviar mensagens. Obrigado pelo contato. 🙏');
    return;
  }
  conv.push({ role: 'user', content: t });
  log('📩', telefone, '>', t.slice(0, 80));
  if (matrix) matrix.registrar('recebida', { jid, telefone, texto: t, veioAudio }); // Matrix CRM: só aviso, não espera
  while (conv.length > cfg.maxHistorico) conv.shift();
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  let resp;
  const meta = { telefone, veioAudio, prospeccao: !!pctx };
  try { resp = await ia(conv, pctx && pctx.system, meta); }
  catch (e) {
    await espera(30000);
    try { resp = await ia(conv, pctx && pctx.system, meta); }
    catch (e2) {
      log('❌ IA indisponível, avisando humano');
      await enviar(sock, jid, 'Recebi sua mensagem! 🙏 Em instantes o Mikhael te responde por aqui.');
      db.pausados[jid] = Date.now() + cfg.pausaAposHumanoHoras * 3600e3; salvar();
      await avisar(sock, `⚠️ Morfeus ficou sem IA e passou o atendimento para você\nContato: ${telefone}\nMensagem: "${t.slice(0, 200)}"`);
      return;
    }
  }
  let lead = null;
  const i = resp.indexOf('[LEAD_QUALIFICADO]');
  if (i >= 0) { lead = resp.slice(i + 18).trim(); resp = resp.slice(0, i).trim(); }
  const ultima = [...conv].reverse().find(x => x.role === 'assistant');
  const norm = x => (x || '').toLowerCase().replace(/[^a-zà-ú0-9 ]/g, '').trim();
  if (ultima && resp && norm(resp) === norm(ultima.content)) { log('🔁 Resposta repetida evitada'); salvar(); return; }
  let chamarNumero = null;
  const cn = resp.match(/\[CHAMAR_NUMERO\]\s*([+\d\s().-]{8,20})/);
  if (cn) { chamarNumero = cn[1].replace(/\D/g, ''); resp = resp.replace(cn[0], '').trim(); }
  let transferir = null;
  const k = resp.indexOf('[TRANSFERIR]');
  if (k >= 0) { const mot = resp.slice(k + 12).trim(); resp = resp.slice(0, k).trim(); if (mot.length > 3 && /transfer/i.test(resp)) transferir = mot; else if (mot.length > 3) log('⚠️ Marca de transferência ignorada (sem aviso ao cliente)'); }
  await espera(Math.min(8000, 1500 + resp.length * 40)); // digitação com ritmo humano
  if (resp) { log('🤖 resposta para', jid.split('@')[0], '>', resp.slice(0, 80)); await (veioAudio && cfg.responderAudioComAudio !== false && audio ? enviarAudio(sock, jid, resp) : enviar(sock, jid, resp)); conv.push({ role: 'assistant', content: resp }); }
  salvar();
  if (matrix) { // registra no Matrix CRM (linha do tempo do paciente); nunca atrasa o atendimento
    if (resp) matrix.registrar('enviada', { jid, telefone, texto: resp });
    if (transferir) matrix.registrar('transferido', { jid, telefone, texto: transferir });
    if (lead) matrix.registrar('lead_qualificado', { jid, telefone, texto: lead });
  }
  if (n8n) { // avisos para as automações do n8n (fluxo "Morfeus - Eventos"); nunca atrasam o atendimento
    if (resp) n8n.evento('mensagem_respondida', { telefone, mensagem: t, resposta: resp, veioAudio });
    if (transferir) n8n.evento('transferido_para_humano', { telefone, motivo: transferir, mensagem: t });
    if (lead) n8n.evento('lead_qualificado', { telefone, lead });
  }
  if (pctx) try { prosp.aposResposta(jid, telefone, conv); } catch (e) { log('Prospecção: erro ao registrar', e.message); }
  if (chamarNumero) await chamarOutroNumero(sock, jid, chamarNumero, telefone);
  if (transferir) {
    db.pausados[jid] = Date.now() + cfg.pausaAposHumanoHoras * 3600e3; salvar(); // robô sai da conversa
    log('🙋 Transferido para humano:', telefone, transferir);
    await avisar(sock, `🙋 Morfeus transferiu um atendimento para você\nContato: ${telefone}\nMotivo: ${transferir}\nÚltima mensagem: "${t.slice(0, 200)}"`);
  }
  if (lead) {
    const tel = telefone;
    db.leads.push({ tel, lead, em: new Date().toISOString() }); salvar();
    fs.appendFileSync(path.join(DIR, 'leads.csv'), `"${new Date().toLocaleString('pt-BR')}","${tel}","${lead.replace(/"/g, "'")}"\n`);
    await avisar(sock, `🔥 Novo lead qualificado (Morfeus)\nContato: ${tel}\n${lead}`);
    log('🔥 Lead qualificado:', tel, lead);
    await agendarGoogle(lead, tel);
  }
}

async function agendarGoogle(lead, tel) {
  const campos = lead.split('|').map(x => x.trim());
  const iso = (campos[campos.length - 1].match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) || [])[0];
  if (!cfg.agendaUrl || !iso) { log('📅 Agenda Google: não configurada ou sem data'); return; }
  try {
    const r = await fetch(cfg.agendaUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, redirect: 'follow',
      body: JSON.stringify({ titulo: `Call diagnóstico - ${campos[0]} (${campos[1] || ''})`, inicio: iso, duracaoMin: 30,
        descricao: `Lead via Morfeus\nContato WhatsApp: ${tel}\n` + campos.join('\n') }) });
    log('📅 Agenda Google:', r.ok ? 'evento criado ' + iso : 'erro ' + r.status);
  } catch (e) { log('📅 Agenda Google falhou:', e.message); }
}

// Lead pediu para ser chamado em outro número: valida no WhatsApp, chama lá e leva o histórico junto
async function chamarOutroNumero(sock, jidOrigem, digitos, telefone) {
  db.redirecionados = db.redirecionados || {};
  if ((db.redirecionados[jidOrigem] || 0) >= 2) { log('📲 Pedido de outro número ignorado (limite atingido)'); return; }
  let d = digitos.replace(/^0+/, ''); if (!d.startsWith('55')) d = '55' + d;
  const ddd = d.slice(2, 4), resto = d.slice(4);
  const variantes = [...new Set([d, resto.length === 8 ? '55' + ddd + '9' + resto : null, resto.length === 9 && resto[0] === '9' ? '55' + ddd + resto.slice(1) : null].filter(Boolean))];
  let alvo = null;
  try { const res = await sock.onWhatsApp(...variantes); alvo = (res || []).find(r => r.exists); } catch (e) { log('📲 Erro ao verificar número:', e.message); }
  if (!alvo) {
    log('📲 Número informado não tem WhatsApp:', digitos);
    await enviar(sock, jidOrigem, 'Opa, não encontrei WhatsApp nesse número. Pode me confirmar ele completo, com DDD?');
    return;
  }
  const pr = podeResponder([alvo.jid, alvo.lid].filter(Boolean));
  if (!pr.ok) { // é contato salvo seu: não chama, só te avisa
    log('📲 Número pedido é contato salvo (' + pr.nome + '): não enviei, avisei o Mikhael');
    await avisar(sock, `📲 O contato ${telefone} pediu para ser chamado no número +${alvo.jid.split('@')[0]}, que está salvo na sua agenda como "${pr.nome}". Não enviei nada por lá — chame você.`);
    return;
  }
  db.redirecionados[jidOrigem] = (db.redirecionados[jidOrigem] || 0) + 1;
  db.conversas[alvo.jid] = [...(db.conversas[jidOrigem] || [])]; // continua a mesma conversa no novo número
  delete db.pausados[alvo.jid]; salvar();
  await espera(3000);
  await enviar(sock, alvo.jid, 'Oi! Aqui é o Morfeus, agente de IA do Mikhael Santos 🙂 Você pediu pra eu te chamar neste número, então vamos continuar por aqui!');
  log('📲 Chamou o lead no outro número:', alvo.jid.split('@')[0]);
}

async function avisar(sock, msg) {
  if (/^\d{12,13}$/.test(cfg.numeroAvisoLeads) && !cfg.numeroAvisoLeads.endsWith('999999999'))
    await enviar(sock, cfg.numeroAvisoLeads + '@s.whatsapp.net', msg).catch(e => log('Aviso falhou:', e.message));
}

async function enviarAudio(sock, jid, msg) {
  try {
    await sock.sendPresenceUpdate('recording', jid).catch(() => {});
    const ogg = await audio.falar(msg, cfg);
    fila.set(jid + ':bot', true);
    const r = await sock.sendMessage(jid, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true });
    if (r?.key?.id) enviadasPeloRobo.add(r.key.id);
    setTimeout(() => fila.delete(jid + ':bot'), 5000);
    log('🎙️ Respondeu em áudio');
  } catch (e) { log('🎙️ Falha ao gravar áudio, enviando texto:', e.message); await enviar(sock, jid, msg); }
}

async function enviar(sock, jid, msg) {
  fila.set(jid + ':bot', true);
  try { await sock.sendPresenceUpdate('paused', jid).catch(() => {}); const r = await sock.sendMessage(jid, { text: msg }); if (r?.key?.id) enviadasPeloRobo.add(r.key.id); }
  finally { setTimeout(() => fila.delete(jid + ':bot'), 5000); }
}

// Liga a Unidade (cérebro) e o n8n (fluxos) se estiverem desligados. O Morfeus atende sem eles, pelo caminho antigo.
function ligarApoios() {
  if (process.platform !== 'win32') return;
  const net = require('net'), { spawn } = require('child_process');
  const abrir = (porta, bat, titulo) => {
    if (!fs.existsSync(bat)) return;
    const s = net.connect(porta, '127.0.0.1'); s.setTimeout(800, () => s.destroy()); s.on('connect', () => s.destroy());
    s.on('error', () => { try { spawn('cmd', ['/c', 'start', `"${titulo}"`, '/min', 'cmd', '/c', bat], { cwd: path.dirname(bat), detached: true, windowsHide: true }).unref(); log('▶️ Ligando', titulo); } catch (e) { log('Não consegui ligar', titulo + ':', e.message); } });
  };
  if ((cfg.unidade || {}).ativo === true) abrir(7780, path.join(DIR, '..', 'unidade', 'INICIAR-UNIDADE.bat'), 'Unidade');
  if ((cfg.n8n || {}).ativo === true) abrir(5678, path.join(DIR, '..', 'Apps', 'n8n', 'INICIAR-N8N.bat'), 'n8n');
}

process.on('unhandledRejection', e => log('Erro:', e?.message || e));
status('iniciando'); ligarApoios(); iniciar();
