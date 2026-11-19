// NEO — analista de vídeos virais. Estuda os vídeos da pasta "referencias" (ou um arquivo indicado),
// mede o ritmo de verdade (cortes por minuto) e ensina a Niobe gravando lições no manual-profissional.json.
const fs = require('fs'), path = require('path');
const DIR = __dirname, REF = path.join(DIR, 'referencias'), MANUAL = path.join(DIR, 'manual-profissional.json');
const VIDEO = /\.(mp4|mov|mkv|avi|webm|m4v|wmv)$/i;

const SISTEMA = `Você é o NEO, analista de vídeos virais (Reels, TikTok, Shorts) e diretor de motion sênior.
Você recebe QUADROS de um vídeo de referência (com o segundo de cada um), as medidas de ritmo e, se houver, o áudio.
Explique POR QUE a edição prende e transforme isso em lições práticas para uma editora copiar em outros vídeos.
Responda SOMENTE este JSON:
{"resumo":"o que é o vídeo, em uma frase",
 "gancho":{"texto":"texto na tela no começo, se houver","segundos":n,"tipo":"pergunta|promessa|resultado|curiosidade|outro"},
 "legendas":{"palavras":n,"posicao":"topo|meio|base","estilo":"cor, peso, contorno, caixa, destaque"},
 "ritmo":"como os cortes, zooms e sons marcam o ritmo",
 "licoes":["de 3 a 6 lições curtas e práticas de EDIÇÃO (corte, ritmo, gancho, legenda, zoom, som, final), no imperativo, que valem para qualquer vídeo. Não descreva este vídeo, não fale do assunto dele e ignore vinheta ou marca colocada pelo aplicativo no fim."]}
Só afirme o que dá para ver nos quadros ou ouvir. Português do Brasil.`;

function lerManual() { try { return JSON.parse(fs.readFileSync(MANUAL, 'utf8')); } catch { return { versao: 1, regras: {}, licoes: [], referencias: [] }; } }
const chave = t => String(t).toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3).slice(0, 6).join(' ');

async function estudarUm(arq, n) {
  const { infoVideo, ff, log, cfg } = n, { prepararMidia, escalonada, filaDeModelos } = require('./diretor');
  const info = await infoVideo(arq); if (!info.duracao) throw new Error('não consegui ler ' + path.basename(arq));
  const pasta = path.join(DIR, 'trabalho', 'neo-' + Date.now()); fs.mkdirSync(pasta, { recursive: true });
  try {
    const midia = await prepararMidia({ arq, info, pasta, ff, cadaSeg: 0.8, maxQuadros: 36 });
    const cortes = midia.cenas.length, medidas = { duracao: +info.duracao.toFixed(1), cortes, cortesPorMinuto: +(cortes / info.duracao * 60).toFixed(1), mediaPlano: +(info.duracao / (cortes + 1)).toFixed(2), formato: `${info.w}x${info.h}` };
    const texto = `VÍDEO DE REFERÊNCIA: ${path.basename(arq)}\nMEDIDAS: ${JSON.stringify(medidas)}\nMUDANÇAS DE CENA (s): ${midia.cenas.slice(0, 80).join(', ') || 'nenhuma'}\nSeguem ${midia.quadros.length} quadros em ordem.`;
    const r = await escalonada(filaDeModelos({ cfg, sistema: SISTEMA, texto, midia, log, quem: 'Neo', valido: j => Array.isArray(j.licoes) }), 10000);
    if (!r || !Array.isArray(r.j.licoes)) throw new Error('o modelo não devolveu a análise de ' + path.basename(arq));
    return { arquivo: path.basename(arq), data: new Date().toISOString().slice(0, 10), resumo: String(r.j.resumo || ''), medidas, gancho: r.j.gancho || null, legendas: r.j.legendas || null, ritmo: String(r.j.ritmo || ''), licoes: r.j.licoes.map(String).slice(0, 6) };
  } finally { try { fs.rmSync(pasta, { recursive: true, force: true }); } catch {} }
}

// Estuda um arquivo ou tudo o que ainda não foi estudado na pasta referencias, e atualiza o manual
async function estudar(arq) {
  const n = require('./niobe.js'), { log } = n, manual = lerManual();
  manual.referencias = manual.referencias || []; manual.licoes = manual.licoes || []; manual.regras = manual.regras || {};
  fs.mkdirSync(REF, { recursive: true });
  const feitos = new Set(manual.referencias.map(r => r.arquivo));
  const lista = arq ? [arq] : fs.readdirSync(REF).filter(f => VIDEO.test(f) && !feitos.has(f)).map(f => path.join(REF, f));
  if (!lista.length) { log('[Neo] nenhuma referência nova na pasta referencias'); return { estudados: 0, manual }; }
  const novas = [];
  for (const f of lista.slice(0, 6)) { try { log(`[Neo] estudando ${path.basename(f)}...`); novas.push(await estudarUm(f, n)); } catch (e) { log('[Neo] (aviso) ' + e.message); } }
  for (const a of novas) {
    manual.referencias = manual.referencias.filter(r => r.arquivo !== a.arquivo).concat([{ arquivo: a.arquivo, data: a.data, resumo: a.resumo, medidas: a.medidas, gancho: a.gancho, legendas: a.legendas, ritmo: a.ritmo }]);
    const tenho = new Set(manual.licoes.map(chave));
    for (const l of a.licoes) if (!tenho.has(chave(l))) { manual.licoes.unshift(l); tenho.add(chave(l)); }
    // Números: só entram medidas de vídeo realmente cortado (4 cortes ou mais, plano médio de 0,6 a 3,5 s)
    const m = a.medidas, r = manual.regras;
    if (m.cortes >= 4 && m.mediaPlano >= 0.6 && m.mediaPlano <= 3.5) {
      r.corteMin = +(((r.corteMin || 1.2) + Math.max(0.7, m.mediaPlano * 0.6)) / 2).toFixed(1);
      r.corteMax = +(((r.corteMax || 2.8) + Math.min(4, m.mediaPlano * 1.5)) / 2).toFixed(1);
    }
    const p = +(a.legendas || {}).palavras; if (p >= 1 && p <= 6) r.palavrasLegenda = Math.round(((r.palavrasLegenda || 3) + p) / 2);
    log(`[Neo] ${a.arquivo}: ${m.cortes} cortes em ${m.duracao}s (plano médio ${m.mediaPlano}s). ${a.licoes.length} lições para a Niobe.`);
  }
  manual.licoes = manual.licoes.slice(0, 14);
  if (novas.length) fs.writeFileSync(MANUAL, JSON.stringify(manual, null, 2));
  return { estudados: novas.length, manual };
}
module.exports = { estudar };
if (require.main === module) estudar(process.argv[2]).then(r => { console.log(`Neo: ${r.estudados} referência(s) estudada(s). Manual com ${r.manual.licoes.length} lições.`); process.exit(0); }, e => { console.error(e.message); process.exit(1); });
