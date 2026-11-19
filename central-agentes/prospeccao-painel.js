// Painel de controle da prospecção de sites (Neo busca -> Morfeus aborda).
// Módulo separado da Central: serve a tela /prospeccao e a API /api/prospeccao.
// Só lê e grava os dois arquivos de configuração; não fala com o WhatsApp nem com o Google.
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..');
const NEO_DIR = path.join(DOCS, 'neo-prospeccao');
const MORF_DIR = path.join(DOCS, 'agente-whatsapp');
const NEO_CFG = path.join(NEO_DIR, 'config.json');
const MORF_CFG = path.join(MORF_DIR, 'prospeccao-config.json');

const ler = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
const gravar = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f); };
const int = (v, min, max, padrao) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const lista = (v, max) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/\r?\n/)).map(x => String(x).replace(/\s+/g, ' ').trim()).filter(x => x && x.length <= 80))].slice(0, max);
const DIAS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// limites de segurança: protegem o número do WhatsApp contra bloqueio
const LIM = { porDiaMax: 40, intervaloMin: 3, intervaloMax: 240 };

function estado() {
  const neo = ler(NEO_CFG, {}), morf = ler(MORF_CFG, {});
  const dados = ler(path.join(MORF_DIR, 'prospeccao-dados.json'), { processados: {}, contatos: {} });
  const fila = ler(path.join(NEO_DIR, 'fila.json'), []);
  const st = ler(path.join(MORF_DIR, 'prospeccao-status.json'), null);
  const stMorfeus = ler(path.join(MORF_DIR, 'status.json'), null);
  const contatos = Object.values(dados.contatos || {});
  const vivo = !!(st && st.em && Date.now() - new Date(st.em).getTime() < 3 * 60000);
  let ultimasBuscas = [];
  try { ultimasBuscas = fs.readFileSync(path.join(NEO_DIR, 'prospeccao.log'), 'utf8').trim().split(/\r?\n/).filter(l => /Resultado:|Busca falhou|desligada/.test(l)).slice(-3); } catch {}
  const temChave = !!(neo.googlePlacesApiKey && !/COLE_AQUI/i.test(neo.googlePlacesApiKey));
  return {
    limites: LIM,
    neo: { ativo: neo.ativo === true, horario: neo.horario || [8, 18], cidades: neo.cidades || [], nichos: neo.nichos || [],
      maxNovosPorDia: neo.maxNovosPorDia ?? 40, temChaveGoogle: temChave, fonte: neo.fonte === 'osm' || !temChave ? 'OpenStreetMap' : 'Google Places' },
    morfeus: { ativo: !!morf.ativo, simulacao: morf.simulacao !== false, horario: morf.horario || [8, 18], diasDaSemana: morf.diasDaSemana || DIAS,
      limitePorDia: morf.limitePorDia ?? 20, intervaloMinutos: morf.intervaloMinutos || [8, 20], mensagemInicial: morf.mensagemInicial || '', tag: morf.tag || 'prospeccao-site' },
    status: {
      // o módulo regrava o status a cada minuto: se está velho, o programa do Morfeus está fechado
      morfeusConectado: vivo && !!(stMorfeus && stMorfeus.estado === 'conectado'), moduloCarregado: vivo,
      situacao: vivo ? st.situacao : 'o programa do Morfeus está FECHADO: abra o INICIAR.bat dele (ou ligue pela Central) para os envios funcionarem', atualizadoEm: st ? st.em : null,
      enviadosHoje: st ? st.enviadosHoje : 0, naFila: fila.filter(l => { if (!l || !l.id) return false; const pr = (dados.processados || {})[l.id]; return !pr || (morf.simulacao === false && pr.status === 'simulado'); }).length, encontradasTotal: fila.length,
      abordadas: contatos.length, responderam: contatos.filter(c => c.respondeu).length, ultimasBuscas,
      planilha: path.join(MORF_DIR, 'prospeccao-respostas.csv') }
  };
}

function salvar(b) {
  const erros = [];
  const h0 = int(b.horaInicio, 0, 23, 8), h1 = int(b.horaFim, 1, 24, 18);
  if (h1 <= h0) erros.push('A hora final precisa ser maior que a inicial.');
  const dias = lista(b.dias, 7).filter(d => DIAS.includes(d));
  if (!dias.length) erros.push('Escolha pelo menos um dia da semana.');
  const cidades = lista(b.cidades, 30), nichos = lista(b.nichos, 80);
  if (!cidades.length) erros.push('Informe pelo menos uma cidade ou bairro.');
  const iMin = int(b.intervaloMin, LIM.intervaloMin, LIM.intervaloMax, 8), iMax = Math.max(iMin, int(b.intervaloMax, LIM.intervaloMin, LIM.intervaloMax, 20));
  const porDia = int(b.limitePorDia, 1, LIM.porDiaMax, 20);
  const msg = String(b.mensagemInicial || '').trim().slice(0, 700);
  if (msg.length < 40) erros.push('A primeira mensagem está vazia ou curta demais.');
  if (!/\bsair\b/i.test(msg)) erros.push('A primeira mensagem precisa dizer como parar de receber (ex.: "é só responder SAIR").');
  if (!/\b(IA|intelig[êe]ncia artificial|rob[ôo]|assistente virtual)\b/i.test(msg)) erros.push('A primeira mensagem precisa dizer que quem fala é uma IA.');
  if (erros.length) return { ok: false, erros };

  const neo = ler(NEO_CFG, null), morf = ler(MORF_CFG, null);
  if (!neo || !morf) return { ok: false, erros: ['Não achei os arquivos de configuração do Neo ou do Morfeus.'] };
  Object.assign(neo, { ativo: !!b.neoAtivo, horario: [h0, h1], cidades, ...(nichos.length ? { nichos } : {}) });
  Object.assign(morf, { ativo: !!b.morfeusAtivo, simulacao: b.simulacao !== false, horario: [h0, h1], diasDaSemana: dias, limitePorDia: porDia, intervaloMinutos: [iMin, iMax], mensagemInicial: msg });
  gravar(NEO_CFG, neo); gravar(MORF_CFG, morf);
  return { ok: true, estado: estado() };
}

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
async function tratar(req, res, p, { lerCorpo, json }) {
  if (p === '/prospeccao') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, 'prospeccao.html'))); }
  if (req.method === 'GET') return json(res, estado());
  if (req.method !== 'POST') return json(res, { erro: 'use GET ou POST' }, 405);
  const origem = req.headers.origin; // só páginas deste computador podem alterar a automação
  if (origem && !LOCAL.test(origem)) return json(res, { ok: false, erros: ['origem não permitida'] }, 403);
  const r = salvar(await lerCorpo(req));
  return json(res, r, r.ok ? 200 : 400);
}

module.exports = { tratar, _teste: { estado, salvar } };
