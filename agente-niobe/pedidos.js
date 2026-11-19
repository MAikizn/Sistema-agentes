// CAIXA DE PEDIDOS DA NIOBE — o Claude (diretor) deixa um .json em agente-niobe\pedidos; a Central roda este
// arquivo no PC e o resultado sai em pedidos\resultados\<nome>.json. É a ponte entre o Claude e o FilmCraft.
// Tipos: "analisar" (folhas de quadros + cortes + silêncios + transcrição), "editar" (monta um roteiro pronto),
//        "filmcraft" (comandos do FilmCraft), "niobe" (edição automática normal).
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const DIR = __dirname, RES = path.join(DIR, 'pedidos', 'resultados');
const fca = require('./filmcraft-ao-vivo');
const espera = ms => new Promise(r => setTimeout(r, ms));
const comLimite = (p, ms, nome) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(nome + ': passou de ' + ms / 1000 + ' s')), ms))]);

function abrirAoVivo() { if (process.platform !== 'win32') return; try { spawn('cmd', ['/c', 'start', '"Niobe ao vivo"', 'cmd', '/c', path.join(DIR, 'NIOBE-AO-VIVO.bat')], { cwd: DIR, detached: true, windowsHide: true }).unref(); } catch {} }
async function garantirPonte(sempreAbrir) { if (sempreAbrir || !(await fca.ponteAberta())) abrirAoVivo(); if (!(await fca.esperarPonte(45000))) throw new Error('FilmCraft não abriu no modo Niobe (porta 9876)'); }
function andar(o, fn) { if (o && typeof o === 'object') { fn(o); for (const v of Object.values(o)) andar(v, fn); } }
async function itemDoVideo(arq) {
  const achar = async () => { const p = await fca.fc(['inspect', 'project']); let id = null; andar(p, o => { if (o.name === path.basename(arq) && o.type !== 'Sequence' && o.item != null) id = o.item; }); return id; };
  let id = await achar(); if (id == null) { const r = await fca.exec('file.import', { paths: [arq] }); id = (r.items || [])[0] ?? await achar(); }
  return id;
}

async function jobFilmcraft(p, id) {
  await garantirPonte(false); const saida = [];
  for (let i = 0; i < (p.passos || []).length; i++) {
    const s = p.passos[i];
    try { const r = await comLimite(fca.fc(s.args, s.opcoes || []), s.limiteMs || 180000, 'passo ' + i); const txt = typeof r === 'string' ? r : JSON.stringify(r);
      fs.writeFileSync(path.join(RES, `${id}-passo${i}.json`), txt); saida.push({ ok: true, tamanho: txt.length, inicio: txt.slice(0, 600) }); }
    catch (e) { saida.push({ ok: false, erro: String(e.message).slice(0, 600) }); if (p.pararNoErro) break; }
    if (s.esperaMs) await espera(s.esperaMs);
  }
  return saida;
}

async function jobAnalisar(p, id) {
  const n = require('./niobe.js'), arq = p.video; if (!fs.existsSync(arq)) throw new Error('vídeo não encontrado: ' + arq);
  const info = await n.infoVideo(arq), dir = path.join(DIR, 'trabalho', 'analise', id); fs.mkdirSync(dir, { recursive: true });
  const passo = p.intervalo || (info.duracao <= 240 ? 1 : info.duracao <= 600 ? 2 : +(info.duracao / 300).toFixed(2));
  const r = { video: arq, info, dir, intervalo: passo, porFolha: 30, colunas: 6 };
  // 1) Folhas de quadros (6 x 5), cortes de cena e silêncios: é o que o diretor "assiste"
  const tarefas = [
    n.ff(['-i', arq, '-vf', `fps=1/${passo},scale=200:-2,tile=6x5`, '-q:v', '4', path.join(dir, 'folha_%02d.jpg')]),
    n.ff(['-i', arq, '-vf', "scale=160:-2,select='gt(scene,0.28)',showinfo", '-an', '-f', 'null', '-']).then(e => { r.cenas = [...String(e).matchAll(/pts_time:([\d.]+)/g)].map(m => +(+m[1]).toFixed(2)); }),
  ];
  if (info.audio) tarefas.push(
    n.ff(['-i', arq, '-vn', '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-']).then(e => { const s = []; let a = null; for (const l of String(e).split('\n')) { const x = l.match(/silence_start: ([\d.]+)/), y = l.match(/silence_end: ([\d.]+)/); if (x) a = +x[1]; if (y && a != null) { s.push([+a.toFixed(2), +(+y[1]).toFixed(2)]); a = null; } } r.silencios = s; }),
    n.ff(['-i', arq, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', path.join(dir, 'audio.mp3')]).catch(() => null));
  await Promise.all(tarefas);
  r.folhas = fs.readdirSync(dir).filter(f => /^folha_\d+\.jpg$/.test(f)).sort();
  // 2) Transcrição com o Whisper do FilmCraft (local, grátis). Tudo o que ele devolver fica gravado em bruto.
  if (info.audio && p.transcrever !== false) {
    const t = r.transcricao = { passos: [] }, nota = (k, v) => { const txt = typeof v === 'string' ? v : JSON.stringify(v); t.passos.push({ k, tamanho: txt.length, inicio: txt.slice(0, 300) }); return txt; };
    try {
      await garantirPonte(false);
      const item = await itemDoVideo(arq); t.item = item;
      try { nota('modelos', await fca.exec('transcript.models', {})); } catch (e) { nota('modelos-erro', e.message); }
      const gerar = () => comLimite(fca.exec('transcript.generate', { items: [item], language: p.idioma || 'auto', ...(p.modelo ? { model: p.modelo } : {}) }), 420000, 'transcrição');
      try { nota('gerar', await gerar()); }
      catch (e) { nota('gerar-erro', e.message); nota('baixar', await comLimite(fca.exec('transcript.downloadModel', p.modelo ? { model: p.modelo } : {}), 600000, 'baixar modelo').catch(x => x.message)); nota('gerar2', await gerar().catch(x => x.message)); }
      let ultimo = '', iguais = 0;
      for (let k = 0; k < 60 && iguais < 2; k++) { // espera a transcrição estabilizar
        const txt = await fca.exec('transcript.inspect', {}).then(x => JSON.stringify(x), e => 'ERRO ' + e.message);
        if (txt === ultimo && txt.length > 300) iguais++; else iguais = 0; ultimo = txt; if (iguais < 2) await espera(3000);
        if (k === 4 && txt.length < 300) break;
      }
      fs.writeFileSync(path.join(dir, 'transcricao-bruta.json'), ultimo); t.arquivo = 'transcricao-bruta.json'; t.tamanho = ultimo.length;
    } catch (e) { r.transcricao.erro = String(e.message).slice(0, 400); }
  }
  fs.writeFileSync(path.join(dir, 'analise.json'), JSON.stringify(r, null, 1));
  return r;
}

async function jobEditar(p) {
  const n = require('./niobe.js'), d = require('./diretor'), arq = p.video; if (!fs.existsSync(arq)) throw new Error('vídeo não encontrado: ' + arq);
  const info = await n.infoVideo(arq), manual = d.lerManual();
  const plano = d.normalizar(p.plano, info, p.pedido || 'profissional', manual); if (!plano) throw new Error('roteiro sem cortes válidos');
  if (p.plano.corteMaxLivre) for (const c of plano.clipes) c.momentos.forEach((m, i) => { const o = (p.plano.clipes[plano.clipes.indexOf(c)].momentos || [])[i]; if (o && +o.fim > +o.inicio) m.fim = Math.min(info.duracao, +o.fim); });
  await garantirPonte(true); await espera(2500);
  const saida = path.resolve(DIR, n.cfg.pastaSaida || 'saida'), t0 = Date.now();
  n.log(`  [Niobe] roteiro dirigido pelo Claude: ${plano.clipes.length} reel(s), ${plano.clipes.reduce((s, c) => s + c.momentos.length, 0)} cortes`);
  const saidas = await fca.editarNoFilmCraft({ arq, info, plano, saida, aoVivo: n.aoVivo || (() => {}), log: n.log, escala: p.escala ?? (n.cfg.exportacao || {}).escala ?? 'auto' });
  n.log(`  [Niobe] entrega em ${((Date.now() - t0) / 1000).toFixed(0)}s: ${saidas.map(s => path.basename(s)).join(', ')}`);
  return { saidas, segundos: +((Date.now() - t0) / 1000).toFixed(1) };
}

async function main(arqPedido) {
  fs.mkdirSync(RES, { recursive: true });
  const id = path.parse(arqPedido).name, gravar = o => fs.writeFileSync(path.join(RES, id + '.json'), JSON.stringify({ id, ...o }, null, 1));
  let p; try { p = JSON.parse(fs.readFileSync(arqPedido, 'utf8').replace(/^﻿/, '')); } catch (e) { gravar({ estado: 'erro', erro: 'pedido ilegível: ' + e.message }); return 1; }
  gravar({ estado: 'rodando', tipo: p.tipo, inicio: new Date().toISOString() });
  try {
    const r = p.tipo === 'filmcraft' ? await jobFilmcraft(p, id) : p.tipo === 'analisar' ? await jobAnalisar(p, id) : p.tipo === 'editar' ? await jobEditar(p)
      : p.tipo === 'niobe' ? await require('./niobe.js').editar(p.video, p.pedido || '') : (() => { throw new Error('tipo de pedido desconhecido: ' + p.tipo); })();
    gravar({ estado: 'pronto', tipo: p.tipo, fim: new Date().toISOString(), resultado: r }); return 0;
  } catch (e) { gravar({ estado: 'erro', tipo: p.tipo, fim: new Date().toISOString(), erro: String(e && e.stack || e).slice(0, 1500) }); return 1; }
}
if (require.main === module) main(process.argv[2]).then(c => process.exit(c), () => process.exit(1));
