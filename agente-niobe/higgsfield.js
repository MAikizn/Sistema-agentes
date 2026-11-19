// HIGGSFIELD — gera B-roll (imagens) para a Niobe pela API oficial (api.higgsfield.ai).
// Precisa de créditos e de uma chave criada em https://cloud.higgsfield.ai (formato "ID:SECRET"),
// colocada em config.json > higgsfield.credenciais. Sem chave, a Niobe edita normalmente sem B-roll.
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const cfgTudo = () => JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const espera = ms => new Promise(r => setTimeout(r, ms));

function config() {
  const c = cfgTudo().higgsfield || {};
  const cred = String(c.credenciais || process.env.HF_KEY || '').trim();
  return { ...c, cred, pronto: !!(c.ativo && /^[^:\s]+:[^:\s]+$/.test(cred)), base: (c.baseUrl || 'https://api.higgsfield.ai').replace(/\/$/, '') };
}

async function chamar(c, metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, headers: { Authorization: 'Key ' + c.cred, ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = { bruto: txt }; }
  if (r.status === 401) throw new Error('Higgsfield: chave inválida (confira ID:SECRET em config.json)');
  if (r.status === 403) throw new Error('Higgsfield: sem créditos (recarregue em cloud.higgsfield.ai)');
  if (!r.ok) throw new Error(`Higgsfield ${r.status}: ${(j.detail || j.message || txt).toString().slice(0, 200)}`);
  return j;
}

async function gerar(c, modelo, corpo, destinoSemExt) {
  const pedido = await chamar(c, 'POST', `${c.base}/${modelo}`, corpo);
  const statusUrl = pedido.status_url || `${c.base}/requests/${pedido.request_id}/status`;
  const limite = Date.now() + (c.limiteSegundos || 300) * 1000;
  while (Date.now() < limite) {
    await espera(4000);
    const s = await chamar(c, 'GET', statusUrl);
    if (s.status === 'completed') {
      const url = (s.video && s.video.url) || (s.images && s.images[0] && s.images[0].url);
      if (!url) throw new Error('Higgsfield terminou sem arquivo');
      const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
      const ext = (path.extname(new URL(url).pathname) || (s.video ? '.mp4' : '.jpg')).slice(0, 5);
      fs.mkdirSync(path.dirname(destinoSemExt), { recursive: true });
      fs.writeFileSync(destinoSemExt + ext, bin);
      return { arq: destinoSemExt + ext, url };
    }
    if (['failed', 'nsfw', 'canceled'].includes(s.status)) throw new Error('Higgsfield: geração ' + s.status);
  }
  throw new Error('Higgsfield demorou demais');
}

// Imagem: devolve o caminho do arquivo salvo
async function gerarImagem(prompt, destinoSemExt, proporcao = '9:16') {
  const c = config(); if (!c.pronto) throw new Error('Higgsfield desligado ou sem chave');
  return (await gerar(c, c.modeloImagem || 'higgsfield-ai/soul/v2/standard', { prompt, aspect_ratio: proporcao }, destinoSemExt)).arq;
}

// Vídeo: gera a imagem e anima (imagem para vídeo). Devolve o caminho do .mp4
async function gerarVideo(prompt, destinoSemExt, proporcao = '9:16', movimento = '') {
  const c = config(); if (!c.pronto) throw new Error('Higgsfield desligado ou sem chave');
  const img = await gerar(c, c.modeloImagem || 'higgsfield-ai/soul/v2/standard', { prompt, aspect_ratio: proporcao }, destinoSemExt + '_quadro');
  const corpo = { prompt: movimento || ('slow cinematic camera push-in, subtle natural motion. ' + prompt), image_url: img.url, duration: c.duracaoVideo || 5, resolution: c.resolucaoVideo || '720p' };
  return (await gerar(c, c.modeloVideo || 'higgsfield-ai/dop/lite', corpo, destinoSemExt)).arq;
}

// Gera o B-roll que o plano da Niobe pediu (plano.broll = [{seg, prompt}]). Erros não param a edição.
async function gerarBroll(plano, pastaDestino, log = console.log) {
  const c = config(); const lista = (plano.broll || []).filter(b => b && b.prompt).slice(0, c.maxPorVideo || 3);
  if (!c.pronto || !lista.length) return [];
  const prop = plano.formato === '16:9' ? '16:9' : plano.formato === '1:1' ? '1:1' : '9:16';
  const feitos = await Promise.all(lista.map(async (b, i) => {
    try { const fn = (c.tipoBroll === 'video' ? gerarVideo : gerarImagem); const arq = await fn(b.prompt, path.join(pastaDestino, `broll_${String(i + 1).padStart(2, '0')}_${Math.round(+b.seg || 0)}s`), prop); log(`  [Editor de B-roll] ${path.basename(arq)} gerado (${b.prompt.slice(0, 60)})`); return arq; }
    catch (e) { log(`  [Editor de B-roll] (aviso) ${e.message}`); return null; }
  }));
  return feitos.filter(Boolean);
}

module.exports = { config, gerarImagem, gerarVideo, gerarBroll };

// Teste rápido: node higgsfield.js "prompt"
if (require.main === module) {
  const c = config();
  if (!c.pronto) { console.log('Higgsfield ainda não configurado: coloque a chave ID:SECRET em config.json > higgsfield.credenciais e "ativo": true.'); process.exit(1); }
  const fn = (process.argv.includes('--video') || c.tipoBroll === 'video') ? gerarVideo : gerarImagem;
  fn(process.argv.slice(2).find(a => !a.startsWith('--')) || 'close-up of a modern washing machine in a bright laundry room, soft daylight, product photography', path.join(DIR, 'saida', 'teste-higgsfield'))
    .then(a => console.log('OK: ' + a), e => { console.error(e.message); process.exit(1); });
}
