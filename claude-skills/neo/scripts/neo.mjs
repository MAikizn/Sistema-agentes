#!/usr/bin/env node
// Neo: orquestra tarefas entre o Claude e o FreeLLMAPI e mostra o resultado na tela do Neo.
//
// Uso:
//   node neo.mjs "prompt" [--file caminho ...] [--out caminho] [--system texto] [--title texto]
//                         [--model auto] [--max-tokens n] [--preview n] [--no-ui]
//   node neo.mjs painel [--no-ui]
//   node neo.mjs show --md caminho.md [--prompt "pedido do usuario"] [--title texto] [--model Claude]
//
// A conversa fica em ~/.claude/neo/conversa.json; --new comeca uma conversa nova.
//
// --file   anexa o conteudo do arquivo ao prompt (o Claude nao precisa colar o texto)
// --out    salva a resposta completa no arquivo e imprime so um resumo curto
// --no-ui  nao abre a janela do Neo
// Chave: variavel FREELLMAPI_API_KEY. URL: FREELLMAPI_BASE_URL (padrao http://127.0.0.1:31415/v1)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_FILE_CHARS = 400_000;
const HERE = dirname(fileURLToPath(import.meta.url));
const NEO_HOME = join(homedir(), '.claude', 'neo');
const HISTORY_FILE = join(NEO_HOME, 'conversa.json');
const HISTORY_SENT = 12; // mensagens anteriores enviadas ao modelo
const HISTORY_KEPT = 40;
const NEO_SYSTEM = 'Voce e o Neo, um assistente de IA. A pessoa que esta conversando com voce se chama Maike; '
  + 'quando ela fala "eu", "meu" ou "minha", esta falando de si mesma, nao de voce. '
  + 'Responda sempre em portugues do Brasil, de forma direta, pratica e bem formatada em markdown '
  + '(titulos curtos, listas, tabelas quando ajudar). Use o historico da conversa para manter o contexto.';
let opts;

function loadHistory() {
  if (opts.newChat) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(history, userText, answer) {
  history.push({ role: 'user', content: userText }, { role: 'assistant', content: answer });
  mkdirSync(NEO_HOME, { recursive: true });
  writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-HISTORY_KEPT), null, 1), 'utf8');
  return history;
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' [...]' : s);

function parseArgs(argv) {
  const opts = { files: [], model: 'auto', preview: 600, ui: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`faltou valor para ${a}`);
      return argv[++i];
    };
    if (a === '--file') opts.files.push(next());
    else if (a === '--out') opts.out = next();
    else if (a === '--system') opts.system = next();
    else if (a === '--model') opts.model = next();
    else if (a === '--title') opts.title = next();
    else if (a === '--md') opts.md = next();
    else if (a === '--prompt') opts.userPrompt = next();
    else if (a === '--new') opts.newChat = true;
    else if (a === '--max-tokens') opts.maxTokens = Number(next());
    else if (a === '--preview') opts.preview = Number(next());
    else if (a === '--no-ui') opts.ui = false;
    else rest.push(a);
  }
  if (rest[0] === 'painel' || rest[0] === 'show') opts.cmd = rest.shift();
  else opts.cmd = 'ask';
  opts.prompt = rest.join(' ').trim();
  return opts;
}

function fail(msg) {
  console.error(`NEO ERRO: ${msg}`);
  if (opts?.ui) openUi({ mode: 'error', title: 'Neo encontrou um problema', markdown: msg });
  process.exit(1);
}

// ---------- tela do Neo ----------

function findEdge() {
  const candidates = [
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find(existsSync);
}

function openUi(data) {
  try {
    const tpl = readFileSync(join(HERE, 'neo-ui.html'), 'utf8');
    const json = JSON.stringify({ ...data, at: new Date().toISOString() }).replace(/</g, '\\u003c');
    const html = tpl.replace('"__NEO_DATA__"', () => json);
    mkdirSync(NEO_HOME, { recursive: true });
    const file = join(NEO_HOME, 'neo.html');
    writeFileSync(file, html, 'utf8');
    const url = pathToFileURL(file).href;
    const edge = findEdge();
    const child = edge
      ? spawn(edge, [`--app=${url}`, '--window-size=1180,860'], { detached: true, stdio: 'ignore' })
      : spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsVerbatimArguments: false });
    child.unref();
    return file;
  } catch (e) {
    console.error(`NEO AVISO: nao consegui abrir a tela (${e.message})`);
  }
}

// ---------- FreeLLMAPI ----------

// Apps abertos antes de a variavel ser criada nao a herdam; nesse caso le direto do registro do usuario.
function userEnv(name) {
  if (process.env[name]) return process.env[name];
  if (process.platform !== 'win32') return undefined;
  const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8' });
  const m = r.stdout && r.stdout.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`));
  return m ? m[1].trim() : undefined;
}

const key = userEnv('FREELLMAPI_API_KEY');
const baseUrl = (process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:31415/v1').replace(/\/$/, '');
const mcpUrl = baseUrl.replace(/\/v1$/, '') + '/mcp';

function requireKey() {
  if (!key) fail('variavel FREELLMAPI_API_KEY nao definida (reinicie o app/terminal depois de configurar).');
}

async function post(url, body) {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    fail(`FreeLLMAPI inacessivel em ${url} (o app esta aberto?): ${e.message}`);
  }
}

let rpcId = 0;
async function mcpTool(name, args = {}) {
  const res = await post(mcpUrl, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } });
  let raw = await res.text();
  if (!res.ok) fail(`MCP ${name}: HTTP ${res.status} ${raw.slice(0, 300)}`);
  if (/^\s*(event|data):/.test(raw)) {
    raw = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('');
  }
  const msg = JSON.parse(raw);
  if (msg.error) fail(`MCP ${name}: ${msg.error.message}`);
  const r = msg.result || {};
  if (r.structuredContent) return r.structuredContent;
  try {
    return JSON.parse(r.content?.[0]?.text ?? '{}');
  } catch {
    return {};
  }
}

async function painel() {
  requireKey();
  await post(mcpUrl, { jsonrpc: '2.0', id: ++rpcId, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'neo', version: '1' } } });
  const [health, providers, quota, routing] = await Promise.all(
    ['healthcheck', 'provider_health', 'quota_outlook', 'routing_info'].map(t => mcpTool(t)),
  );
  const lines = Object.entries(providers).map(([n, p]) =>
    `  ${n}: chaves=${JSON.stringify(p.keys)} modelos=${p.available_models} cooldowns=${p.active_cooldowns}`);
  console.log(`NEO OK painel status=${health.status} provedores=${health.healthy_providers}/${health.configured_providers} modelos=${health.available_models} roteamento=${routing.strategy}\n${lines.join('\n')}`);
  if (opts.ui) openUi({ mode: 'panel', health, providers, quota, routing });
}

function show() {
  if (!opts.md) fail('informe --md com o arquivo markdown a exibir.');
  let text;
  try {
    text = readFileSync(resolve(opts.md), 'utf8');
  } catch (e) {
    fail(`nao consegui ler ${opts.md}: ${e.message}`);
  }
  const model = opts.model === 'auto' ? 'Claude' : opts.model;
  let history = loadHistory();
  if (opts.userPrompt) history = saveHistory(history, opts.userPrompt, text);
  openUi({
    mode: 'answer', title: opts.title || basename(opts.md), markdown: text, route: 'Claude', model,
    savedTo: resolve(opts.md), thread: history.slice(-8, -1),
  });
  console.log(`NEO OK tela aberta para ${resolve(opts.md)}`);
}

async function ask() {
  if (!opts.prompt) fail('informe o prompt. Ex.: node neo.mjs "resuma" --file README.md');
  requireKey();

  let content = opts.prompt;
  for (const f of opts.files) {
    let text;
    try {
      text = readFileSync(resolve(f), 'utf8');
    } catch (e) {
      fail(`nao consegui ler ${f}: ${e.message}`);
    }
    if (text.length > MAX_FILE_CHARS) fail(`${f} tem ${text.length} caracteres (limite ${MAX_FILE_CHARS}). Divida em partes.`);
    content += `\n\n--- arquivo: ${basename(f)} ---\n${text}`;
  }

  let history = loadHistory();
  const messages = [{ role: 'system', content: opts.system ? `${NEO_SYSTEM}\n\n${opts.system}` : NEO_SYSTEM }];
  for (const m of history.slice(-HISTORY_SENT)) messages.push({ role: m.role, content: clip(m.content, 4000) });
  messages.push({ role: 'user', content });
  const body = { model: opts.model, messages };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const started = Date.now();
  const res = await post(`${baseUrl}/chat/completions`, body);
  const ms = Date.now() - started;
  const raw = await res.text();
  if (!res.ok) fail(`HTTP ${res.status}: ${raw.slice(0, 800)}`);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    fail(`resposta invalida: ${raw.slice(0, 300)}`);
  }
  const answer = data.choices?.[0]?.message?.content ?? '';
  const u = data.usage || {};
  const meta = `modelo=${data.model || '?'} tempo=${ms}ms tokens_in=${u.prompt_tokens ?? '?'} tokens_out=${u.completion_tokens ?? '?'}`;

  let savedTo;
  if (opts.out) {
    savedTo = resolve(opts.out);
    mkdirSync(dirname(savedTo), { recursive: true });
    writeFileSync(savedTo, answer, 'utf8');
    const preview = answer.length > opts.preview ? answer.slice(0, opts.preview) + ' [...]' : answer;
    console.log(`NEO OK ${meta} chars=${answer.length} salvo=${savedTo}\n--- previa ---\n${preview}`);
  } else {
    console.log(`NEO OK ${meta}\n---\n${answer}`);
  }

  const fileNote = opts.files.length ? `\n\n(anexos: ${opts.files.map(f => basename(f)).join(', ')})` : '';
  history = saveHistory(history, opts.prompt + fileNote, answer);

  if (opts.ui) {
    openUi({
      mode: 'answer', title: opts.title || opts.prompt.slice(0, 90), markdown: answer, route: 'FreeLLMAPI',
      model: data.model, ms, tokensIn: u.prompt_tokens, tokensOut: u.completion_tokens, savedTo,
      thread: history.slice(-8, -1),
    });
  }
}

opts = parseArgs(process.argv.slice(2));
if (opts.cmd === 'painel') await painel();
else if (opts.cmd === 'show') show();
else await ask();
