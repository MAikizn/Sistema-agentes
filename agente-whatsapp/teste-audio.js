// Treino de áudio: cria áudios de teste (claro, ruído, baixo, silêncio, música...) e verifica se o Morfeus entende.
const fs = require('fs'), os = require('os'), path = require('path');
const _log = console.log; console.log = (...a) => { fs.appendFileSync(path.join(__dirname, 'diag-audio.txt'), a.join(' ') + '\n'); _log(...a); };
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const audio = require('./audio');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const tmp = p => path.join(os.tmpdir(), 'morfeus-' + p);
const ff = args => { const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args]); if (r.status) throw new Error(String(r.stderr)); };
const OGG = ['-ac', '1', '-c:a', 'libopus', '-b:a', '32k'];
(async () => {
  const voz = async (txt, prosodia = {}) => { const b = await audio.gravar(txt, 'pt-BR-AntonioNeural', prosodia); fs.writeFileSync(tmp('voz.ogg'), b); return tmp('voz.ogg'); };
  const cenarios = [
    ['Fala clara (lead normal)', async () => fs.readFileSync(await voz('Oi, boa tarde! Eu tenho uma loja de roupas aqui em Goiânia e queria vender mais pelo Instagram. Como funciona?')), 'ok'],
    ['Fala rápida e com gírias', async () => fs.readFileSync(await voz('E aí mano, beleza? Então, tô precisando de cliente pra minha barbearia, tá fraco demais, cê consegue me ajudar com isso aí?', { rate: '+35%' })), 'ok'],
    ['Fala com ruído de fundo moderado', async () => { const v = await voz('Oi, quero saber quanto custa pra fazer um site pra minha clínica.'); ff(['-i', v, '-f', 'lavfi', '-i', 'anoisesrc=a=0.04:d=8', '-filter_complex', 'amix=inputs=2:duration=first', ...OGG, tmp('c.ogg')]); return fs.readFileSync(tmp('c.ogg')); }, 'ok'],
    ['Fala abafada por ruído muito forte', async () => { const v = await voz('Oi, quero saber quanto custa pra fazer um site.'); ff(['-i', v, '-f', 'lavfi', '-i', 'anoisesrc=a=0.9:d=8', '-filter_complex', '[0]volume=0.08[a];[a][1]amix=inputs=2:duration=first', ...OGG, tmp('c.ogg')]); return fs.readFileSync(tmp('c.ogg')); }, 'inaudivel'],
    ['Fala baixinha (longe do celular)', async () => { const v = await voz('Oi, vi seu anúncio e queria mais informações sobre o tráfego pago.'); ff(['-i', v, '-af', 'volume=0.12', ...OGG, tmp('c.ogg')]); return fs.readFileSync(tmp('c.ogg')); }, 'ok'],
    ['Silêncio (gravou sem falar)', async () => { ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '4', ...OGG, tmp('c.ogg')]); return fs.readFileSync(tmp('c.ogg')); }, 'sem_fala'],
    ['Só barulho/chiado', async () => { ff(['-f', 'lavfi', '-i', 'anoisesrc=a=0.3:c=brown:d=5', ...OGG, tmp('c.ogg')]); return fs.readFileSync(tmp('c.ogg')); }, 'sem_fala|inaudivel'],
    ['Só música', async () => { ff(['-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*(440+110*floor(mod(t*2,4)))*t)+0.2*sin(2*PI*220*t)':s=48000:d=6", ...OGG, tmp('c.ogg')]); return fs.readFileSync(tmp('c.ogg')); }, 'musica|sem_fala'],
    ['Áudio em inglês', async () => fs.readFileSync(await voz('Hello, I would like to know more about your marketing services.')), 'ok'],
  ];
  let md = `# Treino de áudio do Morfeus - ${new Date().toLocaleString('pt-BR')}\n\n| Cenário | Esperado | Resultado | Transcrição |\n|---|---|---|---|\n`;
  for (const [nome, gerar, esperado] of cenarios) {
    let res;
    try { res = await audio.transcrever(await gerar(), cfg, 5); } catch (e) { res = { tipo: 'erro', texto: e.message }; }
    const ok = new RegExp('^(' + esperado + ')$').test(res.tipo) ? '✅' : '❌';
    md += `| ${nome} | ${esperado} | ${ok} ${res.tipo} | ${(res.texto || '').replace(/\|/g, '/').slice(0, 140)} |\n`;
    console.log(ok, nome, res.tipo);
    await new Promise(r => setTimeout(r, 4000));
  }
  fs.writeFileSync(path.join(__dirname, 'treino-audio.md'), md);
  console.log('Pronto: treino-audio.md');
})();
