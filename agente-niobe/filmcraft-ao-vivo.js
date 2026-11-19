// NIOBE AO VIVO NO FILMCRAFT — monta a edição na timeline do FilmCraft aberto (modo ponte), em lotes rápidos:
// cortes -> enquadramento e zoom -> legendas com palavra em destaque -> efeitos sonoros -> exportação. Sem Claude.
const fs = require('fs'), path = require('path'), net = require('net');
const { spawn } = require('child_process');
const DIR = __dirname, T = 254016000000, FPS = 30;
const LOG_CMD = path.join(DIR, 'ao-vivo', 'filmcraft-comandos.log');
const AMARELO = '#ffd21f';

function cliPath() {
  return [process.env.ProgramFiles + '\\ArtCraft\\FilmCraft\\filmcraft-cli.exe', (process.env.LOCALAPPDATA || '') + '\\Programs\\ArtCraft\\FilmCraft\\filmcraft-cli.exe'].find(p => p && fs.existsSync(p));
}
function token() { try { return fs.readFileSync(path.join(DIR, 'projetos', '.token'), 'utf8').trim(); } catch { return process.env.FILMCRAFT_CONTROL_TOKEN || ''; } }
function ponteAberta() {
  return new Promise(r => { const c = net.connect(9876, '127.0.0.1'); c.on('connect', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); setTimeout(() => { c.destroy(); r(false); }, 1500); });
}
function fc(args, opcoes = []) {
  return new Promise((res, rej) => {
    const p = spawn(cliPath(), ['--bridge', '127.0.0.1:9876', '--compact', ...opcoes, ...args], { windowsHide: true, env: { ...process.env, FILMCRAFT_CONTROL_TOKEN: token() } });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', rej);
    p.on('close', c => {
      try { fs.appendFileSync(LOG_CMD, `${new Date().toISOString()} ${args.join(' ').slice(0, 260)}\n  -> ${c} ${(err + ' ' + out).slice(0, 500).replace(/\s+/g, ' ')}\n`); } catch {}
      if (c !== 0) { const e = new Error(`FilmCraft (${args[1] || args[0]}): ${(err || out).slice(0, 300)}`); e.code = c; e.out = out; return rej(e); }
      try { res(JSON.parse(out)); } catch { res(out.trim()); }
    });
  });
}
const exec = (id, params = {}) => fc(['exec', id, JSON.stringify(params)]);
const espera = ms => new Promise(r => setTimeout(r, ms));
let nLote = 0;
// Vários comandos de uma vez (um processo só): é o que deixa a montagem rápida
async function lote(passos, log) {
  if (!passos.length) return;
  const arq = path.join(DIR, 'ao-vivo', `lote-${(nLote++) % 6}.jsonl`);
  fs.writeFileSync(arq, passos.map(p => JSON.stringify(p)).join('\n') + '\n');
  try { await fc(['run', arq], ['--keep-going']); }
  catch (e) {
    if (e.code === 1) { log('  (aviso) um comando do lote falhou: ' + e.message.slice(0, 160)); return; }
    for (const p of passos) { try { await exec(p.id, p.params); } catch (e2) { log('  (aviso) ' + p.id + ': ' + e2.message.slice(0, 120)); } }
  }
}

function andar(o, fn) { if (o && typeof o === 'object') { fn(o); for (const v of Object.values(o)) andar(v, fn); } }
async function acharItem(nome) {
  const p = await fc(['inspect', 'project']); let achou = null;
  andar(p, o => { if (o.name === nome && o.type !== 'Sequence' && o.type !== 'Bin' && o.item != null) achou = o.item; });
  return achou;
}
async function itemOuImporta(arq) {
  let item = await acharItem(path.basename(arq));
  if (item == null && fs.existsSync(arq)) { const r = await exec('file.import', { paths: [arq] }); item = (r.items || [])[0] ?? await acharItem(path.basename(arq)); }
  return item;
}
const trilha = (seq, tipo, i) => (((seq[tipo] || [])[i] || {}).items || []).slice().sort((a, b) => a.start - b.start);

// Momentos de um clipe sem roteiro dirigido: pedaços de até 2,5 s dos trechos de fala
function momentosDeTrechos(trechos) {
  const ms = []; for (const [a, b] of trechos) for (let t = a; t < b - 0.6; t += 2.5) ms.push({ inicio: t, fim: Math.min(b, t + 2.5), legenda: '', destaque: '', zoom: false });
  return ms.slice(0, 18);
}
async function esperarPonte(ms = 25000) { const fim = Date.now() + ms; while (Date.now() < fim) { if (await ponteAberta()) return true; await espera(700); } return false; }
// Enquanto o FilmCraft renderiza ou o modelo responde, a equipe mostra em que pé está o trabalho
function agitar(aoVivo, ids, msg) { let k = 0; const t0 = Date.now(); const t = setInterval(() => aoVivo(ids[k++ % ids.length], msg(((Date.now() - t0) / 1000).toFixed(0))), 450); return () => clearInterval(t); }

async function montarClipe({ arq, item, sfx, info, plano, clipe, idx, trechos, aoVivo, log }) {
  const [W, H] = plano.formato === '16:9' ? [1920, 1080] : plano.formato === '1:1' ? [1080, 1080] : [1080, 1920];
  const momentos = (clipe.momentos && clipe.momentos.length ? clipe.momentos : momentosDeTrechos(trechos || [[clipe.inicio, clipe.fim]]));
  const pro = plano.nivel === 'profissional', corteMax = plano.corteMax || 2.8;
  const nome = `${path.parse(arq).name}_reel${idx + 1}_${clipe.titulo || 'niobe'}`.replace(/[<>:"/\\|?*]/g, '').slice(0, 80);
  aoVivo('montador', `nova sequência ${W}x${H}: ${clipe.titulo || nome}`);
  const seq = (await exec('file.newSequence', { name: nome, width: W, height: H, fps: FPS, video: 3, audio: 3 })).sequence;

  // 1) CORTES — momento longo vira dois cortes (jump cut com zoom), para o ritmo não cair
  let f = 0; const faixa = [], cortes = [], zoomDe = [];
  momentos.forEach((m, i) => {
    const dur = m.fim - m.inicio, partes = dur > corteMax * 1.25 ? 2 : 1, f0 = f;
    for (let k = 0; k < partes; k++) {
      const a = m.inicio + dur * k / partes, n = Math.max(12, Math.round(dur / partes * FPS));
      cortes.push({ id: 'timeline.place', params: { item, track: 'V1', audioTrack: 'A1', frame: f, sourceIn: { seconds: +a.toFixed(3) }, duration: { frame: n }, insert: false } });
      zoomDe.push(m.zoom && k === 0); f += n;
    }
    faixa.push([f0, f - f0]);
    aoVivo(['montador', 'silencio', 'ritmista', 'erros', 'velocidade'][i % 5], `corte ${i + 1}/${momentos.length}: ${m.inicio.toFixed(1)}s a ${m.fim.toFixed(1)}s`);
  });
  await lote(cortes, log);
  const total = f / FPS;
  let s = await fc(['inspect', 'sequence']);
  const v1 = trilha(s, 'video', 0);

  // 2) ENQUADRAMENTO E ZOOM
  const k = plano.marcaNoCanto ? 1.10 : 1.0, base = Math.max(W / info.w, H / info.h) * 100, quadro = [];
  v1.forEach((c, i) => {
    const z = i % 2 === 1 ? 1.09 : 1.0, esc = +(base * k * z).toFixed(2), sobra = (info.h * esc / 100 - H) / 2;
    const y = plano.marcaNoCanto === 'inferior' ? H / 2 + sobra : plano.marcaNoCanto === 'superior' ? H / 2 - sobra : H / 2;
    quadro.push({ id: 'effects.setParam', params: { clip: c.clip, effect: 'motion', param: 'position', value: [W / 2, Math.round(y)] } });
    if (zoomDe[i]) {
      quadro.push({ id: 'effects.setParam', params: { clip: c.clip, effect: 'motion', param: 'scale', value: esc, time: c.start, keyframe: true } });
      quadro.push({ id: 'effects.setParam', params: { clip: c.clip, effect: 'motion', param: 'scale', value: +(esc * 1.1).toFixed(2), time: c.start + Math.round(0.3 * T), keyframe: true } });
      aoVivo(i % 2 ? 'zoom' : 'motion', `punch-in no corte ${i + 1}`);
    } else { quadro.push({ id: 'effects.setParam', params: { clip: c.clip, effect: 'motion', param: 'scale', value: esc } }); aoVivo(['reenquadrador', 'colorTec', 'consistencia', 'colorCri'][i % 4], `enquadrando corte ${i + 1}`); }
  });
  if (plano.marcaNoCanto) aoVivo('efeitos', `tirando a marca do canto ${plano.marcaNoCanto}`);
  await lote(quadro, log);

  // 3) TEXTOS — gancho no primeiro corte (sem legenda junto), uma legenda por momento, CTA no fim
  const gancho = (clipe.gancho || (plano.ganchos || [])[idx] || '').toUpperCase(), cta = (clipe.cta || plano.cta || '').toUpperCase();
  const tam = t => Math.round(W * (t.length <= 14 ? 0.095 : t.length <= 22 ? 0.082 : 0.068));
  const textos = [], legendas = [];
  momentos.forEach((m, i) => {
    if (!m.legenda || !faixa[i] || (i === 0 && gancho) || m.legenda === gancho) return;
    legendas.push(m);
    textos.push({ id: 'graphics.newText', params: { text: m.legenda, box: [W - 140, 440], position: [70, Math.round(H * 0.665)], size: tam(m.legenda), font: 'Inter', fontStyle: 'Black', seconds: +(faixa[i][1] / FPS - 0.04).toFixed(3), time: Math.round(faixa[i][0] / FPS * T), track: 1 } });
    aoVivo(['legendista', 'tipografo', 'copy'][i % 3], `legenda: ${m.legenda}`);
  });
  const durGancho = Math.max(1.6, Math.min(3, (faixa[0] || [0, 60])[1] / FPS));
  if (gancho) { textos.push({ id: 'graphics.newText', params: { text: gancho, box: [W - 140, 440], position: [70, Math.round(H * 0.16)], size: tam(gancho), font: 'Inter', fontStyle: 'Black', seconds: +durGancho.toFixed(2), time: 0, track: 2 } }); aoVivo('ganchos', `gancho: ${gancho}`); }
  const temCta = cta && total > 6;
  if (temCta) { textos.push({ id: 'graphics.newText', params: { text: cta, box: [W - 140, 440], position: [70, Math.round(H * 0.16)], size: tam(cta), font: 'Inter', fontStyle: 'Black', seconds: 2.2, time: Math.round((total - 2.2) * T), track: 2 } }); aoVivo('copy', `CTA: ${cta}`); }
  await lote(textos, log);
  s = await fc(['inspect', 'sequence']);
  const estilo = [], padrao = { align: 'center', stroke: true, stroke_width: 10, shadow: true };
  trilha(s, 'video', 1).forEach((c, i) => {
    const m = legendas[i]; estilo.push({ id: 'graphics.set', params: { clip: c.clip, props: padrao } });
    if (m && m.destaque) { const a = m.legenda.indexOf(m.destaque); if (a >= 0) estilo.push({ id: 'graphics.setCharStyle', params: { clip: c.clip, start: a, end: a + m.destaque.length, style: { color: AMARELO } } }); }
  });
  trilha(s, 'video', 2).forEach((c, i) => {
    const eGancho = i === 0 && gancho;
    estilo.push({ id: 'graphics.set', params: { clip: c.clip, props: eGancho ? padrao : { ...padrao, fill_color: AMARELO, background: true } } });
    if (eGancho) { const ult = gancho.replace(/[?!.]+$/, '').split(/\s+/).pop(), a = gancho.lastIndexOf(ult); if (a > 0) estilo.push({ id: 'graphics.setCharStyle', params: { clip: c.clip, start: a, end: a + ult.length, style: { color: AMARELO } } }); }
  });
  aoVivo('marca', 'estilo: Inter Black, contorno, destaque amarelo');
  await lote(estilo, log);

  // 4) SOM — whoosh nos cortes, pop no gancho, ding no CTA
  if (sfx.whoosh != null) {
    const sons = [], inicios = cortes.map(c => c.params.frame).slice(1, 15);
    inicios.forEach((q, i) => { if (pro || i % 2 === 0) sons.push({ id: 'timeline.place', params: { item: sfx.whoosh, track: 'A2', frame: Math.max(0, q - 3), video: false, insert: false } }); });
    if (sfx.pop != null && gancho) sons.push({ id: 'timeline.place', params: { item: sfx.pop, track: 'A3', frame: 0, video: false, insert: false } });
    if (sfx.ding != null && temCta) sons.push({ id: 'timeline.place', params: { item: sfx.ding, track: 'A3', frame: Math.round((total - 2.2) * FPS), video: false, insert: false } });
    aoVivo('sfx', `${sons.length} efeitos sonoros nos cortes`); aoVivo('trilha', 'som marcando o ritmo dos cortes');
    await lote(sons, log);
    s = await fc(['inspect', 'sequence']);
    const ids = [...trilha(s, 'audio', 1), ...trilha(s, 'audio', 2)].map(c => c.clip);
    if (ids.length) { aoVivo('mix', 'efeitos em -10 dB sob a voz'); aoVivo('voz', 'voz na frente da mixagem'); await lote([{ id: 'clip.audioGain', params: { clips: ids, mode: 'set', db: -10 } }], log); }
  }
  aoVivo('revisor', `${clipe.titulo || nome}: ${cortes.length} cortes em ${total.toFixed(0)} s`);
  return { seq, nome, W, H, total, cortes: cortes.length };
}

async function exportar(r, saida, log) {
  const out = path.join(saida, r.nome + '.mp4');
  // Fonte pequena (até 1300 px no lado maior): exporta em 720x1280, que rende em metade do tempo sem perder imagem
  const base = { path: out, sequence: r.seq, format: 'h264', fps: FPS, crf: 20, loudnessLufs: -14, wait: true, ...(r.escala < 1 ? { scale: r.escala } : { width: r.W, height: r.H }) };
  try { await exec('file.exportMedia', { ...base, hardwareEncoding: 'auto' }); }
  catch (e) { log('  (aviso) exportação repetida sem placa de vídeo: ' + e.message.slice(0, 120)); await exec('file.exportMedia', base); }
  return out;
}

// Enquanto o FilmCraft renderiza, o Revisor percorre os cortes de cada reel no monitor (dá para ver o resultado)
async function revisarAoVivo(prontos, aoVivo, exportando) {
  try {
    while (exportando()) for (const r of prontos) {
      if (!exportando()) return;
      await exec('sequence.open', { item: r.seq }); await exec('playhead.start', {});
      for (let i = 0; i < r.cortes && exportando(); i++) { aoVivo(['revisor', 'consistencia', 'colorTec', 'mix', 'voz'][i % 5], `conferindo corte ${i + 1}/${r.cortes}`); await espera(500); await exec('playhead.nextEdit', {}); }
    }
  } catch {}
}

async function editarNoFilmCraft({ arq, info, plano, trechosPorClipe = [], saida, aoVivo, log, escala = 'auto' }) {
  if (!cliPath()) throw new Error('filmcraft-cli não encontrado');
  if (!(await esperarPonte())) throw new Error('FilmCraft sem modo Niobe (porta 9876 fechada)');
  const t0 = Date.now();
  aoVivo('triador', `importando ${path.basename(arq)} no FilmCraft`);
  const item = await itemOuImporta(arq);
  if (item == null) throw new Error('não achei o vídeo importado no projeto');
  const sfx = {};
  await Promise.all(['whoosh', 'pop', 'ding'].map(async n => { try { sfx[n] = await itemOuImporta(path.join(DIR, 'trabalho', 'sfx', `sfx_${n}.wav`)); } catch { sfx[n] = null; } }));
  const prontos = [];
  for (let i = 0; i < plano.clipes.length; i++) prontos.push(await montarClipe({ arq, item, sfx, info, plano, clipe: plano.clipes[i], idx: i, trechos: trechosPorClipe[i], aoVivo, log }));
  const t1 = Date.now();
  log(`  [Niobe] ${prontos.length} reel(s) montado(s) no FilmCraft em ${((t1 - t0) / 1000).toFixed(1)}s (${prontos.map(p => p.cortes + ' cortes').join(', ')}); exportando todos juntos`);
  // Exporta todos ao mesmo tempo
  const esc = escala === 'auto' ? (Math.max(info.w, info.h) <= 1300 ? 2 / 3 : 1) : (+escala > 0 && +escala <= 1 ? +escala : 1);
  for (const r of prontos) r.escala = esc;
  const parar = agitar(aoVivo, ['exportador', 'versionador'], s => `renderizando ${prontos.length} reel(s): ${s}s`);
  let exportando = true; const revisao = revisarAoVivo(prontos, aoVivo, () => exportando);
  let saidas;
  try {
    const res = await Promise.allSettled(prontos.map(r => exportar(r, saida, log)));
    saidas = [];
    for (let i = 0; i < res.length; i++) saidas.push(res[i].status === 'fulfilled' ? res[i].value : await exportar(prontos[i], saida, log));
  } finally { parar(); exportando = false; await revisao; }
  log(`  [Niobe] exportação em ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  try { await exec('sequence.open', { item: prontos[0].seq }); await exec('file.save', {}); } catch {}
  return saidas;
}

module.exports = { editarNoFilmCraft, ponteAberta, esperarPonte, agitar, exec, fc };
