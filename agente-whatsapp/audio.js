// Skill de áudio do Morfeus: entende áudios recebidos e grava respostas em voz.
const { spawn, execSync } = require('child_process');
const path = require('path');
function garantirDeps() {
  try { require.resolve('ffmpeg-static'); require.resolve('msedge-tts'); return; } catch {}
  console.log('Instalando a skill de áudio (1ª vez, 1-2 min)...');
  execSync('npm install ffmpeg-static@5 msedge-tts@2 --omit=dev', { cwd: __dirname, stdio: 'inherit' });
}
garantirDeps();
const ffmpeg = require('ffmpeg-static');

function converter(buf, args) {
  return new Promise((ok, erro) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...args, 'pipe:1']);
    const out = []; p.stdout.on('data', d => out.push(d)); p.stderr.on('data', () => {});
    p.on('close', c => c === 0 ? ok(Buffer.concat(out)) : erro(new Error('ffmpeg ' + c)));
    p.stdin.end(buf);
  });
}

// Áudio recebido -> { tipo, texto }. tipo: ok | sem_fala | inaudivel | musica | falha
const PROMPT_TRANS = `Você recebe um áudio de WhatsApp de um cliente. Responda APENAS em uma destas formas:
- Se há fala compreensível: a transcrição fiel do que foi dito (no idioma falado), sem comentários.
- Se o áudio está em silêncio ou sem voz humana: [SEM_FALA]
- Se há voz mas não dá para entender (ruído, vento, muito baixo, cortado, enrolado): [INAUDIVEL]
- Se é só música/som sem mensagem falada: [MUSICA]`;
const RUIM = /(nenhum (arquivo|áudio)|não (há|foi) (enviado|fornecido)|forne[çc]a o [áa]udio|envie o [áa]udio|n[ãa]o consigo (ouvir|acessar|processar)|i can'?t|no audio)/i;
function nivelSom(buf) { // mede o volume real do áudio (evita a IA "inventar" fala em áudio mudo)
  const r = require('child_process').spawnSync(ffmpeg, ['-hide_banner', '-i', 'pipe:0', '-af', 'volumedetect', '-f', 'null', '-'], { input: buf });
  const e = String(r.stderr || '');
  return { media: parseFloat((e.match(/mean_volume: (-?[\d.]+)/) || [])[1] ?? -91), pico: parseFloat((e.match(/max_volume: (-?[\d.]+)/) || [])[1] ?? -91) };
}
async function transcrever(buf, cfg, segundos = 0) {
  if (segundos && segundos < 1) return { tipo: 'sem_fala' };
  const nv = nivelSom(buf);
  if (nv.pico < -40 || nv.media < -60) return { tipo: 'sem_fala', nivel: nv };
  const key = cfg.geminiApiKey;
  if (!key || /COLE_AQUI/.test(key)) return { tipo: 'falha', erro: 'sem chave do Google' };
  for (const model of [].concat(cfg.modeloTranscricao || ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'])) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'audio/ogg', data: buf.toString('base64') } }, { text: PROMPT_TRANS }] }],
          generationConfig: { temperature: 0 } }) });
      if (!r.ok) { dbg('Transcrição', model, r.status, (await r.text()).slice(0, 200)); continue; }
      const t = ((await r.json()).candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!t || RUIM.test(t)) { dbg('Transcrição', model, 'resposta inválida:', t.slice(0, 120)); continue; }
      if (/\[SEM_FALA\]/.test(t)) return { tipo: 'sem_fala' };
      if (/\[INAUDIVEL\]/.test(t)) return { tipo: 'inaudivel' };
      if (/\[MUSICA\]/.test(t)) return { tipo: 'musica' };
      return { tipo: 'ok', texto: t };
    } catch (e) { dbg('Transcrição', model, e.message); }
  }
  return { tipo: 'falha' };
}
function dbg(...a){ try{ console.log(...a); require('fs').appendFileSync(path.join(__dirname,'agente.log'), new Date().toLocaleString('pt-BR')+' ⚠️ '+a.join(' ')+'\n'); }catch{} }
const RESPOSTAS_NAO_ENTENDI = {
  sem_fala: 'Opa, não consegui ouvir a sua voz nesse áudio. Pode gravar de novo pra mim, ou escrever aqui?',
  inaudivel: 'Opa, não consegui entender direito o seu áudio, ficou com bastante ruído. Pode mandar de novo, ou se preferir, escrever aqui?',
  musica: 'Recebi um áudio com música, mas não identifiquei nenhuma mensagem. Me conta, por áudio ou por texto, como eu posso te ajudar?',
  falha: 'Opa, não consegui ouvir o seu áudio agora. Pode mandar de novo, ou escrever aqui pra mim?'
};

// Texto -> áudio de voz do WhatsApp (ogg/opus)
async function gravar(texto, voz = 'pt-BR-AntonioNeural', prosodia = {}) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voz, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const limpo = texto.replace(/[*_~`]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s*\n+\s*/g, '... ').trim();
  const res = tts.toStream(limpo, prosodia);
  const stream = res.audioStream || res;
  const partes = []; for await (const c of stream) partes.push(c);
  try { tts.close && tts.close(); } catch {}
  // "humaniza": timbre mais quente e encorpado, leve ambiência de sala, como áudio gravado no celular
  const filtro = 'highpass=f=70,bass=g=4:f=120,equalizer=f=250:t=q:w=1.2:g=1.5,equalizer=f=3200:t=q:w=1:g=2,lowpass=f=8500,aecho=0.85:0.5:18|33:0.10|0.06,acompressor=threshold=-20dB:ratio=3:attack=10:release=150,volume=1.4';
  return converter(Buffer.concat(partes), ['-ac', '1', '-af', filtro, '-c:a', 'libopus', '-b:a', '40k', '-f', 'ogg']);
}
async function gerarAmostras(pasta) {
  const fs = require('fs'); fs.mkdirSync(pasta, { recursive: true });
  const frase = 'Olá. Eu sou o Morfeus. Hoje você vai decidir se continua dependendo da sorte, ou se começa a atrair clientes todos os dias.';
  const vozes = ['pt-BR-AntonioNeural', 'pt-BR-JulioNeural', 'pt-BR-FabioNeural', 'pt-BR-HumbertoNeural', 'pt-BR-NicolauNeural', 'pt-BR-ValerioNeural', 'pt-BR-DonatoNeural'];
  const estilos = { normal: {}, grave: { pitch: '-12%', rate: '-12%' }, 'muito-grave': { pitch: '-20%', rate: '-18%' } };
  const feitos = [];
  for (const v of vozes) for (const [nome, p] of Object.entries(estilos)) {
    try { const ogg = await gravar(frase, v, p); const arq = path.join(pasta, `${v.replace('pt-BR-', '').replace('Neural', '')}-${nome}.ogg`); fs.writeFileSync(arq, ogg); feitos.push(arq); } catch {}
  }
  return feitos;
}
// Voz neural do Google (Gemini TTS) — bem mais humana. Precisa de "geminiApiKey" no config.json (grátis no AI Studio).
const FILTRO_CEL = 'highpass=f=70,bass=g=2:f=120,lowpass=f=9000,acompressor=threshold=-20dB:ratio=2.5:attack=10:release=150';
async function gravarGemini(texto, cfg) {
  const key = cfg.geminiApiKey; if (!key) throw new Error('sem geminiApiKey');
  const voz = cfg.vozGemini || 'Charon';
  const limpo = texto.replace(/[*_~`]/g, '').replace(/\p{Extended_Pictographic}/gu, '').trim();
  for (const model of [].concat(cfg.modeloTts || ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'])) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: limpo }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } } }) });
      if (!r.ok) { console.log('TTS', model, r.status, (await r.text()).slice(0, 120)); continue; }
      const part = (await r.json()).candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part) continue;
      const pcm = Buffer.from(part.inlineData.data, 'base64');
      const rate = (part.inlineData.mimeType.match(/rate=(\d+)/) || [])[1] || '24000';
      return await new Promise((ok, erro) => {
        const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', rate, '-ac', '1', '-i', 'pipe:0', '-af', FILTRO_CEL, '-c:a', 'libopus', '-b:a', '40k', '-f', 'ogg', 'pipe:1']);
        const out = []; p.stdout.on('data', d => out.push(d)); p.on('close', c => c === 0 ? ok(Buffer.concat(out)) : erro(new Error('ffmpeg ' + c))); p.stdin.end(pcm);
      });
    } catch (e) { console.log('TTS', model, e.message); }
  }
  throw new Error('Gemini TTS indisponível');
}
// Usa a voz do Google; se não der, cai na voz gratuita da Microsoft
async function falar(texto, cfg) {
  if (cfg.geminiApiKey && !/COLE_AQUI/.test(cfg.geminiApiKey)) try { return await gravarGemini(texto, cfg); } catch (e) { console.log('Voz Google falhou:', e.message); }
  return gravar(texto, cfg.vozAudio, cfg.vozProsodia || {});
}
module.exports = { RESPOSTAS_NAO_ENTENDI, transcrever, gravar, gerarAmostras, gravarGemini, falar };
