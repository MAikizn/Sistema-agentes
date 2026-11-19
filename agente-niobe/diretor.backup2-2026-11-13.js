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
async function prepararMidia({ arq, info, pasta, ff, cadaSeg = 2.2, maxQuadros = 80 }) {
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
  const midia = await prepararMidia({ arq, info, pasta, ff });
  if (midia.quadros.length < 4) throw new Error('não consegui extrair os quadros');
  const tPrep = ((Date.now() - t0) / 1000).toFixed(1);
  const texto = `PEDIDO DO MAIKE: ${pedido || '(sem instrução: decida o melhor)'}\nVÍDEO: ${info.duracao.toFixed(1)} s, ${info.w}x${info.h}, ${info.audio ? 'com áudio' : 'sem áudio'}.\nMUDANÇAS DE CENA (s): ${midia.cenas.slice(0, 60).join(', ') || 'nenhuma detectada'}\nSeguem ${midia.quadros.length} quadros em ordem.`;
  const d = cfg.direcao || {}, sistema = prompt(manual);
  const fortes = [].concat(d.modelos || ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.7-flash']), reserva = [].concat(d.modelosReserva || ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.6-flash']);
  const chamar = (modelo, comAudio) => async () => { const r = await perguntar({ cfg, sistema, texto, midia, modelo, comAudio, log }); if (!Array.isArray(r.j.clipes)) throw new Error('sem clipes'); return r; };
  // Corrida: os modelos fortes ao mesmo tempo (um deles ouvindo o áudio); vale o primeiro roteiro válido
  let r = await corrida([...(midia.audio && d.tentarAudio !== false ? [chamar(fortes[0], true)] : []), ...fortes.map(m => chamar(m, false))]);
  if (!r) r = await corrida(reserva.map(m => chamar(m, false)));
  if (!r) return null;
  const plano = normalizar(r.j, info, pedido, manual); if (!plano) return null;
  return { plano, rota: `${r.rota}, preparo ${tPrep}s, modelo ${r.s}s`, s: ((Date.now() - t0) / 1000).toFixed(0) };
}
module.exports = { dirigir, normalizar, lerManual, prepararMidia, perguntar, corrida };
