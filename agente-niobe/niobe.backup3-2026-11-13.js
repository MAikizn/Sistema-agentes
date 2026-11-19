// NIOBE — agente de edição de vídeo do Maike. Roda no PC (como o Morfeus), usa o FreeLLMAPI para pensar,
// o Gemini para transcrever, o FFmpeg para editar e o FilmCraft (opcional) para salvar o projeto.
const fs = require('fs'), path = require('path'), os = require('os'), readline = require('readline');
const { spawn } = require('child_process');
const { ESPECIALISTAS, FLUXOS, porId } = require('./especialistas');

const DIR = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const SAIDA = path.resolve(DIR, cfg.pastaSaida || 'saida');
const TRAB = path.join(DIR, 'trabalho');
const LOG = path.join(DIR, 'niobe.log');
fs.mkdirSync(SAIDA, { recursive: true }); fs.mkdirSync(TRAB, { recursive: true });

const log = (...a) => { const t = a.join(' '); console.log(t); fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${t}\n`); };
// Camada ao vivo: cada especialista manda a seta dele até a área do FilmCraft onde trabalha (ao-vivo/eventos.jsonl)
const AO_VIVO = path.join(DIR, 'ao-vivo', 'eventos.jsonl');
const NOMES_AO_VIVO = ['Triador','Transcritor','Analista','Roteirista','Ganchos','Copywriter','Montador','Cortador de silencio','Removedor de erros','Ritmista','B-roll','Reenquadrador','Velocidade','Motion designer','Zoom dinamico','Tipografo','Legendista','Transicoes','Efeitos','Marca','Colorista tecnico','Colorista criativo','Consistencia de cor','Engenheiro de voz','Trilha','Sound designer','Mixador','Revisor','Exportador','Versionador'];
const CASA = { 'Pré-produção': [0.13, 0.74], 'Montagem': [0.62, 0.79], 'Motion': [0.54, 0.30], 'Cor': [0.86, 0.30], 'Áudio': [0.62, 0.88], 'Entrega': [0.18, 0.06] };
function aoVivo(id, acao) {
  const i = ESPECIALISTAS.findIndex(e => e.id === id); if (i < 0) return;
  const [x, y] = CASA[ESPECIALISTAS[i].area] || [0.5, 0.5], j = () => (Math.random() - 0.5) * 0.08;
  try { fs.appendFileSync(AO_VIVO, JSON.stringify({ agente: NOMES_AO_VIVO[i], x: +(x + j()).toFixed(3), y: +(y + j() / 2).toFixed(3), acao: String(acao).slice(0, 80) }) + '\n'); } catch {}
}
const esp = (id, msg) => { log(`  [${porId[id].nome}] ${msg}`); aoVivo(id, msg); };
// Enquanto o FFmpeg renderiza, os especialistas escalados se revezam na camada
function revezar(ids, acao) { let k = 0; const t = setInterval(() => { const id = ids[k++ % ids.length]; aoVivo(id, `${porId[id].nome}: ${acao}`); }, 1600); return () => clearInterval(t); }

// ---------- FFmpeg ----------
function acharFfmpeg() {
  const tentativas = [
    () => require('ffmpeg-static'),
    () => require(path.join(DIR, '..', 'agente-whatsapp', 'node_modules', 'ffmpeg-static')),
    () => require(path.join(DIR, '..', 'morfeus', 'node_modules', 'ffmpeg-static')),
    () => 'ffmpeg',
  ];
  for (const t of tentativas) { try { const p = t(); if (p && (p === 'ffmpeg' || fs.existsSync(p))) return p; } catch {} }
  return 'ffmpeg';
}
const FFMPEG = cfg.ffmpeg || acharFfmpeg();

function ff(args, cwd = DIR) {
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-y', ...args], { cwd, windowsHide: true });
    let err = ''; p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('error', rej);
    p.on('close', c => c === 0 ? res(err) : rej(new Error('FFmpeg falhou: ' + err.slice(-600))));
  });
}
async function infoVideo(arq) {
  const err = await ff(['-i', arq, '-f', 'null', '-t', '0.01', '-']).catch(e => e.message);
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = err.match(/Video:.*?, (\d{2,5})x(\d{2,5})/);
  const rot = /rotate\s*:\s*(90|270|-90)/.test(err) || /rotation of -?90/.test(err);
  let [w, h] = v ? [+v[1], +v[2]] : [1920, 1080]; if (rot) [w, h] = [h, w];
  return { duracao: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0, w, h, audio: /Audio:/.test(err) };
}
async function trechosDeFala(arq, ini, fim) { // usa detecção de silêncio para achar onde há fala
  const err = await ff(['-ss', String(ini), '-to', String(fim), '-i', arq, '-vn', '-af', `silencedetect=noise=${cfg.ruidoSilencio || '-35dB'}:d=${cfg.silencioMinimo || 0.45}`, '-f', 'null', '-']);
  const sil = []; let s = null;
  for (const l of err.split('\n')) {
    const a = l.match(/silence_start: ([\d.]+)/), b = l.match(/silence_end: ([\d.]+)/);
    if (a) s = +a[1]; if (b && s !== null) { sil.push([s + ini, +b[1] + ini]); s = null; }
  }
  if (s !== null) sil.push([s + ini, fim]);
  const fala = []; let cur = ini;
  for (const [a, b] of sil) { if (a - cur > 0.25) fala.push([cur, a]); cur = b; }
  if (fim - cur > 0.25) fala.push([cur, fim]);
  const pad = 0.12, out = [];
  for (let [a, b] of fala) { a = Math.max(ini, a - pad); b = Math.min(fim, b + pad); if (out.length && a - out.at(-1)[1] < 0.15) out.at(-1)[1] = b; else out.push([a, b]); }
  return out.length ? out : [[ini, fim]];
}

// ---------- IA (FreeLLMAPI) ----------
async function ia(system, user, maxTokens = 1800) {
  const modelos = [].concat(cfg.llm.model || 'auto', 'auto');
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    for (const model of modelos) {
      try {
        const r = await fetch(cfg.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST', signal: AbortSignal.timeout(90000),
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.llm.apiKey },
          body: JSON.stringify({ model, temperature: 0.4, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        });
        if (!r.ok) continue;
        const j = await r.json(); const txt = (j.choices?.[0]?.message?.content || '').trim();
        const json = extrairJson(txt); if (json) return json;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 6000));
  }
  throw new Error('O FreeLLMAPI não respondeu. Confira se ele está aberto.');
}
function extrairJson(t) {
  t = t.replace(/```json|```/g, ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

// ---------- Transcrição (Gemini) ----------
async function transcrever(arq, dur, pasta) {
  if (!cfg.geminiApiKey) return [];
  const bloco = 600, segs = [];
  for (let ini = 0; ini < dur; ini += bloco) {
    const mp3 = path.join(pasta, `audio_${ini}.mp3`);
    await ff(['-ss', String(ini), '-t', String(bloco), '-i', arq, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', mp3]);
    const prompt = 'Transcreva este áudio em português, fielmente, sem comentários. Responda SOMENTE JSON: {"segmentos":[{"inicio":segundos,"fim":segundos,"texto":"..."}]} com frases curtas (no máximo 4 segundos cada) e tempos precisos contados do início deste áudio. Se não houver fala, {"segmentos":[]}.';
    let ok = false;
    for (const model of [].concat(cfg.geminiModelos || ['gemini-2.5-flash', 'gemini-2.0-flash'])) {
      try {
        const r = await fetch(`${cfg.geminiBaseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`, {
          method: 'POST', signal: AbortSignal.timeout(180000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiApiKey },
          body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'audio/mp3', data: fs.readFileSync(mp3).toString('base64') } }, { text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
        });
        if (!r.ok) continue;
        const j = extrairJson((await r.json()).candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '');
        if (!j) continue;
        for (const s of j.segmentos || []) if (s.texto && +s.fim > +s.inicio) segs.push({ inicio: +s.inicio + ini, fim: Math.min(+s.fim + ini, dur), texto: String(s.texto).trim() });
        ok = true; break;
      } catch {}
    }
    if (!ok) log('  (aviso) não consegui transcrever um trecho do áudio; sigo sem legenda nele.');
  }
  return segs;
}

// ---------- Legendas (ASS) ----------
const TAM = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const tempoAss = s => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${x}`; };
const limpaAss = t => String(t).replace(/[{}\\]/g, '').replace(/\n/g, ' ');
function montarAss(plano, W, H, mapa, transcricao, gancho, cta, durFinal) {
  const fs1 = Math.round(W * (plano.formato === '16:9' ? 0.045 : 0.085));
  const cor = cfg.corDestaque || '&H0000E5FF'; // amarelo (formato BGR do ASS)
  let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
  ass += `Style: Leg,${cfg.fonte || 'Arial Black'},${fs1},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,${Math.round(fs1 / 9)},2,2,60,60,${Math.round(H * 0.22)},1\n`;
  ass += `Style: Gancho,${cfg.fonte || 'Arial Black'},${Math.round(fs1 * 0.95)},&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0000000,1,0,0,0,100,100,0,0,3,${Math.round(fs1 / 5)},0,8,70,70,${Math.round(H * 0.12)},1\n`;
  ass += `\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const pop = '{\\fscx80\\fscy80\\t(0,90,\\fscx100\\fscy100)}';
  if (plano.legendas) {
    for (const s of transcricao) {
      for (const m of mapa) { // m = {a,b,off}: trecho original [a,b] começa em off no vídeo final
        const a = Math.max(s.inicio, m.a), b = Math.min(s.fim, m.b); if (b - a < 0.2) continue;
        const pal = limpaAss(s.texto).split(/\s+/).filter(Boolean); if (!pal.length) continue;
        const grupos = []; for (let i = 0; i < pal.length; i += 3) grupos.push(pal.slice(i, i + 3));
        const dt = (b - a) / grupos.length;
        grupos.forEach((g, i) => {
          const t0 = m.off + (a - m.a) + i * dt, t1 = t0 + dt;
          const maior = g.reduce((x, y) => (y.length > x.length ? y : x), '');
          const txt = g.map(w => (w === maior && w.length > 3 ? `{\\c${cor}}${w.toUpperCase()}{\\c&H00FFFFFF&}` : w.toUpperCase())).join(' ');
          ass += `Dialogue: 0,${tempoAss(t0)},${tempoAss(t1)},Leg,,0,0,0,,${pop}${txt}\n`;
        });
      }
    }
  }
  if (gancho) ass += `Dialogue: 1,${tempoAss(0)},${tempoAss(Math.min(3, durFinal))},Gancho,,0,0,0,,{\\fad(120,200)}${limpaAss(gancho).toUpperCase()}\n`;
  if (cta && durFinal > 6) ass += `Dialogue: 1,${tempoAss(durFinal - 3)},${tempoAss(durFinal)},Gancho,,0,0,0,,{\\fad(200,0)}${limpaAss(cta).toUpperCase()}\n`;
  return ass;
}

// ---------- Render de um clipe ----------
const CORES = {
  natural: 'eq=contrast=1.05:saturation=1.08',
  quente: 'eq=contrast=1.06:saturation=1.1,colorbalance=rs=0.05:gs=0.01:bs=-0.05',
  frio: 'eq=contrast=1.06:saturation=1.05,colorbalance=rs=-0.04:bs=0.05',
  vibrante: 'eq=contrast=1.08:saturation=1.3',
  cinema: 'eq=contrast=1.12:saturation=0.92,colorbalance=rs=0.03:bs=0.04:rh=0.03:bh=-0.03,vignette=PI/5',
};
async function renderClipe(arq, plano, clipe, idx, pasta, transcricao, info, versoes) {
  const [W, H] = TAM[plano.formato] || TAM['9:16'];
  const p = path.join(pasta, `clipe${idx}`); fs.mkdirSync(p, { recursive: true });
  const ini = Math.max(0, +clipe.inicio), fim = Math.min(info.duracao, +clipe.fim);
  const trechos = plano.removerSilencio && info.audio ? await trechosDeFala(arq, ini, fim) : [[ini, fim]];
  esp('silencio', `clipe ${idx + 1}: ${trechos.length} trecho(s) de fala mantidos`);
  const cor = CORES[plano.cor] || CORES.natural, lista = [], mapa = []; let off = 0;
  for (let i = 0; i < trechos.length; i++) {
    const [a, b] = trechos[i];
    const z = plano.zoomDinamico && i % 2 === 1 && b - a > 1.2 ? 1.12 : 1.0;
    const sw = Math.ceil(W * z / 2) * 2, sh = Math.ceil(H * z / 2) * 2;
    const vf = `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${W}:${H},${cor},fps=30,setsar=1,format=yuv420p`;
    const seg = `seg${String(i).padStart(4, '0')}.mp4`;
    const af = info.audio ? ['-af', 'highpass=f=80,afade=t=in:d=0.02,areverse,afade=t=in:d=0.03,areverse'] : [];
    await ff(['-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', arq, ...(info.audio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest']),
      '-vf', vf, ...af, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', seg], p);
    lista.push(`file '${seg}'`); mapa.push({ a, b, off }); off += b - a;
  }
  fs.writeFileSync(path.join(p, 'lista.txt'), lista.join('\n'));
  await ff(['-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', 'junto.mp4'], p);
  esp('zoom', plano.zoomDinamico ? 'zoom alternado nos cortes' : 'sem zoom');
  const saidas = [];
  const ganchos = versoes > 1 ? (plano.ganchos || []).slice(0, versoes) : [(plano.ganchos || [])[idx] || (plano.ganchos || [])[0] || ''];
  for (let v = 0; v < Math.max(1, ganchos.length); v++) {
    const ass = montarAss(plano, W, H, mapa, transcricao, plano.tipo === 'limpeza' ? '' : ganchos[v], plano.cta, off);
    fs.writeFileSync(path.join(p, `leg${v}.ass`), ass);
    const nome = `${new Date().toISOString().slice(0, 10)}_${plano.tipo}_${(clipe.titulo || 'clipe' + (idx + 1)).replace(/[^\w-]+/g, '-').slice(0, 40)}${ganchos.length > 1 ? '_v' + (v + 1) : ''}.mp4`;
    const destino = path.join(SAIDA, nome);
    await ff(['-i', 'junto.mp4', '-vf', `subtitles=leg${v}.ass`, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', destino], p);
    saidas.push(destino);
  }
  esp('exportador', `clipe ${idx + 1}: ${saidas.map(s => path.basename(s)).join(', ')} (${off.toFixed(1)}s)`);
  return saidas;
}

// ---------- FilmCraft (servidor MCP) ----------
async function filmcraft(arquivos, nomeProjeto) {
  const exe = [cfg.filmcraft?.cli || '', '%ProgramFiles%\\ArtCraft\\FilmCraft\\filmcraft-cli.exe', '%LOCALAPPDATA%\\Programs\\ArtCraft\\FilmCraft\\filmcraft-cli.exe']
    .map(c => c.replace(/%([^%]+)%/g, (_, v) => process.env[v] || '')).find(c => c && fs.existsSync(c)) || '';
  if (!cfg.filmcraft?.ativo || !exe || !fs.existsSync(exe)) return null;
  let token = process.env.FILMCRAFT_CONTROL_TOKEN || ''; try { token = fs.readFileSync(path.join(DIR, 'projetos', '.token'), 'utf8').trim() || token; } catch {}
  const ponte = await new Promise(r => { const c = require('net').connect(9876, '127.0.0.1'); c.on('connect', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); setTimeout(() => { c.destroy(); r(false); }, 1500); });
  const proc = spawn(exe, ponte ? ['mcp', '--bridge', '127.0.0.1:9876'] : ['mcp'], { windowsHide: true, env: { ...process.env, FILMCRAFT_CONTROL_TOKEN: token } }); let buf = '', id = 0; const esperando = {};
  proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); esperando[m.id]?.(m); } catch {} } });
  const rpc = (method, params) => new Promise((res, rej) => { const n = ++id; esperando[n] = res; proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); setTimeout(() => rej(new Error('FilmCraft não respondeu')), 120000); });
  const ferramenta = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.result?.content?.map(c => c.text || '').join('') || ''; if (r.error || r.result?.isError) throw new Error(t || r.error?.message); try { return JSON.parse(t); } catch { return t; } };
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'niobe', version: '1.0' } });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    aoVivo('montador', `importando ${arquivos.length} clipe(s) no FilmCraft`);
    await ferramenta('media_import', { paths: arquivos });
    if (ponte) { aoVivo('exportador', 'clipes prontos no painel Projeto do FilmCraft'); return 'importado'; } // não troca o projeto aberto
    const cmds = await ferramenta('command_list', { filter: 'save' });
    const lista = Array.isArray(cmds) ? cmds : (cmds.commands || []);
    const salvar = lista.find(c => /saveas/i.test(c.id)) || lista.find(c => /^file\.save/i.test(c.id));
    const projeto = path.join(SAIDA, nomeProjeto + '.fcproj');
    if (salvar) await ferramenta('command_run', { id: salvar.id, params: { path: projeto } });
    return salvar ? projeto : 'importado';
  } finally { proc.kill(); }
}

// ---------- Fila (até N especialistas renderizando ao mesmo tempo) ----------
async function emFila(itens, n, fn) { const res = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => { while (i < itens.length) { const k = i++; res[k] = await fn(itens[k], k); } })); return res; }

// ---------- Trabalho completo ----------
async function editar(arq, pedido) {
  const t0 = Date.now(); const pasta = path.join(TRAB, String(Date.now())); fs.mkdirSync(pasta, { recursive: true });
  const info = await infoVideo(arq);
  if (!info.duracao) throw new Error('Não consegui ler esse vídeo.');
  esp('triador', `${path.basename(arq)} — ${info.duracao.toFixed(1)}s, ${info.w}x${info.h}${info.audio ? ', com áudio' : ', sem áudio'}`);
  let transcricao = [], plano = null;
  // A Niobe assiste ao vídeo (quadros + áudio) e escreve o roteiro de edição completo
  if (cfg.direcao?.ativo !== false) {
    try {
      esp('analista', 'assistindo ao vídeo: quadros, cenas e áudio');
      const pararDir = require('./filmcraft-ao-vivo').agitar(aoVivo, ['analista', 'transcritor', 'ritmista', 'roteirista', 'ganchos', 'copy', 'triador'], s => `lendo o vídeo e escrevendo o roteiro pelo Manual do Neo: ${s}s`);
      let d; try { d = await require('./diretor').dirigir({ arq, info, pedido, pasta, cfg, ff, log }); } finally { pararDir(); }
      if (d) { plano = d.plano; log(`  [Niobe] roteiro pronto em ${d.s}s (${d.rota}): ${plano.resumo}`); esp('roteirista', `${plano.clipes.length} reel(s), ${plano.clipes.reduce((n, c) => n + c.momentos.length, 0)} cortes`); }
      else log('  (aviso) não consegui assistir ao vídeo; sigo pelo roteiro por texto');
    } catch (e) { log('  (aviso) direção: ' + e.message); }
  }
  if (!plano) {
    if (info.audio) { esp('transcritor', 'transcrevendo a fala...'); transcricao = await transcrever(arq, info.duracao, pasta); esp('transcritor', `${transcricao.length} frases`); }
    fs.writeFileSync(path.join(pasta, 'transcricao.json'), JSON.stringify(transcricao, null, 1));
    log('  [Niobe] distribuindo o trabalho para os especialistas...');
    const txt = transcricao.map(s => `[${s.inicio.toFixed(1)}-${s.fim.toFixed(1)}] ${s.texto}`).join('\n').slice(0, 60000);
    plano = await ia(fs.readFileSync(path.join(DIR, 'prompt.txt'), 'utf8'),
      `PEDIDO DO MAIKE: ${pedido || '(sem instrução: decida o melhor)'}\nVÍDEO: ${info.duracao.toFixed(1)}s, ${info.w}x${info.h} (${info.w >= info.h ? 'horizontal' : 'vertical'})\nTRANSCRIÇÃO:\n${txt || '(sem fala)'}`);
  }
  plano.tipo = FLUXOS[plano.tipo] ? plano.tipo : 'reels';
  if (!TAM[plano.formato]) plano.formato = plano.tipo === 'limpeza' ? (info.w >= info.h ? '16:9' : '9:16') : '9:16';
  plano.clipes = (plano.clipes || []).filter(c => +c.fim > +c.inicio).slice(0, cfg.maxClipes || 5);
  if (!plano.clipes.length || plano.tipo === 'limpeza') plano.clipes = plano.clipes.length && plano.tipo !== 'limpeza' ? plano.clipes : [{ inicio: 0, fim: info.duracao, titulo: path.parse(arq).name }];
  if (!transcricao.length && !plano.dirigido) plano.legendas = false;
  plano.removerSilencio = plano.dirigido ? false : plano.removerSilencio !== false;
  fs.writeFileSync(path.join(pasta, 'plano.json'), JSON.stringify(plano, null, 1));
  log(`  [Niobe] tipo: ${plano.tipo} · formato ${plano.formato} · ${plano.clipes.length} clipe(s) · cor ${plano.cor || 'natural'}`);
  log(`  [Niobe] equipe escalada: ${FLUXOS[plano.tipo].map(id => porId[id].nome).join(', ')}`);
  const versoes = plano.tipo === 'anuncio' ? Math.min(3, (plano.ganchos || []).length || 1) : 1;
  for (const id of FLUXOS[plano.tipo].filter(id => porId[id].area === 'Pré-produção')) aoVivo(id, plano.resumo || 'plano de cortes pronto');
  // 1º caminho: editar AO VIVO na timeline do FilmCraft aberto (modo ponte). 2º: FFmpeg em segundo plano.
  let saidas = null, aoVivoOk = false; const fca = require('./filmcraft-ao-vivo');
  if (cfg.filmcraftAoVivo !== false && await fca.esperarPonte(20000)) {
    try {
      log('  [Niobe] editando ao vivo no FilmCraft');
      const trechosPorClipe = [];
      for (const c of plano.clipes) { const ini = Math.max(0, +c.inicio), fim = Math.min(info.duracao, +c.fim); trechosPorClipe.push(!c.momentos && plano.removerSilencio && info.audio ? await trechosDeFala(arq, ini, fim) : [[ini, fim]]); }
      saidas = await fca.editarNoFilmCraft({ arq, info, plano, trechosPorClipe, transcricao, saida: SAIDA, aoVivo, log });
      aoVivoOk = true;
    } catch (e) { log('  (aviso) edição ao vivo parou: ' + e.message + ' — sigo pelo FFmpeg'); saidas = null; }
  }
  const pararRevezamento = aoVivoOk ? () => {} : revezar(FLUXOS[plano.tipo].filter(id => !['Pré-produção', 'Entrega'].includes(porId[id].area)), `editando ${plano.clipes.length} clipe(s)`);
  if (!saidas) saidas = (await emFila(plano.clipes, cfg.maxParalelo || 3, (c, i) => renderClipe(arq, plano, c, i, pasta, transcricao, info, versoes))).flat();
  pararRevezamento();
  // B-roll gerado pelo Higgsfield (opcional: só com chave e créditos em config.json > higgsfield)
  try { const hf = require('./higgsfield'); if (hf.config().pronto && (plano.broll || []).length) { esp('broll', `gerando ${Math.min(plano.broll.length, cfg.higgsfield?.maxPorVideo || 3)} imagem(ns) de apoio no Higgsfield`); saidas.push(...await hf.gerarBroll(plano, path.join(SAIDA, path.parse(arq).name + '_broll'), log)); } } catch (e) { log('  (aviso) Higgsfield: ' + e.message); }
  esp('revisor', `${saidas.length} arquivo(s) conferido(s)`);
  let proj = null; if (!aoVivoOk) try { proj = await filmcraft(saidas, `${path.parse(arq).name}_niobe`); } catch (e) { log('  (aviso) FilmCraft: ' + e.message); }
  if (proj) log(`  [FilmCraft] ${proj === 'importado' ? 'clipes importados' : 'projeto salvo: ' + proj}`);
  if (!cfg.manterArquivosTemporarios) fs.rmSync(pasta, { recursive: true, force: true });
  log(`\nNiobe: pronto em ${((Date.now() - t0) / 60000).toFixed(1)} min. ${plano.resumo || ''}\nArquivos em: ${SAIDA}`);
  if (process.platform === 'win32' && cfg.abrirPastaAoTerminar !== false) spawn('explorer', [SAIDA], { detached: true });
  return saidas;
}

// ---------- Conversa (console; WhatsApp fica para depois em cfg.whatsapp) ----------
const EXT = '(mp4|mov|mkv|avi|webm|m4v|wmv)';
function separar(entrada) {
  const m = entrada.match(new RegExp(`"([^"]+\\.${EXT})"`, 'i')) || entrada.match(new RegExp(`'([^']+\\.${EXT})'`, 'i')) || entrada.match(new RegExp(`((?:[A-Za-z]:\\\\|/)\\S*?\\.${EXT})(?=\\s|$)`, 'i'));
  if (!m) return null; return { arq: m[1], pedido: entrada.replace(m[0], '').trim() };
}
if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let ativa = false, ocupada = false;
  console.log('\n=== NIOBE · edição de vídeo ===\nDigite /Niobe para começar. /ajuda para comandos. Feche a janela para sair.\n');
  const ask = () => rl.question('Maike> ', async l => {
    const e = l.trim();
    if (/^\/?ajuda$/i.test(e)) console.log('/Niobe — chamar a Niobe\n/equipe — ver os 30 especialistas\n/pasta — abrir a pasta dos vídeos prontos\nDepois de chamar: arraste o vídeo para esta janela e escreva o que quer (ex.: "3 reels com legenda", "criativo de anúncio", "só limpar").');
    else if (/^\/?equipe$/i.test(e)) ESPECIALISTAS.forEach((x, i) => console.log(`${String(i + 1).padStart(2)}. ${x.nome} (${x.area})`));
    else if (/^\/?pasta$/i.test(e)) spawn(process.platform === 'win32' ? 'explorer' : 'xdg-open', [SAIDA], { detached: true });
    else if (/^\/?niobe\b/i.test(e) && !separar(e)) { ativa = true; console.log('Niobe: Niobe aqui. Qual vídeo vamos editar? Arraste o arquivo para esta janela e diga o que quer (tipo, formato, para qual cliente).'); }
    else if (e) {
      const s = separar(e);
      if (!ativa && !/^\/?niobe/i.test(e)) console.log('Digite /Niobe para chamar a Niobe.');
      else if (!s) console.log('Niobe: não achei o vídeo. Arraste o arquivo (.mp4, .mov...) para esta janela.');
      else if (!fs.existsSync(s.arq)) console.log('Niobe: esse arquivo não existe: ' + s.arq);
      else if (ocupada) console.log('Niobe: ainda estou editando o anterior; me manda de novo quando eu terminar.');
      else {
        ativa = true; ocupada = true; console.log('Niobe: recebido. Equipe trabalhando...');
        editar(s.arq, s.pedido).catch(err => log('Niobe: deu erro — ' + err.message + ' (detalhes em niobe.log; avise o Claude)')).finally(() => { ocupada = false; console.log('\nManda o próximo vídeo quando quiser.'); });
      }
    }
    ask();
  });
  ask();
}
module.exports = { editar, separar, infoVideo, trechosDeFala, montarAss, ff, log, cfg };
