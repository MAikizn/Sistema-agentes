// DIRETORA — a Niobe ASSISTE ao vídeo (quadros, mudanças de cena e, se der, o áudio) e devolve o roteiro
// de edição seguindo o Manual do Neo (manual-profissional.json). Várias chamadas em paralelo: vale a primeira boa.
const fs = require('fs'), path = require('path');
const DIR = __dirname;

function lerManual() {
  const padrao = { regras: { corteMin: 1.2, corteMax: 2.8, cortesPorReel: [9, 14], duracaoReel: [15, 30], palavrasLegenda: 3, zoomsPorReel: [3, 5] }, licoes: [] };
  try { const m = JSON.parse(fs.readFileSync(path.join(DIR, 'manual-profissional.json'), 'utf8')); return { ...padrao, ...m, regras: { ...padrao.regras, ...(m.regras || {}) } }; } catch { return padrao; }
}
function prompt(manual) {
  const r = manual.regras;
  return `Você é a NIOBE, editora sênior de Reels/Shorts focada em retenção. Você recebe QUADROS do vídeo (cada um com o segundo em que aparece), os segundos onde a cena muda e, quando houver, o ÁUDIO.
Monte reels PROFISSIONAIS e RÁPIDOS seguindo o MANUAL DO NEO (analista de vídeos virais):
${manual.licoes.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Números obrigatórios: cada corte dura de ${r.corteMin} a ${r.corteMax} s; cada reel tem de ${r.cortesPorReel[0]} a ${r.cortesPorReel[1]} cortes e de ${r.duracaoReel[0]} a ${r.duracaoReel[1]} s; legenda com até ${r.palavrasLegenda} palavras; zoom em ${r.zoomsPorReel[0]} a ${r.zoomsPorReel[1]} cortes por reel.

Responda SOMENTE este JSON compacto (sem texto fora dele):
{"resumo":"uma frase","fala":0|1,"marca":"inferior"|"superior"|"","clipes":[{"t":"titulo-curto","g":"gancho até 5 palavras","c":"chamada final até 5 palavras","m":[[inicio,fim,"LEGENDA","DESTAQUE",zoom 0|1]]}]}

Regras de conteúdo:
- "m" é a lista de cortes na ordem em que entram no reel. O primeiro corte é a imagem mais forte e fica SEM legenda ("") porque o gancho aparece nele.
- Escolha o início de cada corte no instante em que a ação acontece (use os quadros e as mudanças de cena). Não use blocos iguais.
- Com fala: cada corte cobre uma frase inteira e a legenda resume o que foi dito. Sem fala: a legenda narra o que se vê, na voz de quem gravou ("LIGA, MAS NÃO GIRA").
- "DESTAQUE" é uma palavra que está na legenda. Confira a ortografia de cada palavra.
- "marca": onde há data/hora, logo de aplicativo ou marca d'água gravada na imagem; "" se não houver.
- Não invente preço, marca, resultado ou fala que não esteja no vídeo. Use só tempos que existem. Português do Brasil.
- Quantidade de reels: a que o pedido disser. Sem pedido: 1 reel. Não repita o mesmo trecho em dois reels.`;
}
function extrairJson(t) {
  t = String(t || '').replace(/```json|```/g, ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

// Uma passada só do FFmpeg: quadros (Analista), mudanças de cena (Ritmista) e áudio (Transcritor)
async function prepararMidia({ arq, info, pasta, ff, cadaSeg = 2.2, maxQuadros = 40 }) {
  const n = Math.max(10, Math.min(maxQuadros, Math.round(info.duracao / cadaSeg))), fps = (n / info.duracao).toFixed(5), mp3 = path.join(pasta, 'audio.mp3');
  const args = ['-i', arq, '-filter_complex', `[0:v]split=2[a][b];[a]fps=${fps},scale=224:-2[f];[b]scale=160:-2,select='gt(scene,0.28)',showinfo[s]`,
    '-map', '[f]', '-q:v', '8', '-frames:v', String(n), path.join(pasta, 'q_%03d.jpg'), '-map', '[s]', '-f', 'null', '-'];
  if (info.audio) args.push('-map', '0:a', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-t', '480', mp3);
  const err = await ff(args);
  const cenas = [...String(err).matchAll(/pts_time:([\d.]+)/g)].map(m => +(+m[1]).toFixed(1));
  const quadros = [], passo = info.duracao / n;
  for (let i = 1; i <= n; i++) { const f = path.join(pasta, `q_${String(i).padStart(3, '0')}.jpg`); if (fs.existsSync(f)) quadros.push({ t: +((i - 0.5) * passo).toFixed(1), b64: fs.readFileSync(f).toString('base64') }); }
  return { quadros, cenas, audio: fs.existsSync(mp3) ? fs.readFileSync(mp3).toString('base64') : null };
}

// Chamada multimodal pelo FreeLLMAPI (formato OpenAI). Devolve o JSON da resposta.
async function perguntar({ cfg, sistema, texto, midia, modelo, comAudio, log, maxTokens = 2500, quem = 'direção' }) {
  const content = [{ type: 'text', text: texto }];
  for (const q of midia.quadros) { content.push({ type: 'text', text: `t=${q.t}s` }); content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + q.b64 } }); }
  if (comAudio && midia.audio) content.push({ type: 'input_audio', input_audio: { data: midia.audio, format: 'mp3' } });
  const t0 = Date.now();
  const r = await fetch(cfg.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.llm.apiKey },
    body: JSON.stringify({ model: modelo, temperature: 0.4, max_tokens: maxTokens, reasoning_effort: 'low', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sistema }, { role: 'user', content }] }),
  });
  const corpo = await r.text(), rot = `${modelo}${comAudio && midia.audio ? '+áudio' : ''}`;
  if (!r.ok) { log(`  (${quem}) ${rot}: erro ${r.status} ${corpo.slice(0, 140).replace(/\s+/g, ' ')}`); throw new Error('http ' + r.status); }
  let txt = ''; try { txt = JSON.parse(corpo).choices?.[0]?.message?.content || ''; } catch {}
  const j = extrairJson(txt); if (!j) { log(`  (${quem}) ${rot}: resposta sem JSON (${String(txt).slice(0, 100).replace(/\s+/g, ' ')})`); throw new Error('sem json'); }
  return { j, rota: rot, s: ((Date.now() - t0) / 1000).toFixed(1) };
}
const corrida = async lista => { try { return await Promise.any(lista.map(f => f())); } catch { return null; } };
// Chamadas escalonadas: dispara a 1ª; se ela demorar `atraso` ms ou falhar, entra a próxima. Vale a primeira resposta boa.
// (Disparar tudo de uma vez estourava o limite da conta gratuita e voltava erro 502.)
function escalonada(lista, atraso = 8000) {
  return new Promise(res => {
    let prox = 0, vivos = 0, feito = false, timer = null;
    const lancar = () => {
      if (feito || prox >= lista.length) return; const f = lista[prox++]; vivos++;
      clearTimeout(timer); timer = setTimeout(lancar, atraso);
      f().then(r => { if (!feito) { feito = true; clearTimeout(timer); res(r); } }, () => { vivos--; if (feito) return; if (prox < lista.length) lancar(); else if (vivos === 0) { clearTimeout(timer); res(null); } });
    };
    lancar();
  });
}
// Gemini direto, com a chave própria da Niobe (config.json > geminiApiKey), quando ela é válida
async function perguntarGemini({ cfg, sistema, texto, midia, modelo, log }) {
  const parts = [{ text: sistema + '\n\n' + texto }];
  for (const q of midia.quadros) { parts.push({ text: `t=${q.t}s` }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: q.b64 } }); }
  if (midia.audio) parts.push({ inline_data: { mime_type: 'audio/mp3', data: midia.audio } });
  const t0 = Date.now(), r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiApiKey },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }) });
  const corpo = await r.text();
  if (!r.ok) { if (r.status === 401 || r.status === 403 || /API key not valid/i.test(corpo)) gravarRota({ ...lerRota(), chaveDiretaRuim: cfg.geminiApiKey.slice(-6) }); throw new Error('http ' + r.status); }
  let txt = ''; try { txt = JSON.parse(corpo).candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') || ''; } catch {}
  const j = extrairJson(txt); if (!j) throw new Error('sem json');
  return { j, rota: 'Gemini direto ' + modelo + (midia.audio ? '+áudio' : ''), s: ((Date.now() - t0) / 1000).toFixed(1) };
}
const ROTA = path.join(DIR, 'ao-vivo', 'rota.json');
function lerRota() { try { return JSON.parse(fs.readFileSync(ROTA, 'utf8')); } catch { return {}; } }
function gravarRota(r) { try { fs.writeFileSync(ROTA, JSON.stringify(r)); } catch {} }
// Fila de chamadas para um pedido multimodal: o modelo que respondeu por último vai na frente
function filaDeModelos({ cfg, sistema, texto, midia, log, quem, valido }) {
  const d = cfg.direcao || {}, rota = lerRota();
  const modelos = [rota.modelo, ...[].concat(d.modelos || []), 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'].filter((m, i, a) => m && a.indexOf(m) === i).slice(0, 5);
  const ok = modelo => r => { if (!valido(r.j)) throw new Error('resposta incompleta'); gravarRota({ ...lerRota(), modelo }); return r; };
  const lista = modelos.map(m => () => perguntar({ cfg, sistema, texto, midia, modelo: m, comAudio: false, log, quem }).then(ok(m)));
  if (cfg.geminiApiKey && rota.chaveDiretaRuim !== cfg.geminiApiKey.slice(-6)) lista.splice(1, 0, () => perguntarGemini({ cfg, sistema, texto, midia, modelo: modelos[0], log }).then(r => { if (!valido(r.j)) throw new Error('resposta incompleta'); return r; }));
  if (midia.audio && d.tentarAudio === true) lista.splice(1, 0, () => perguntar({ cfg, sistema, texto, midia, modelo: modelos[0], comAudio: true, log, quem }).then(ok(modelos[0])));
  // Com a chave do Haiku 5.5 (haiku.js), a Niobe e a equipe usam só ele; a fila acima vira reserva e só entra se ele falhar
  const hk = require('./haiku');
  if (!hk.config(cfg).pronto) return lista;
  return [async () => {
    for (let t = 0; t < 2; t++) {
      const t0 = Date.now();
      try {
        const j = extrairJson(await hk.perguntar({ cfg, sistema, texto, quadros: midia.quadros, maxTokens: 2500 }));
        if (j && valido(j)) return { j, rota: 'Haiku 5.5', s: ((Date.now() - t0) / 1000).toFixed(1) };
        log(`  (${quem}) Haiku 5.5: resposta incompleta`);
      } catch (e) { log(`  (${quem}) Haiku 5.5: ${e.message}`); }
    }
    log(`  (${quem}) Haiku indisponível; usando os modelos gratuitos de reserva.`);
    const r = await escalonada(lista, d.esperaEntreModelos || 8000);
    if (!r) throw new Error('nenhum modelo respondeu');
    return r;
  }];
}


function normalizar(j, info, pedido, manual) {
  const dur = info.duracao, r = manual.regras, clipes = [];
  for (const c of j.clipes || []) {
    const ms = [];
    for (const m of c.m || c.momentos || []) {
      const [ini, fim, leg, des, zoom] = Array.isArray(m) ? m : [m.inicio, m.fim, m.legenda, m.destaque, m.zoom];
      const a = Math.max(0, +ini), b = Math.min(dur, +fim); if (!(b - a >= 0.7)) continue;
      let legenda = String(leg || '').trim().toUpperCase(); if (legenda.length > 30) legenda = legenda.split(/\s+/).slice(0, 4).join(' ');
      ms.push({ inicio: a, fim: Math.min(b, a + Math.max(4.5, r.corteMax * 1.6)), legenda, destaque: String(des || '').trim().toUpperCase(), zoom: !!+zoom || zoom === true });
    }
    if (ms.length < 2) continue;
    clipes.push({ titulo: String(c.t || c.titulo || 'reel').replace(/[^\w\-]+/g, '-').slice(0, 30), gancho: String(c.g || c.gancho || '').trim(), cta: String(c.c || c.cta || '').trim(), momentos: ms.slice(0, 18),
      inicio: Math.min(...ms.map(m => m.inicio)), fim: Math.max(...ms.map(m => m.fim)) });
  }
  if (!clipes.length) return null;
  const formato = /16:9|horizontal|deitado/i.test(pedido || '') ? '16:9' : /1:1|quadrad/i.test(pedido || '') ? '1:1' : '9:16';
  const marca = String(j.marca || j.marcaNoCanto || '');
  return { dirigido: true, tipo: 'reels', formato, clipes, ganchos: clipes.map(c => c.gancho), cta: clipes[0].cta, legendas: true, zoomDinamico: true, removerSilencio: false, cor: 'natural',
    corteMax: r.corteMax, nivel: /profission/i.test(pedido || '') ? 'profissional' : 'padrao', resumo: String(j.resumo || ''), temFala: !!+(j.fala ?? j.temFala), marcaNoCanto: /inferior|superior/.test(marca) ? marca : null };
}

async function dirigir({ arq, info, pedido, pasta, cfg, ff, log }) {
  const t0 = Date.now(), manual = lerManual();
  // Mesmo vídeo + mesmo pedido + mesmo manual = roteiro já pronto (escreva "novo roteiro" no pedido para refazer)
  const refazer = /novo roteiro|outro roteiro|refa[çc]a|de novo/i.test(pedido || '');
  let cache = null;
  try { const st = fs.statSync(arq), dirC = path.join(DIR, 'trabalho', 'roteiros'); fs.mkdirSync(dirC, { recursive: true });
    cache = path.join(dirC, require('crypto').createHash('sha1').update([arq, st.size, st.mtimeMs, String(pedido || '').replace(/novo roteiro|outro roteiro|refa[çc]a|de novo/ig, '').trim().toLowerCase(), JSON.stringify(manual.regras), manual.licoes.join('|')].join('::')).digest('hex').slice(0, 16) + '.json');
    if (!refazer && fs.existsSync(cache)) { const plano = JSON.parse(fs.readFileSync(cache, 'utf8')); return { plano, rota: 'roteiro guardado deste vídeo', s: ((Date.now() - t0) / 1000).toFixed(1) }; }
  } catch {}
  const midia = await prepararMidia({ arq, info, pasta, ff, cadaSeg: Math.max(1.5, info.duracao / 40) });
  if (midia.quadros.length < 4) throw new Error('não consegui extrair os quadros');
  const tPrep = ((Date.now() - t0) / 1000).toFixed(1);
  const texto = `PEDIDO DO MAIKE: ${pedido || '(sem instrução: decida o melhor)'}\nVÍDEO: ${info.duracao.toFixed(1)} s, ${info.w}x${info.h}, ${info.audio ? 'com áudio' : 'sem áudio'}.\nMUDANÇAS DE CENA (s): ${midia.cenas.slice(0, 60).join(', ') || 'nenhuma detectada'}\nSeguem ${midia.quadros.length} quadros em ordem.`;
  const r = await escalonada(filaDeModelos({ cfg, sistema: prompt(manual), texto, midia, log, quem: 'direção', valido: j => Array.isArray(j.clipes) && !!normalizar(j, info, pedido, manual) }), (cfg.direcao || {}).esperaEntreModelos || 8000);
  if (!r) return null;
  const plano = normalizar(r.j, info, pedido, manual); if (!plano) return null;
  try { if (cache) fs.writeFileSync(cache, JSON.stringify(plano)); } catch {}
  return { plano, rota: `${r.rota}, preparo ${tPrep}s, modelo ${r.s}s`, s: ((Date.now() - t0) / 1000).toFixed(0) };
}
module.exports = { dirigir, normalizar, lerManual, prepararMidia, perguntar, corrida, escalonada, filaDeModelos };
