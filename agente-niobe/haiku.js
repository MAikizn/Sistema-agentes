// HAIKU 5.5 — o cérebro exclusivo da Niobe e dos 30 especialistas dela (Claude Haiku 5.5, pela API da Anthropic).
// Só a Niobe usa este arquivo: os outros agentes pensam com a Unidade.
// Liga sozinho quando existe uma chave em config.json > haiku > apiKey. Sem chave, a Niobe segue nos modelos gratuitos.
// O Haiku lê os quadros do vídeo e escreve roteiro, cortes, legendas e prompts de imagem; quem gera a imagem/vídeo
// continua sendo o Higgsfield, e quem corta e exporta é o FFmpeg/FilmCraft. Áudio ele não ouve: a transcrição segue no Gemini.
const fs = require('fs'), path = require('path');

const DIR = __dirname;
const lerCfg = () => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8')); } catch { return {}; } };

function config(cfg) {
  const h = (cfg || lerCfg()).haiku || {};
  const apiKey = String(h.apiKey || '').trim();
  const assinatura = (h.modo || 'assinatura') === 'assinatura'; // assinatura = Claude Code logado com a conta do Claude (sem chave de API)
  return { modelo: h.modelo || 'claude-haiku-5-5', esforco: h.esforco || 'low', apiKey, assinatura, comando: h.comando || 'claude',
    pronto: h.ativo !== false && (assinatura || apiKey.startsWith('sk-ant-')) };
}

let cliente = null, chaveDoCliente = '';
function client(h) {
  if (cliente && chaveDoCliente === h.apiKey) return cliente;
  const m = require('@anthropic-ai/sdk'), Anthropic = m.default || m.Anthropic || m;
  chaveDoCliente = h.apiKey;
  return cliente = new Anthropic({ apiKey: h.apiKey, timeout: 90000, maxRetries: 1 });
}

// mensagens no formato da Anthropic: [{ role: 'user'|'assistant', content: string | blocos }]
// Modo assinatura: chama o Claude Code (claude -p) que está logado com a assinatura do Claude neste PC.
// Os quadros viram arquivos .jpg temporários que o Claude Code lê com a ferramenta Read.
function viaAssinatura(h, sistema, msgs) {
  const os = require('os'), { spawn } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'niobe-haiku-')); let n = 0;
  const partes = msgs.map(m => {
    const blocos = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    const txt = blocos.map(b => {
      if (b.type === 'text') return b.text;
      if (b.type === 'image' && b.source && b.source.data) { const f = path.join(tmp, `quadro_${++n}.jpg`); fs.writeFileSync(f, Buffer.from(b.source.data, 'base64')); return `[imagem: ${f}]`; }
      return '';
    }).join('\n');
    return (m.role === 'assistant' ? 'RESPOSTA ANTERIOR:\n' : '') + txt;
  }).join('\n\n');
  const prompt = (sistema ? `INSTRUÇÕES DO SISTEMA:\n${sistema}\n\n` : '')
    + (n ? 'Antes de responder, abra com a ferramenta Read cada arquivo marcado como [imagem: ...] (são quadros do vídeo).\n\n' : '')
    + partes + '\n\nResponda só com o conteúdo pedido, sem comentários.';
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; // força o login da assinatura
  const args = ['-p', '--model', h.modelo, '--output-format', 'text', ...(n ? ['--allowedTools', 'Read', '--add-dir', `"${tmp}"`] : [])];
  return new Promise((ok, falha) => {
    const p = spawn(h.comando, args, { env, shell: true, windowsHide: true, cwd: tmp });
    let out = '', err = ''; const t = setTimeout(() => { p.kill(); falha(new Error('Claude Code passou de 180 s')); }, 180000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(t); falha(new Error('Claude Code não encontrado (instale e faça login): ' + e.message)); });
    p.on('close', c => { clearTimeout(t); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      const texto = out.trim(); if (c === 0 && texto) ok(texto); else falha(new Error(`Claude Code saiu com código ${c}: ${(err || out).trim().slice(0, 400)}`)); });
    p.stdin.end(prompt, 'utf8');
  });
}

async function conversar({ cfg, sistema, mensagens, maxTokens = 4000 }) {
  const h = config(cfg);
  if (h.pronto && h.assinatura) {
    const ms = mensagens.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content && m.content.length);
    while (ms.length && ms[0].role !== 'user') ms.shift(); if (!ms.length) throw new Error('Haiku: conversa vazia');
    return viaAssinatura(h, sistema, ms);
  } if (!h.pronto) throw new Error('Haiku sem chave (config.json > haiku > apiKey)');
  const msgs = mensagens.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content && m.content.length);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift(); // a conversa tem de começar pelo usuário
  if (!msgs.length) throw new Error('Haiku: conversa vazia');
  const r = await client(h).messages.create({
    model: h.modelo,
    max_tokens: Math.min(16000, Math.max(maxTokens, 2000) + 4000), // folga para o raciocínio, que conta no limite
    output_config: { effort: h.esforco },
    ...(sistema ? { system: sistema } : {}),
    messages: msgs,
  });
  if (r.stop_reason === 'refusal') throw new Error('Haiku recusou o pedido');
  const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!texto) throw new Error('Haiku respondeu vazio (' + r.stop_reason + ')');
  return texto;
}

// Pergunta única, com os quadros do vídeo (JPEG em base64) quando houver
function perguntar({ cfg, sistema, texto, quadros = [], maxTokens = 4000 }) {
  const content = [];
  for (const q of quadros) { content.push({ type: 'text', text: `t=${q.t}s` }); content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: q.b64 } }); }
  content.push({ type: 'text', text: texto });
  return conversar({ cfg, sistema, mensagens: [{ role: 'user', content }], maxTokens });
}

module.exports = { config, conversar, perguntar };

// Teste rápido: node haiku.js
if (require.main === module) {
  const h = config();
  if (!h.pronto) { console.log('Haiku DESLIGADO (config.json > haiku). Até lá a Niobe usa os modelos gratuitos.'); process.exit(0); }
  console.log('Modo: ' + (h.assinatura ? 'assinatura do Claude (Claude Code)' : 'chave de API'));
  const t0 = Date.now();
  perguntar({ sistema: 'Responda em português, em uma linha.', texto: 'Diga "Haiku 5.5 pronto para a Niobe" e nada mais.' })
    .then(t => console.log(`OK (${h.modelo}, ${((Date.now() - t0) / 1000).toFixed(1)}s): ${t}`), e => { console.log('ERRO no Haiku: ' + e.message); process.exit(1); });
}
