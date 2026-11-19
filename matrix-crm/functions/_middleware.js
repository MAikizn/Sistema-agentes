// MATRIX CRM · servidor (Cloudflare Pages Functions): login real, sessões e isolamento por subconta.
const ITER = 100000, SESSAO_MS = 12 * 3600 * 1000, JANELA_MS = 15 * 60 * 1000, enc = new TextEncoder();
const COOKIE = '__Host-sessao';
const AGENTES = { recepcionista: 'ag_recepcionista', sdr: 'ag_sdr', lembretes: 'ag_lembretes', pos: 'ag_pos' };
const FUNCOES = { 'Administrador da clínica': 'admin', Atendente: 'atendente', Dentista: 'dentista', admin: 'admin', atendente: 'atendente', dentista: 'dentista' };
const FALSO = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const deb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async t => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
async function derivar(senha, sal) {
  const k = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITER }, k, 256));
}
async function criarHash(senha) { const sal = crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2$${ITER}$${b64(sal)}$${b64(await derivar(senha, sal))}`; }
async function conferir(senha, guardado) {
  const p = String(guardado || '').split('$'); if (p.length !== 4) return false;
  const a = await derivar(senha, deb64(p[2])), b = deb64(p[3]); if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0;
}
// ----- verificação em 2 fatores (código de 6 números do app autenticador, padrão TOTP) -----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(bytes) { let bits = 0, v = 0, o = ''; for (const b of bytes) { v = ((v << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) o += B32[(v << (5 - bits)) & 31]; return o; }
function b32dec(t) { let bits = 0, v = 0; const o = []; for (const ch of String(t)) { const i = B32.indexOf(ch); if (i < 0) continue; v = ((v << 5) | i) & 0xffff; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(o); }
function igual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function totpCodigo(segredo, passo) {
  const k = await crypto.subtle.importKey('raw', b32dec(segredo), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const m = new Uint8Array(8); new DataView(m.buffer).setUint32(4, passo);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, m)), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
async function totpPasso(segredo, codigo) { if (!segredo || !/^\d{6}$/.test(codigo)) return 0; const agora = Math.floor(Date.now() / 30000); let achou = 0; for (const p of [agora - 1, agora, agora + 1]) if (igual(await totpCodigo(segredo, p), codigo)) achou = p; return achou; }
const exige2f = f => f === 'dono' || f === 'admin';
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
function seg(r) {
  const h = r.headers;
  h.set('X-Content-Type-Options', 'nosniff'); h.set('X-Frame-Options', 'DENY'); h.set('Referrer-Policy', 'same-origin'); h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return r;
}
const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const idOk = v => /^[\w-]{1,40}$/.test(String(v || ''));
const emailOk = v => /^[^\s@]{1,64}@[^\s@]{1,80}\.[^\s@]{2,}$/.test(v);
const corOk = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const ESTATICO = /\.(css|js|png|jpe?g|svg|ico|webp|woff2?)$/;
// lê o corpo com limite de tamanho, mesmo se o tamanho não for informado
async function lerCorpo(req) {
  const leitor = req.body && req.body.getReader(); if (!leitor) return {};
  const partes = []; let n = 0;
  for (;;) { const { done, value } = await leitor.read(); if (done) break; n += value.length; if (n > 20000) { try { await leitor.cancel(); } catch {} return null; } partes.push(value); }
  const tudo = new Uint8Array(n); let i = 0; for (const x of partes) { tudo.set(x, i); i += x.length; }
  try { const o = JSON.parse(new TextDecoder().decode(tudo) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
const senhaOk = v => typeof v === 'string' && v.length >= 10 && v.length <= 128;

async function sessao(req, env) {
  const c = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-sessao=([a-f0-9]{64})/); if (!c) return null;
  const s = await env.DB.prepare('SELECT s.id sid, s.vendo, u.id, u.nome, u.email, u.funcao, u.subconta_id, u.trocar_senha, u.senha_hash, u.totp_ativo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ? AND s.expira > ? AND u.ativo = 1').bind(await sha256(c[1]), Date.now()).first();
  if (!s) return null;
  s.sub = s.funcao === 'dono' ? s.vendo : s.subconta_id; s.falta2f = exige2f(s.funcao) && !s.totp_ativo;
  if (s.funcao !== 'dono') { const a = await env.DB.prepare('SELECT ativa FROM subcontas WHERE id = ?').bind(s.subconta_id).first(); if (!a || !a.ativa) return null; }
  return s;
}
const anotar = (env, s, acao, detalhe, sub) => env.DB.prepare('INSERT INTO auditoria (quando, usuario_id, subconta_id, acao, detalhe) VALUES (?,?,?,?,?)').bind(Date.now(), s ? s.id : null, sub || (s && s.sub) || null, acao, detalhe || null).run();
const subJson = c => c && ({ id: c.id, nome: c.nome, cor: c.cor, ativa: !!c.ativa, clienteControla: !!c.cliente_controla, usuarios: c.usuarios || 0, agentes: { recepcionista: !!c.ag_recepcionista, sdr: !!c.ag_sdr, lembretes: !!c.ag_lembretes, pos: !!c.ag_pos } });

// ===== CRM (etapa 2 do banco: schema-etapa2-crm.sql; modelo copiado do Twenty CRM) =====
const CLASSES = ['etiqueta-info', 'etiqueta-erro', 'etiqueta-sucesso', 'etiqueta-alerta'];
const SAUDE = ['diabetes', 'gestante', 'fumante'];
const fone = v => String(v == null ? '' : v).replace(/\D/g, '').slice(0, 15);
// celular sempre gravado sem o 55 do Brasil: o WhatsApp manda 5511999990000 e as telas mandam (11) 99999-0000
const celular = v => { const d = fone(v); return /^55\d{10,11}$/.test(d) ? d.slice(2) : d; };
const novoId = () => crypto.randomUUID();
const objJson = t => { try { const o = JSON.parse(t || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const duplicado = e => /UNIQUE/i.test(String(e && e.message));
const evento = (db, sub, s, ev, props, alvo) => db.prepare('INSERT INTO linha_do_tempo (id, subconta_id, acontece_em, evento, propriedades, usuario_id, paciente_id, oportunidade_id) VALUES (?,?,?,?,?,?,?,?)')
  .bind(novoId(), sub, Date.now(), ev, JSON.stringify(props || {}), s.id, alvo.paciente || null, alvo.oportunidade || null);
async function etapasDa(db, sub) {
  let r = (await db.prepare('SELECT id, nome, cor, posicao, tipo FROM funil_etapas WHERE subconta_id = ? ORDER BY posicao, rowid').bind(sub).all()).results;
  if (!r.length) { const id = novoId(); await db.prepare("INSERT INTO funil_etapas (id, subconta_id, nome, posicao) VALUES (?,?,'Novo lead',0)").bind(id, sub).run(); r = [{ id, nome: 'Novo lead', cor: null, posicao: 0, tipo: 'aberta' }]; }
  return r;
}
const responsavelOk = async (db, sub, id) => !id || (idOk(id) && !!(await db.prepare('SELECT 1 FROM usuarios WHERE id = ? AND subconta_id = ? AND ativo = 1').bind(id, sub).first()));
const pacienteJson = x => ({ id: x.id, nome: [x.nome, x.sobrenome].filter(Boolean).join(' '), celular: x.celular || '', email: x.email || '', cpf: x.cpf || '', observacoes: x.observacoes || '', saude: objJson(x.saude), dentistaId: x.dentista_id || null, dentista: x.dentista || '', ultimaConsulta: x.ultima_consulta || null, proximoRetorno: x.proximo_retorno || null, etapa: x.etapa || '' });

async function rotasCrm(env, s, m, rota, corpo, agora) {
  const p = rota.split('/'); if (!['equipe', 'funil', 'pacientes', 'oportunidades'].includes(p[0])) return null;
  if (!s.sub) return json({ erro: 'Escolha um cliente primeiro.' }, 400);
  const db = env.DB, sub = s.sub;

  if (rota === 'equipe' && m === 'GET') {
    const r = await db.prepare("SELECT id, nome, funcao FROM usuarios WHERE subconta_id = ? AND ativo = 1 AND funcao != 'dono' ORDER BY nome").bind(sub).all();
    return json({ equipe: r.results });
  }
  if (rota === 'funil' && m === 'GET') {
    const etapas = await etapasDa(db, sub);
    const r = await db.prepare(`SELECT o.id, o.titulo, o.etapa_id, o.valor_centavos, o.extras, o.responsavel_id, u.nome responsavel, pa.id paciente_id, pa.celular
      FROM oportunidades o LEFT JOIN pacientes pa ON pa.id = o.paciente_id LEFT JOIN usuarios u ON u.id = o.responsavel_id
      WHERE o.subconta_id = ? AND o.apagado_em IS NULL ORDER BY o.posicao, o.criado_em LIMIT 2000`).bind(sub).all();
    return json({
      etapas: etapas.map(e => ({ id: e.id, nome: e.nome, cor: e.cor, tipo: e.tipo })),
      cards: r.results.map(o => { const x = objJson(o.extras); return { id: o.id, nome: o.titulo, etapaId: o.etapa_id, valor: (o.valor_centavos || 0) / 100, etiqueta: x.etiqueta || '', situacao: x.situacao || '', classe: CLASSES.includes(x.classe) ? x.classe : 'etiqueta-info', responsavelId: o.responsavel_id, responsavel: o.responsavel || '', pacienteId: o.paciente_id, celular: o.celular || '' }; }),
    });
  }
  if (rota === 'funil/etapas' && m === 'POST') {
    const nome = texto(corpo.nome, 40); if (!nome) return json({ erro: 'Informe o nome da etapa.' }, 400);
    const etapas = await etapasDa(db, sub); if (etapas.length >= 20) return json({ erro: 'Limite de 20 etapas.' }, 400);
    const id = novoId();
    await db.prepare('INSERT INTO funil_etapas (id, subconta_id, nome, posicao) VALUES (?,?,?,?)').bind(id, sub, nome, Math.max(...etapas.map(e => e.posicao)) + 1).run();
    await anotar(env, s, 'criou_etapa', nome); return json({ ok: true, id });
  }
  if (p[0] === 'funil' && p[1] === 'etapas' && idOk(p[2]) && p.length === 3 && m === 'DELETE') {
    const etapas = await etapasDa(db, sub), primeira = etapas[0], alvo = etapas.find(e => e.id === p[2]);
    if (!alvo) return json({ erro: 'Etapa não encontrada' }, 404);
    if (alvo.id === primeira.id) return json({ erro: 'A primeira etapa não pode ser removida.' }, 400);
    await db.batch([
      db.prepare('UPDATE oportunidades SET etapa_id = ?, atualizado_em = ? WHERE etapa_id = ? AND subconta_id = ?').bind(primeira.id, agora, alvo.id, sub),
      db.prepare('DELETE FROM funil_etapas WHERE id = ? AND subconta_id = ?').bind(alvo.id, sub),
    ]);
    await anotar(env, s, 'removeu_etapa', alvo.nome); return json({ ok: true });
  }
  if (rota === 'oportunidades' && m === 'POST') {
    const nome = texto(corpo.nome, 80), cel = celular(corpo.celular); if (!nome) return json({ erro: 'Informe o nome do lead.' }, 400);
    const etapas = await etapasDa(db, sub), etapa = etapas.find(e => e.id === corpo.etapaId) || etapas[0];
    const resp = corpo.responsavelId ? String(corpo.responsavelId) : null; if (!(await responsavelOk(db, sub, resp))) return json({ erro: 'Responsável inválido' }, 400);
    const pac = cel ? await db.prepare('SELECT id FROM pacientes WHERE subconta_id = ? AND celular = ? AND apagado_em IS NULL').bind(sub, cel).first() : null;
    const pacId = pac ? pac.id : novoId(), opId = novoId(), ops = [];
    if (!pac) ops.push(db.prepare("INSERT INTO pacientes (id, subconta_id, nome, celular, dentista_id, origem, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,'funil',?,?,?)").bind(pacId, sub, nome, cel || null, resp, s.id, agora, agora), evento(db, sub, s, 'paciente.criado', { nome }, { paciente: pacId }));
    const extras = JSON.stringify({ etiqueta: texto(corpo.etiqueta, 40), situacao: texto(corpo.situacao, 30), classe: CLASSES.includes(corpo.classe) ? corpo.classe : 'etiqueta-info' });
    const valor = Math.max(0, Math.min(1e11, Math.round(Number(corpo.valor) * 100) || 0));
    ops.push(db.prepare('INSERT INTO oportunidades (id, subconta_id, titulo, valor_centavos, etapa_id, paciente_id, responsavel_id, extras, posicao, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(opId, sub, nome, valor, etapa.id, pacId, resp, extras, agora, s.id, agora, agora),
      evento(db, sub, s, 'oportunidade.criada', { etapa: etapa.nome }, { paciente: pacId, oportunidade: opId }));
    await db.batch(ops); return json({ ok: true, id: opId, pacienteId: pacId });
  }
  if (p[0] === 'oportunidades' && idOk(p[1]) && p.length === 2 && m === 'PATCH') {
    const o = await db.prepare('SELECT o.id, o.paciente_id, o.etapa_id, e.nome etapa FROM oportunidades o LEFT JOIN funil_etapas e ON e.id = o.etapa_id WHERE o.id = ? AND o.subconta_id = ? AND o.apagado_em IS NULL').bind(p[1], sub).first();
    if (!o) return json({ erro: 'Card não encontrado' }, 404);
    const nova = idOk(corpo.etapaId) ? await db.prepare('SELECT id, nome FROM funil_etapas WHERE id = ? AND subconta_id = ?').bind(corpo.etapaId, sub).first() : null;
    if (!nova) return json({ erro: 'Etapa inválida' }, 400);
    if (nova.id === o.etapa_id) return json({ ok: true });
    await db.batch([
      db.prepare('UPDATE oportunidades SET etapa_id = ?, atualizado_em = ? WHERE id = ?').bind(nova.id, agora, o.id),
      evento(db, sub, s, 'oportunidade.etapa', { de: o.etapa, para: nova.nome }, { paciente: o.paciente_id, oportunidade: o.id }),
    ]);
    return json({ ok: true });
  }
  if (rota === 'pacientes' && m === 'GET') {
    const r = await db.prepare(`SELECT pa.*, u.nome dentista,
      (SELECT e.nome FROM oportunidades o JOIN funil_etapas e ON e.id = o.etapa_id WHERE o.paciente_id = pa.id AND o.apagado_em IS NULL ORDER BY o.atualizado_em DESC LIMIT 1) etapa
      FROM pacientes pa LEFT JOIN usuarios u ON u.id = pa.dentista_id WHERE pa.subconta_id = ? AND pa.apagado_em IS NULL ORDER BY pa.nome LIMIT 2000`).bind(sub).all();
    return json({ pacientes: r.results.map(pacienteJson) });
  }
  if (rota === 'pacientes' && m === 'POST') {
    const nome = texto(corpo.nome, 80), cel = celular(corpo.celular); if (!nome) return json({ erro: 'Informe o nome do lead.' }, 400);
    const dent = corpo.dentistaId ? String(corpo.dentistaId) : null; if (!(await responsavelOk(db, sub, dent))) return json({ erro: 'Dentista inválido' }, 400);
    const id = novoId();
    try {
      await db.batch([
        db.prepare("INSERT INTO pacientes (id, subconta_id, nome, celular, dentista_id, origem, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,'manual',?,?,?)").bind(id, sub, nome, cel || null, dent, s.id, agora, agora),
        evento(db, sub, s, 'paciente.criado', { nome }, { paciente: id }),
      ]);
    } catch (e) { if (duplicado(e)) return json({ erro: 'Já existe um lead com este celular.' }, 409); throw e; }
    return json({ ok: true, id });
  }
  if (p[0] === 'pacientes' && idOk(p[1]) && p.length === 2 && m === 'GET') {
    const x = await db.prepare('SELECT pa.*, u.nome dentista FROM pacientes pa LEFT JOIN usuarios u ON u.id = pa.dentista_id WHERE pa.id = ? AND pa.subconta_id = ? AND pa.apagado_em IS NULL').bind(p[1], sub).first();
    if (!x) return json({ erro: 'Lead não encontrado' }, 404);
    const ops = await db.prepare('SELECT o.id, o.titulo, o.valor_centavos, e.nome etapa FROM oportunidades o LEFT JOIN funil_etapas e ON e.id = o.etapa_id WHERE o.paciente_id = ? AND o.subconta_id = ? AND o.apagado_em IS NULL ORDER BY o.criado_em DESC').bind(x.id, sub).all();
    const lt = await db.prepare('SELECT l.acontece_em, l.evento, l.propriedades, u.nome usuario FROM linha_do_tempo l LEFT JOIN usuarios u ON u.id = l.usuario_id WHERE l.paciente_id = ? AND l.subconta_id = ? ORDER BY l.acontece_em DESC LIMIT 50').bind(x.id, sub).all();
    return json({
      paciente: pacienteJson(x),
      oportunidades: ops.results.map(o => ({ id: o.id, titulo: o.titulo, valor: (o.valor_centavos || 0) / 100, etapa: o.etapa || '' })),
      linhaDoTempo: lt.results.map(l => ({ quando: l.acontece_em, evento: l.evento, propriedades: objJson(l.propriedades), usuario: l.usuario || 'Agente' })),
    });
  }
  if (p[0] === 'pacientes' && idOk(p[1]) && p.length === 2 && m === 'PATCH') {
    const x = await db.prepare('SELECT * FROM pacientes WHERE id = ? AND subconta_id = ? AND apagado_em IS NULL').bind(p[1], sub).first();
    if (!x) return json({ erro: 'Lead não encontrado' }, 404);
    const sets = [], vals = [], mudou = [];
    const pega = (campo, col, valor) => { if (corpo[campo] == null) return; const v = valor === '' ? null : valor; if (v === x[col]) return; sets.push(col + ' = ?'); vals.push(v); mudou.push(campo); };
    if (corpo.nome != null && !texto(corpo.nome, 80)) return json({ erro: 'O nome não pode ficar vazio.' }, 400);
    if (corpo.email != null && corpo.email !== '' && !emailOk(String(corpo.email).trim())) return json({ erro: 'E-mail inválido.' }, 400);
    pega('nome', 'nome', texto(corpo.nome, 80)); pega('celular', 'celular', celular(corpo.celular)); pega('email', 'email', texto(corpo.email, 150).toLowerCase());
    pega('cpf', 'cpf', fone(corpo.cpf).slice(0, 11)); pega('observacoes', 'observacoes', texto(corpo.observacoes, 4000));
    if (corpo.saude && typeof corpo.saude === 'object') { const sd = objJson(x.saude), antes = JSON.stringify(sd); for (const k of SAUDE) if (corpo.saude[k] != null) sd[k] = !!corpo.saude[k]; if (JSON.stringify(sd) !== antes) { sets.push('saude = ?'); vals.push(JSON.stringify(sd)); mudou.push('saude'); } }
    if (corpo.dentistaId !== undefined) { const d = corpo.dentistaId ? String(corpo.dentistaId) : null; if (!(await responsavelOk(db, sub, d))) return json({ erro: 'Dentista inválido' }, 400); if (d !== x.dentista_id) { sets.push('dentista_id = ?'); vals.push(d); mudou.push('dentista'); } }
    if (!sets.length) return json({ ok: true, semMudanca: true });
    try {
      await db.batch([
        db.prepare(`UPDATE pacientes SET ${sets.join(', ')}, atualizado_em = ? WHERE id = ?`).bind(...vals, agora, x.id),
        evento(db, sub, s, 'paciente.atualizado', { campos: mudou }, { paciente: x.id }),
      ]);
    } catch (e) { if (duplicado(e)) return json({ erro: 'Já existe outro lead com este celular.' }, 409); throw e; }
    return json({ ok: true });
  }
  return json({ erro: 'Não encontrado' }, 404);
}

// ===== Integração WhatsApp (Morfeus -> Matrix) =====
// Cada mensagem vira um item na linha do tempo do paciente; o paciente e o card no funil são criados na 1ª mensagem recebida.
const TIPOS_WPP = ['recebida', 'enviada', 'humano', 'transferido', 'lead_qualificado'];
async function integracaoWhatsapp(req, env, corpo, agora) {
  const db = env.DB;
  const tk = (req.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
  const integ = tk ? await db.prepare('SELECT i.id, i.subconta_id FROM integracoes i JOIN subcontas c ON c.id = i.subconta_id WHERE i.token_hash = ? AND i.ativa = 1 AND c.ativa = 1').bind(await sha256(tk[1])).first() : null;
  if (!integ) return json({ erro: 'Chave de integração inválida' }, 401);
  const sub = integ.subconta_id, tipo = String(corpo.tipo || '');
  if (!TIPOS_WPP.includes(tipo)) return json({ erro: 'Tipo inválido' }, 400);
  const cel = corpo.lid ? '' : celular(corpo.telefone), wid = texto(corpo.whatsappId, 60);
  if (!cel && !wid) return json({ erro: 'Informe o telefone' }, 400);
  const quando = Math.abs(Number(corpo.em) - agora) < 86400e3 ? Math.round(Number(corpo.em)) : agora;
  const msg = texto(corpo.texto, 2000), nomeWpp = texto(corpo.nome, 80);
  const sistema = { id: null };
  let pac = cel ? await db.prepare('SELECT id, nome FROM pacientes WHERE subconta_id = ? AND celular = ? AND apagado_em IS NULL').bind(sub, cel).first() : null;
  if (!pac && wid) pac = await db.prepare("SELECT id, nome FROM pacientes WHERE subconta_id = ? AND json_extract(extras, '$.whatsapp') = ? AND apagado_em IS NULL").bind(sub, wid).first();
  const ops = [];
  if (!pac) {
    if (tipo !== 'recebida' && tipo !== 'lead_qualificado') return json({ ok: true, ignorado: 'sem paciente' }); // só cria paciente quando a pessoa fala com a gente
    pac = { id: novoId(), nome: nomeWpp || (cel ? 'WhatsApp ' + cel : 'WhatsApp') };
    ops.push(db.prepare("INSERT INTO pacientes (id, subconta_id, nome, celular, origem, extras, criado_em, atualizado_em) VALUES (?,?,?,?,'whatsapp',?,?,?)").bind(pac.id, sub, pac.nome, cel || null, JSON.stringify(wid ? { whatsapp: wid } : {}), agora, agora),
      evento(db, sub, sistema, 'paciente.criado', { nome: pac.nome, origem: 'whatsapp' }, { paciente: pac.id }));
  }
  let op = await db.prepare('SELECT id, extras FROM oportunidades WHERE paciente_id = ? AND subconta_id = ? AND apagado_em IS NULL ORDER BY atualizado_em DESC LIMIT 1').bind(pac.id, sub).first();
  if (!op && (tipo === 'recebida' || tipo === 'lead_qualificado')) {
    const etapa = (await etapasDa(db, sub))[0]; op = { id: novoId(), extras: '{}' };
    ops.push(db.prepare("INSERT INTO oportunidades (id, subconta_id, titulo, etapa_id, paciente_id, extras, posicao, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)").bind(op.id, sub, pac.nome, etapa.id, pac.id, JSON.stringify({ situacao: 'WhatsApp', classe: 'etiqueta-info' }), agora, agora, agora),
      evento(db, sub, sistema, 'oportunidade.criada', { etapa: etapa.nome, origem: 'whatsapp' }, { paciente: pac.id, oportunidade: op.id }));
  }
  if (op && (tipo === 'lead_qualificado' || tipo === 'transferido')) {
    const x = objJson(op.extras); Object.assign(x, tipo === 'lead_qualificado' ? { situacao: 'Lead qualificado', classe: 'etiqueta-sucesso' } : { situacao: 'Com humano', classe: 'etiqueta-alerta' });
    ops.push(db.prepare('UPDATE oportunidades SET extras = ?, atualizado_em = ? WHERE id = ?').bind(JSON.stringify(x), agora, op.id));
  }
  ops.push(db.prepare('INSERT INTO linha_do_tempo (id, subconta_id, acontece_em, evento, propriedades, usuario_id, paciente_id, oportunidade_id) VALUES (?,?,?,?,?,NULL,?,?)')
    .bind(novoId(), sub, quando, 'whatsapp.' + tipo, JSON.stringify({ texto: msg, audio: !!corpo.veioAudio }), pac.id, op ? op.id : null));
  ops.push(db.prepare('UPDATE integracoes SET ultimo_uso = ? WHERE id = ?').bind(agora, integ.id));
  try { await db.batch(ops); }
  catch (e) { if (duplicado(e) && !corpo._denovo) { corpo._denovo = 1; return integracaoWhatsapp(req, env, corpo, agora); } throw e; } // duas mensagens ao mesmo tempo: a outra já criou o paciente, então tenta de novo uma vez
  return json({ ok: true, pacienteId: pac.id });
}

async function api(req, env, url, rota) {
  const m = req.method, db = env.DB, agora = Date.now();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(m)) return json({ erro: 'Método não permitido' }, 405);
  if (m !== 'GET') {
    if (req.headers.get('X-Matrix') !== '1') return json({ erro: 'Requisição recusada' }, 403);
    const o = req.headers.get('Origin'); if (o && o !== url.origin) return json({ erro: 'Origem recusada' }, 403);
  }
  let corpo = {}; if (m !== 'GET') { corpo = await lerCorpo(req); if (corpo === null) return json({ erro: 'Dados grandes demais' }, 413); }
  const ip = req.headers.get('CF-Connecting-IP') || 'local';

  if (rota === 'login' && m === 'POST') {
    const email = String(corpo.email || '').trim().toLowerCase().slice(0, 150), senha = String(corpo.senha || '').slice(0, 128);
    const kp = 'p:' + email + '|' + ip, ki = 'i:' + ip, ke = 'e:' + email, LIM = { p: 5, i: 30, e: 50 };
    const t = await db.prepare('SELECT chave, n FROM tentativas WHERE chave IN (?, ?, ?) AND ate > ?').bind(kp, ki, ke, agora).all();
    for (const x of t.results) if (x.n >= LIM[x.chave[0]]) return json({ erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' }, 429);
    const u = await db.prepare('SELECT u.*, c.ativa sub_ativa FROM usuarios u LEFT JOIN subcontas c ON c.id = u.subconta_id WHERE u.email = ?').bind(email).first();
    const ok = await conferir(senha, u ? u.senha_hash : FALSO);
    const falhou = async msg => {
      const up = 'INSERT INTO tentativas (chave, n, ate) VALUES (?, 1, ?) ON CONFLICT(chave) DO UPDATE SET n = CASE WHEN ate > ? THEN n + 1 ELSE 1 END, ate = ?';
      await db.batch([kp, ki, ke].map(k => db.prepare(up).bind(k, agora + JANELA_MS, agora, agora + JANELA_MS)));
      await anotar(env, null, 'login_falhou', null, u ? u.subconta_id : null);
      return json({ erro: msg }, 401);
    };
    if (!u || !ok || !u.ativo) return falhou('E-mail ou senha incorretos.');
    if (u.funcao !== 'dono' && !u.sub_ativa) return json({ erro: 'Conta pausada. Fale com o suporte.' }, 403);
    if (u.totp_ativo) {
      const cod = String(corpo.codigo == null ? '' : corpo.codigo).replace(/[\s-]/g, '').toUpperCase().slice(0, 20);
      if (!cod) return json({ precisaCodigo: true });
      let certo = false;
      if (/^\d{6}$/.test(cod)) { const passo = await totpPasso(u.totp_secret, cod); if (passo && passo > (u.totp_ultimo || 0)) { certo = true; await db.prepare('UPDATE usuarios SET totp_ultimo = ? WHERE id = ?').bind(passo, u.id).run(); } }
      else if (/^[A-Z2-7]{10}$/.test(cod)) certo = (await db.prepare('DELETE FROM codigos_reserva WHERE hash = ? AND usuario_id = ?').bind(await sha256(cod), u.id).run()).meta.changes > 0;
      if (!certo) return falhou('Código incorreto ou já usado. Aguarde o próximo código do app e tente de novo.');
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await db.batch([
      db.prepare('DELETE FROM sessoes WHERE expira < ?').bind(agora),
      db.prepare('DELETE FROM tentativas WHERE chave = ? OR ate < ?').bind(kp, agora),
      db.prepare('INSERT INTO sessoes (id, token_hash, usuario_id, vendo, expira) VALUES (?,?,?,NULL,?)').bind(crypto.randomUUID(), await sha256(token), u.id, agora + SESSAO_MS),
    ]);
    await anotar(env, { id: u.id, sub: u.subconta_id }, 'login');
    return json({ ok: true, funcao: u.funcao }, 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSAO_MS / 1000}` });
  }

  // Integração do Morfeus (WhatsApp): entra com chave própria (Authorization: Bearer ...), presa a UMA subconta
  if (rota === 'integracao/whatsapp' && m === 'POST') return integracaoWhatsapp(req, env, corpo, agora);

  const s = await sessao(req, env); if (!s) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);

  if (rota === 'sair' && m === 'POST') {
    await db.prepare('DELETE FROM sessoes WHERE id = ?').bind(s.sid).run();
    return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }
  if (rota === 'eu' && m === 'GET') {
    const c = s.sub ? await db.prepare('SELECT * FROM subcontas WHERE id = ?').bind(s.sub).first() : null;
    const sub = subJson(c); if (sub) sub.podeMexer = s.funcao === 'dono' || (s.funcao === 'admin' && sub.clienteControla);
    return json({ nome: s.nome, email: s.email, funcao: s.funcao, trocarSenha: !!s.trocar_senha, configurar2f: !s.trocar_senha && s.falta2f, subconta: sub });
  }
  if (rota === 'senha' && m === 'POST') {
    if (!(await conferir(String(corpo.atual || '').slice(0, 128), s.senha_hash))) return json({ erro: 'A senha atual não confere.' }, 400);
    if (!senhaOk(corpo.nova) || corpo.nova === corpo.atual) return json({ erro: 'A nova senha precisa ter pelo menos 10 caracteres e ser diferente da atual.' }, 400);
    await db.batch([
      db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?').bind(await criarHash(corpo.nova), s.id),
      db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND id != ?').bind(s.id, s.sid),
    ]);
    await anotar(env, s, 'trocou_senha'); return json({ ok: true });
  }
  if (s.trocar_senha) return json({ erro: 'Troque a senha provisória para continuar.', codigo: 'trocar_senha' }, 403);

  if (rota === '2f/iniciar' && m === 'POST') {
    if (s.totp_ativo) return json({ erro: 'A verificação em 2 fatores já está ativa.' }, 400);
    // recarregar a página não troca a chave; só troca se a pessoa pedir uma nova
    const atual = await db.prepare('SELECT totp_secret FROM usuarios WHERE id = ?').bind(s.id).first();
    let chave = atual && atual.totp_secret;
    if (!chave || corpo.nova === true) {
      chave = b32enc(crypto.getRandomValues(new Uint8Array(20)));
      await db.prepare('UPDATE usuarios SET totp_secret = ? WHERE id = ?').bind(chave, s.id).run();
    }
    return json({ chave, link: `otpauth://totp/${encodeURIComponent('MATRIX CRM:' + s.email)}?secret=${chave}&issuer=${encodeURIComponent('MATRIX CRM')}` });
  }
  if (rota === '2f/confirmar' && m === 'POST') {
    if (s.totp_ativo) return json({ erro: 'A verificação em 2 fatores já está ativa.' }, 400);
    const u = await db.prepare('SELECT totp_secret FROM usuarios WHERE id = ?').bind(s.id).first();
    const passo = await totpPasso(u && u.totp_secret, String(corpo.codigo || '').replace(/\s/g, ''));
    if (!passo) return json({ erro: 'Código incorreto. Confira se a chave do app é a que aparece na tela e se o relógio deste computador e o do celular estão certos (diferença de mais de 1 minuto faz o código falhar).' }, 400);
    const codigos = []; for (let i = 0; i < 8; i++) codigos.push([...crypto.getRandomValues(new Uint8Array(10))].map(x => B32[x & 31]).join(''));
    const ops = [db.prepare('DELETE FROM codigos_reserva WHERE usuario_id = ?').bind(s.id), db.prepare('UPDATE usuarios SET totp_ativo = 1, totp_ultimo = ? WHERE id = ?').bind(passo, s.id)];
    for (const c of codigos) ops.push(db.prepare('INSERT INTO codigos_reserva (hash, usuario_id) VALUES (?, ?)').bind(await sha256(c), s.id));
    await db.batch(ops); await anotar(env, s, 'ativou_2_fatores'); return json({ ok: true, codigos });
  }
  if (s.falta2f) return json({ erro: 'Ative a verificação em 2 fatores para continuar.', codigo: 'configurar_2f' }, 403);

  if (rota === 'agentes' && m === 'PATCH') {
    if (!s.sub) return json({ erro: 'Escolha um cliente primeiro.' }, 400);
    const col = Object.prototype.hasOwnProperty.call(AGENTES, corpo.agente) ? AGENTES[corpo.agente] : null; if (!col) return json({ erro: 'Agente inválido' }, 400);
    const c = await db.prepare('SELECT cliente_controla FROM subcontas WHERE id = ?').bind(s.sub).first();
    if (!(s.funcao === 'dono' || (s.funcao === 'admin' && c && c.cliente_controla))) return json({ erro: 'Sem permissão para alterar os agentes.' }, 403);
    await db.prepare(`UPDATE subcontas SET ${col} = ? WHERE id = ?`).bind(corpo.ligado ? 1 : 0, s.sub).run();
    await anotar(env, s, 'agente', corpo.agente + '=' + (corpo.ligado ? 'ligado' : 'desligado')); return json({ ok: true });
  }

  // ---------- CRM da clínica (pacientes, funil, oportunidades): qualquer usuário da subconta ----------
  const crm = await rotasCrm(env, s, m, rota, corpo, agora); if (crm) return crm;

  // ---------- Daqui para baixo: só o dono da plataforma ----------
  if (s.funcao !== 'dono') return json({ erro: 'Sem permissão.' }, 403);
  const p = rota.split('/');

  if (rota === 'entrar-como' && m === 'POST') {
    const alvo = corpo.subconta == null ? null : String(corpo.subconta);
    if (alvo !== null && !(idOk(alvo) && await db.prepare('SELECT 1 FROM subcontas WHERE id = ?').bind(alvo).first())) return json({ erro: 'Cliente não encontrado' }, 404);
    await db.prepare('UPDATE sessoes SET vendo = ? WHERE id = ?').bind(alvo, s.sid).run();
    if (alvo) await anotar(env, s, 'entrou_como_cliente', null, alvo); return json({ ok: true });
  }
  if (rota === 'subcontas' && m === 'GET') {
    const r = await db.prepare('SELECT c.*, (SELECT COUNT(*) FROM usuarios u WHERE u.subconta_id = c.id) usuarios FROM subcontas c ORDER BY c.criada_em').all();
    return json({ subcontas: r.results.map(subJson) });
  }
  if (rota === 'subcontas' && m === 'POST') {
    const nome = texto(corpo.nome, 60), cor = corOk(corpo.cor) ? corpo.cor : '#00e676'; if (!nome) return json({ erro: 'Informe o nome do cliente.' }, 400);
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO subcontas (id, nome, cor, cliente_controla, criada_em) VALUES (?,?,?,?,?)').bind(id, nome, cor, corpo.clienteControla ? 1 : 0, agora).run();
    await anotar(env, s, 'criou_subconta', nome, id); return json({ ok: true, id });
  }
  if (p[0] === 'subcontas' && idOk(p[1]) && p.length === 2 && m === 'PATCH') {
    const sets = [], vals = [];
    if (corpo.nome != null) { const n = texto(corpo.nome, 60); if (!n) return json({ erro: 'Nome inválido' }, 400); sets.push('nome = ?'); vals.push(n); }
    if (corpo.cor != null) { if (!corOk(corpo.cor)) return json({ erro: 'Cor inválida' }, 400); sets.push('cor = ?'); vals.push(corpo.cor); }
    if (corpo.ativa != null) { sets.push('ativa = ?'); vals.push(corpo.ativa ? 1 : 0); }
    if (corpo.clienteControla != null) { sets.push('cliente_controla = ?'); vals.push(corpo.clienteControla ? 1 : 0); }
    if (corpo.agentes && typeof corpo.agentes === 'object') for (const k of Object.keys(AGENTES)) if (corpo.agentes[k] != null) { sets.push(AGENTES[k] + ' = ?'); vals.push(corpo.agentes[k] ? 1 : 0); }
    if (!sets.length) return json({ erro: 'Nada para alterar' }, 400);
    const r = await db.prepare(`UPDATE subcontas SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, p[1]).run();
    if (!r.meta.changes) return json({ erro: 'Cliente não encontrado' }, 404);
    if (corpo.ativa != null && !corpo.ativa) await db.prepare('DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE subconta_id = ?)').bind(p[1]).run();
    await anotar(env, s, 'alterou_subconta', sets.join(', ').replace(/ = \?/g, ''), p[1]); return json({ ok: true });
  }
  if (p[0] === 'subcontas' && idOk(p[1]) && p[2] === 'usuarios' && p.length === 3) {
    if (m === 'GET') {
      const r = await db.prepare("SELECT id, nome, email, funcao, ativo FROM usuarios WHERE subconta_id = ? AND funcao != 'dono' ORDER BY criado_em").bind(p[1]).all();
      return json({ usuarios: r.results.map(u => ({ id: u.id, nome: u.nome, email: u.email, funcao: u.funcao, ativo: !!u.ativo })) });
    }
    if (m === 'POST') {
      const nome = texto(corpo.nome, 60), email = String(corpo.email || '').trim().toLowerCase(), funcao = Object.prototype.hasOwnProperty.call(FUNCOES, corpo.funcao) ? FUNCOES[corpo.funcao] : null;
      if (!nome || !emailOk(email) || email.length > 150 || !funcao) return json({ erro: 'Confira nome, e-mail e função.' }, 400);
      if (!senhaOk(corpo.senha)) return json({ erro: 'A senha provisória precisa ter pelo menos 10 caracteres.' }, 400);
      if (!(await db.prepare('SELECT 1 FROM subcontas WHERE id = ?').bind(p[1]).first())) return json({ erro: 'Cliente não encontrado' }, 404);
      if (await db.prepare('SELECT 1 FROM usuarios WHERE email = ?').bind(email).first()) return json({ erro: 'Este e-mail já está cadastrado.' }, 409);
      await db.prepare('INSERT INTO usuarios (id, subconta_id, nome, email, senha_hash, funcao, ativo, trocar_senha, criado_em) VALUES (?,?,?,?,?,?,1,1,?)').bind(crypto.randomUUID(), p[1], nome, email, await criarHash(corpo.senha), funcao, agora).run();
      await anotar(env, s, 'criou_usuario', email + ' (' + funcao + ')', p[1]); return json({ ok: true });
    }
  }
  if (p[0] === 'usuarios' && idOk(p[1]) && p.length === 2 && (m === 'PATCH' || m === 'DELETE')) {
    const u = await db.prepare("SELECT id, email, subconta_id FROM usuarios WHERE id = ? AND funcao != 'dono'").bind(p[1]).first(); if (!u) return json({ erro: 'Usuário não encontrado' }, 404);
    const ops = [db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(u.id)];
    if (m === 'DELETE') ops.push(db.prepare('DELETE FROM codigos_reserva WHERE usuario_id = ?').bind(u.id), db.prepare('DELETE FROM usuarios WHERE id = ?').bind(u.id));
    else {
      if (corpo.ativo != null) ops.push(db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').bind(corpo.ativo ? 1 : 0, u.id));
      if (corpo.senha != null) { if (!senhaOk(corpo.senha)) return json({ erro: 'A senha provisória precisa ter pelo menos 10 caracteres.' }, 400); ops.push(db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, totp_ativo = 0, totp_secret = NULL WHERE id = ?').bind(await criarHash(corpo.senha), u.id), db.prepare('DELETE FROM codigos_reserva WHERE usuario_id = ?').bind(u.id)); }
      if (ops.length === 1) return json({ erro: 'Nada para alterar' }, 400);
    }
    await db.batch(ops);
    await anotar(env, s, m === 'DELETE' ? 'removeu_usuario' : 'alterou_usuario', u.email, u.subconta_id); return json({ ok: true });
  }
  return json({ erro: 'Não encontrado' }, 404);
}

export async function onRequest(ctx) {
  const { request, env, next } = ctx, url = new URL(request.url), p = url.pathname;
  try {
    if (p.startsWith('/api/')) return seg(await api(request, env, url, p.slice(5).replace(/\/$/, '')));
    // tudo exige login, menos a tela de login e os arquivos de aparência
    const pag = p.toLowerCase().replace(/^\//, '').replace(/\/$/, '').replace(/\.html$/, '');
    const publico = ['', 'index', 'login'].includes(pag) || ESTATICO.test(p.toLowerCase());
    let privada = false;
    if (!publico) {
      const s = await sessao(request, env);
      if (!s) return Response.redirect(url.origin + '/login.html', 302);
      if (pag === 'agencia' && s.funcao !== 'dono') return Response.redirect(url.origin + '/painel.html', 302);
      privada = true;
    }
    const o = await next(), r = seg(new Response(o.body, o)); if (privada) r.headers.set('Cache-Control', 'no-store'); return r;
  } catch (e) { console.error(e); return seg(json({ erro: 'Erro interno. Tente de novo.' }, 500)); }
}
