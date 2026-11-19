// CENTRAL DE AGENTES do Maike — painel para ver, ligar, desligar e monitorar os agentes,
// e runtime "custom" do Hermes3D (GET /health /state /registry, POST /v1/chat/completions).
// Sem dependências: só Node 18+.
const http = require('http'), fs = require('fs'), path = require('path'), net = require('net');
const { spawn, execFile } = require('child_process');

const DIR = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(DIR, 'agentes.json'), 'utf8'));
const ESTADO_ARQ = path.join(DIR, 'estado.json');
const WIN = process.platform === 'win32';
const abs = p => path.resolve(DIR, p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || ''));
let estado = { ativos: {} };
try { estado = JSON.parse(fs.readFileSync(ESTADO_ARQ, 'utf8')); } catch {}
const salvarEstado = () => fs.writeFileSync(ESTADO_ARQ, JSON.stringify(estado, null, 1));
const noEscritorio = id => estado.ativos[id] !== false;

// ---------- Os 30 especialistas da Niobe ----------
const AREAS = { 'Pré-produção': '#FF5A5F', 'Montagem': '#FFB400', 'Motion': '#7B61FF', 'Cor': '#00C2A8', 'Áudio': '#00A3FF', 'Entrega': '#FF7AC6' };
const ESPEC = [
  ['Triador', 'Pré-produção'], ['Transcritor', 'Pré-produção'], ['Analista', 'Pré-produção'], ['Roteirista', 'Pré-produção'], ['Ganchos', 'Pré-produção'], ['Copywriter', 'Pré-produção'],
  ['Montador', 'Montagem'], ['Cortador de silêncio', 'Montagem'], ['Removedor de erros', 'Montagem'], ['Ritmista', 'Montagem'], ['B-roll', 'Montagem'], ['Reenquadrador', 'Montagem'], ['Velocidade', 'Montagem'],
  ['Motion designer', 'Motion'], ['Zoom dinâmico', 'Motion'], ['Tipógrafo', 'Motion'], ['Legendista', 'Motion'], ['Transições', 'Motion'], ['Efeitos', 'Motion'], ['Marca', 'Motion'],
  ['Colorista técnico', 'Cor'], ['Colorista criativo', 'Cor'], ['Consistência de cor', 'Cor'],
  ['Engenheiro de voz', 'Áudio'], ['Trilha', 'Áudio'], ['Sound designer', 'Áudio'], ['Mixador', 'Áudio'],
  ['Revisor', 'Entrega'], ['Exportador', 'Entrega'], ['Versionador', 'Entrega'],
].map(([nome, area], i) => ({ id: 'agent-' + String(i + 1).padStart(2, '0'), nome, area, cor: AREAS[area], ultima: null, quando: 0 }));
const REGRAS = [
  ['Import sfx', 'Sound designer', 'importou efeito sonoro'], ['Import', 'Triador', 'importou mídia'], ['Transcri', 'Transcritor', 'transcreveu a fala'],
  ['Filler', 'Removedor de erros', 'removeu vícios de linguagem'], ['Pause', 'Cortador de silêncio', 'cortou pausas'], ['Caption', 'Legendista', 'gerou legendas'],
  ['Character Style', 'Legendista', 'destacou palavra-chave'], ['New Graphic', 'Tipógrafo', 'criou texto na tela'], ['Text', 'Tipógrafo', 'editou texto'],
  ['Graphic', 'Marca', 'ajustou estilo do texto'], ['Whip', 'Transições', 'transição whip'], ['Zoom Blur', 'Transições', 'transição zoom blur'],
  ['Flash', 'Transições', 'transição flash'], ['Dissolve', 'Transições', 'cross dissolve'], ['Lumetri', 'Colorista criativo', 'look de cor'],
  ['Color', 'Colorista técnico', 'correção de cor'], ['Apply', 'Efeitos', 'aplicou efeito'], ['Speed', 'Velocidade', 'mudou a velocidade'],
  ['Razor', 'Cortador de silêncio', 'corte com a navalha'], ['Add Edit', 'Cortador de silêncio', 'corte na timeline'], ['Delete', 'Ritmista', 'apertou o ritmo'],
  ['Lift', 'Ritmista', 'retirou trecho'], ['Extract', 'Ritmista', 'retirou trecho'], ['Place Clip', 'Montador', 'colocou clipe na timeline'],
  ['Effect Parameter', 'Zoom dinâmico', 'zoom / enquadramento'], ['Keyframe', 'Motion designer', 'keyframe de movimento'], ['Volume', 'Mixador', 'ajustou volume'],
  ['Gain', 'Engenheiro de voz', 'ajustou ganho'], ['Track', 'Mixador', 'ajustou faixa'], ['Sequence', 'Montador', 'criou sequência'], ['', 'Revisor', ''],
];
const atividade = []; // feed geral
function registrar(agente, quem, txt, cor) {
  atividade.unshift({ t: Date.now(), agente, quem, txt, cor });
  if (atividade.length > 60) atividade.pop();
}

// ---------- Leitura do histórico do FilmCraft (modo ponte) ----------
let fcPrev = -1, fcOnline = false;
function tokenFilmCraft() {
  try { return fs.readFileSync(abs('../agente-niobe/projetos/.token'), 'utf8').trim(); } catch { return process.env.FILMCRAFT_CONTROL_TOKEN || ''; }
}
function historicoFilmCraft() {
  return new Promise(res => {
    const s = net.connect(9876, '127.0.0.1'); let buf = ''; const fim = v => { s.destroy(); res(v); };
    s.setTimeout(1500, () => fim(null)); s.on('error', () => fim(null));
    s.on('connect', () => s.write(JSON.stringify({ id: 1, token: tokenFilmCraft(), method: 'engine.execute', params: { command: 'history.list' } }) + '\n'));
    s.on('data', d => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { try { const r = JSON.parse(buf.slice(0, i)); fim(r.result?.undo || r.result?.result?.undo || r.undo || null); } catch { fim(null); } } });
  });
}
async function vigiarFilmCraft() {
  const u = await historicoFilmCraft();
  fcOnline = Array.isArray(u);
  if (!fcOnline) return;
  if (fcPrev < 0 || u.length < fcPrev) { fcPrev = u.length; return; }
  for (let j = fcPrev; j < u.length; j++) {
    const lab = String(u[j]);
    const r = REGRAS.find(([k]) => lab.includes(k));
    const e = ESPEC.find(x => x.nome === r[1]);
    e.ultima = r[2] || lab; e.quando = Date.now();
    registrar('Niobe', e.nome, e.ultima, e.cor);
  }
  fcPrev = u.length;
}
setInterval(vigiarFilmCraft, 1000);

// ---------- Caixa de pedidos da Niobe: o Claude (diretor) deixa um .json em agente-niobe\\pedidos e a Central executa no PC ----------
function vigiarPedidos() {
  try {
    const base = abs('../agente-niobe'), pasta = path.join(base, 'pedidos'), rod = path.join(pasta, 'rodando');
    fs.mkdirSync(rod, { recursive: true });
    for (const f of fs.readdirSync(pasta).filter(f => /\.json$/i.test(f))) {
      const dest = path.join(rod, f); try { fs.renameSync(path.join(pasta, f), dest); } catch { continue; }
      registrar('niobe', 'Niobe', 'pedido do diretor: ' + f);
      const filho = spawn(process.execPath, ['pedidos.js', dest], { cwd: base, windowsHide: true, stdio: 'ignore' });
      filho.on('exit', c => registrar('niobe', 'Niobe', (c === 0 ? 'terminou o pedido ' : 'erro no pedido ') + f));
      filho.on('error', () => {});
    }
  } catch {}
}
setInterval(vigiarPedidos, 1500);

// ---------- Processos do Windows ----------
let procs = [];
function lerProcessos() {
  if (!WIN) return;
  execFile('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'cmd.exe','node.exe','filmcraft.exe','freellmapi.exe','powershell.exe' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true, maxBuffer: 8e6 }, (err, out) => {
    if (err) return;
    try { const j = JSON.parse(out || '[]'); procs = Array.isArray(j) ? j : [j]; } catch {}
  });
}
setInterval(lerProcessos, 3000); lerProcessos();
const acharProc = fn => procs.find(p => fn(String(p.Name || '').toLowerCase(), String(p.CommandLine || '').toLowerCase()));
const portaAberta = porta => new Promise(res => { const s = net.connect(porta, '127.0.0.1'); s.setTimeout(600, () => { s.destroy(); res(false); }); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
const matar = pid => WIN && spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
function abrirBat(pasta, bat, titulo) {
  const p = abs(pasta);
  spawn('cmd', ['/c', 'start', `"${titulo || bat}"`, 'cmd', '/c', path.join(p, bat)], { cwd: p, detached: true, windowsHide: true, shell: false }).unref();
}

// Bibliotecas de agentes (tipo "agencia"): cada subpasta é uma divisão; "divisoes" no agentes.json limita quais entram.
const divisaoValida = (a, d) => d.isDirectory() && !d.name.startsWith('.') && !['scripts', 'examples', 'integrations'].includes(d.name) && (!a.divisoes || a.divisoes.includes(d.name));

async function statusAgente(a) {
  const base = { id: a.id, nome: a.nome, emoji: a.emoji, descricao: a.descricao, tipo: a.tipo, noEscritorio: noEscritorio(a.id), controlavel: a.tipo !== 'skill' };
  if (a.tipo === 'processo') {
    const pasta = abs(a.pasta).toLowerCase();
    const p = acharProc((n, c) => n === 'cmd.exe' && c.includes(pasta.split(path.sep).pop()) && c.includes(a.iniciar.toLowerCase()));
    let ultimoLog = null;
    try { ultimoLog = fs.statSync(abs(a.log)).mtimeMs; } catch {}
    return { ...base, rodando: !!p, pid: p?.ProcessId, detalhe: ultimoLog ? 'última atividade ' + new Date(ultimoLog).toLocaleString('pt-BR') : '', funcionarios: (a.funcionarios || []).map(f => ({ ...f, status: p ? 'ativo' : 'parado' })) };
  }
  if (a.tipo === 'niobe') {
    const fc = acharProc(n => n === 'filmcraft.exe');
    let overlay = false;
    try { const pid = +fs.readFileSync(abs('../agente-niobe/ao-vivo/overlay.pid'), 'utf8').trim(); overlay = !!procs.find(p => p.ProcessId === pid); } catch {}
    const agora = Date.now();
    return {
      ...base, rodando: !!fc && (fcOnline || !WIN), detalhe: `FilmCraft ${fc ? (fcOnline ? 'aberto (modo Niobe)' : 'aberto, sem modo Niobe') : 'fechado'} · camada dos agentes ${overlay ? 'ligada' : 'desligada'}`,
      funcionarios: ESPEC.map(e => ({ id: e.id, nome: e.nome, funcao: e.area, cor: e.cor, status: agora - e.quando < 8000 ? 'trabalhando' : (fc ? 'ativo' : 'parado'), ultima: e.ultima, quando: e.quando })),
    };
  }
  if (a.tipo === 'servico') {
    const ok = await portaAberta(a.portaTeste);
    return { ...base, rodando: ok, detalhe: ok ? 'respondendo na porta ' + a.portaTeste : 'não está respondendo' };
  }
  if (a.tipo === 'agencia') {
    const raiz = abs(a.pasta); const funcs = [];
    try {
      for (const d of fs.readdirSync(raiz, { withFileTypes: true })) {
        if (!divisaoValida(a, d)) continue;
        for (const f of fs.readdirSync(path.join(raiz, d.name))) {
          if (!f.endsWith('.md')) continue;
          const t = fs.readFileSync(path.join(raiz, d.name, f), 'utf8').slice(0, 800);
          const nome = (t.match(/^name:\s*(.+)$/m) || [])[1]; if (!nome) continue;
          funcs.push({ nome: ((t.match(/^emoji:\s*(.+)$/m) || [])[1] || '') + ' ' + nome.trim(), funcao: d.name, status: 'ativo', arquivo: d.name + '/' + f, ultima: ((t.match(/^description:\s*(.+)$/m) || [])[1] || '').slice(0, 90) });
        }
      }
    } catch {}
    return { ...base, controlavel: false, rodando: funcs.length > 0, detalhe: funcs.length ? `${funcs.length} agentes em ${new Set(funcs.map(f => f.funcao)).size} divisões · ${a.comoUsar || 'use no Claude com /agencia'}` : (a.semPasta || 'pasta não encontrada: rode o ORGANIZAR-AGENTES.bat'), funcionarios: funcs };
  }
  return { ...base, rodando: true, detalhe: 'disponível no chat do Claude (sob demanda)', funcionarios: (a.funcionarios || []).map(f => ({ ...f, status: 'ativo' })) };
}

async function ligar(a) {
  if (a.tipo === 'processo' || a.tipo === 'niobe') abrirBat(a.pasta, a.iniciar, a.titulo);
  if (a.tipo === 'servico') spawn(abs(a.exe), [], { detached: true, windowsHide: false }).unref();
  registrar(a.nome, 'Central', 'ligado pelo painel', '#22c55e');
}
async function desligar(a) {
  const s = await statusAgente(a);
  if (a.tipo === 'processo' && s.pid) matar(s.pid);
  if (a.tipo === 'niobe') {
    try { fs.appendFileSync(abs('../agente-niobe/ao-vivo/eventos.jsonl'), '{"fim":true}\n'); } catch {}
  }
  if (a.tipo === 'servico') { const p = acharProc(n => n === a.processo); if (p) matar(p.ProcessId); }
  registrar(a.nome, 'Central', 'desligado pelo painel', '#ef4444');
}
function tailLog(a, linhas = 120) {
  try { const t = fs.readFileSync(abs(a.log), 'utf8'); return t.split(/\r?\n/).slice(-linhas).join('\n'); } catch { return '(sem log)'; }
}

// ---------- Runtime do Hermes3D ----------
function freeCfg() {
  try { const c = JSON.parse(fs.readFileSync(abs(CFG.freellmapi.configMorfeus), 'utf8')); return { baseUrl: CFG.freellmapi.baseUrl, apiKey: (c.llmReserva || {}).apiKey || c.llm.apiKey }; } catch { return { baseUrl: CFG.freellmapi.baseUrl, apiKey: '' }; }
}
function idsEscritorio() {
  const ids = {};
  for (const a of CFG.agentes) {
    if (!noEscritorio(a.id)) continue;
    ids[a.id] = 'auto';
    if (a.id === 'niobe') for (const e of ESPEC) if (noEscritorio('niobe-' + e.id)) ids['niobe-' + e.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '-')] = 'auto';
    if (a.tipo === 'agencia') { try { for (const d of fs.readdirSync(abs(a.pasta), { withFileTypes: true })) if (divisaoValida(a, d)) ids[a.id + '-' + d.name] = 'auto'; } catch {} }
    if (a.funcionarios) for (const f of a.funcionarios) ids[a.id + '-' + f.nome.normalize('NFD').replace(/[̀-ͯ()]/g, '').toLowerCase().replace(/\s+/g, '-')] = 'auto';
  }
  return ids;
}
// Cada agente do escritório responde com a própria função, usando só o FreeLLMAPI (sem tokens do Claude).
const BASE_EQUIPE = 'Você trabalha na equipe de agentes de IA do Maike (marketing, CRM, edição de vídeo e segurança). Responda em português do Brasil. ENTREGUE o trabalho pedido completo e pronto para usar, sem pedir confirmação e sem prometer fazer depois. Você só produz texto: se o pedido exigir mexer em arquivos, programas ou contas, entregue o passo a passo e avise em uma linha que essa parte precisa ser executada no Claude. Nunca peça nem repita senhas, chaves ou dados de pacientes.';
const lerTexto = (...arqs) => { for (const f of arqs) { try { return fs.readFileSync(abs(f), 'utf8').slice(0, 9000); } catch {} } return ''; };
const slug = t => t.normalize('NFD').replace(/[̀-ͯ()]/g, '').toLowerCase().replace(/\s+/g, '-');
function personaDe(body) {
  const chave = [body.role, body.lane, body.conversation_id, body.session_id].filter(Boolean).join(' ').toLowerCase();
  const id = Object.keys(idsEscritorio()).sort((x, y) => y.length - x.length).find(k => chave.includes(k)) || 'equipe';
  let quem = 'um membro da equipe', extra = '';
  if (id === 'smith') { quem = 'o Agente Smith, consultor sênior de segurança defensiva'; extra = lerTexto('../agente-smith/AGENTE-SMITH.md', '../smith/AGENTE-SMITH.md') + '\nAqui no escritório você não tem acesso aos arquivos: oriente, explique e escreva checklists e políticas. Auditoria e correção de verdade são feitas pelo comando /agente-smith no Claude.'; }
  else if (id === 'unidade') quem = 'a Unidade, o cérebro central da estrutura de agentes do Maike, que une o Kimi K3 e o Mistral Large numa IA só e atende qualquer pedido de raciocínio, estratégia, análise ou texto';
  else if (id === 'neo') quem = 'o Neo, especialista em CRM GoHighLevel (workflows, pipelines, tags, mensagens) e diretor de motion design sênior (roteiros, storyboards, direção de arte)';
  else if (id === 'niobe') { quem = 'a Niobe, diretora de edição de vídeo (Reels, criativos de anúncio, motion)'; extra = 'Sua equipe: ' + ESPEC.map(e => e.nome).join(', ') + '. Entregue roteiros de corte, ganchos, legendas e planos de edição. Você EDITA VÍDEO aqui mesmo: o Maike diz a pasta (Downloads, Área de trabalho, Vídeos, entrada...) e o nome do vídeo, ou cola o caminho completo, junto com o que quer. Nunca mande ele abrir o Claude.'; }
  else if (id.startsWith('niobe-')) { const e = ESPEC.find(x => 'niobe-' + slug(x.nome) === id); quem = `o especialista "${e ? e.nome : id.slice(6)}" (${e ? e.area : 'vídeo'}) da equipe de edição de vídeo da Niobe`; }
  else if (id === 'morfeus') quem = 'o Morfeus, SDR e closer de WhatsApp que atende leads de marketing (tráfego pago, sites, CRM) e agenda reuniões; escreva scripts, respostas a objeções e sequências de follow-up';
  else if (id.startsWith('morfeus-')) quem = `o funcionário "${id.slice(8).replace(/-/g, ' ')}" da equipe de atendimento do Morfeus no WhatsApp`;
  else if (CFG.agentes.some(x => x.tipo === 'agencia' && (id === x.id || id.startsWith(x.id + '-')))) {
    const ag = CFG.agentes.find(x => x.tipo === 'agencia' && (id === x.id || id.startsWith(x.id + '-'))), div = id.slice(ag.id.length + 1);
    const casa = ag.id === 'agency' ? 'agência The Agency' : 'biblioteca ' + ag.nome;
    quem = div ? `o líder da divisão "${div}" da ${casa}` : `o diretor da ${casa}, que distribui o trabalho entre as divisões`;
    try { if (ag && div) extra = 'Especialistas da sua divisão: ' + fs.readdirSync(abs(ag.pasta + '/' + div)).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).slice(0, 60).join(', ') + '. Responda como o especialista mais adequado e diga qual foi.'; } catch {}
  }
  return { id, sistema: `Você é ${quem}. ${BASE_EQUIPE}\n${extra}` };
}
// ---------- Execução de verdade pelo escritório (sem Claude) ----------
const VIDEO_EXT = /\.(mp4|mov|mkv|avi|webm|m4v|wmv)$/i;
let niobeOcupada = false;
function pastaNiobe() { const a = CFG.agentes.find(x => x.id === 'niobe'); return abs((a && a.pasta) || '../agente-niobe'); }
const semAcento = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const limpaNome = t => semAcento(t).replace(VIDEO_EXT, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
// Pastas que o Maike pode citar pelo nome ("Pasta: Downloads") ou pelo caminho completo
function pastasCitadas(texto) {
  const H = require('os').homedir(), t = semAcento(texto), r = [];
  const mapa = [
    [/\bdownloads?\b/, ['Downloads']],
    [/area de trabalho|\bdesktop\b/, ['Desktop', 'OneDrive/Desktop', 'OneDrive/Área de Trabalho']],
    [/meus videos/, ['Documents/Meus Vídeos']],
    [/pasta\s*:?\s*(de\s+)?videos\b|\bvideos do (pc|windows)\b/, ['Videos']],
    [/pasta\s*:?\s*(de\s+)?documentos|\bdocuments?\b/, ['Documents']],
    [/\bentrada\b/, [path.relative(H, path.join(pastaNiobe(), 'entrada'))]],
  ];
  for (const [re, rels] of mapa) if (re.test(t)) for (const rel of rels) r.push(path.resolve(H, rel));
  const m = texto.match(/([A-Za-z]:\\[^\n"]*?)(?=\s*(?:,|;|$|\s+v[ií]deo\s*:))/m);
  if (m) r.unshift(m[1].trim());
  return [...new Set(r)].filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}
function videosEm(dir, prof = 2) {
  const out = [];
  const andar = (d, n) => { let itens = []; try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of itens) { if (out.length > 400) return; const f = path.join(d, it.name);
      if (it.isFile() && VIDEO_EXT.test(it.name)) out.push(f); else if (it.isDirectory() && n > 0 && !/^(node_modules|\.|saida$|trabalho$)/.test(it.name)) andar(f, n - 1); } };
  andar(dir, prof); return out;
}
function acharVideo(texto) {
  // 1) caminho completo de um arquivo
  const m = texto.match(/"([^"]+\.(?:mp4|mov|mkv|avi|webm|m4v|wmv))"/i) || texto.match(/((?:[A-Za-z]:\\|\/)[^\n"]*?\.(?:mp4|mov|mkv|avi|webm|m4v|wmv))/i);
  if (m && fs.existsSync(m[1])) return { arq: m[1], resto: texto.replace(m[0], '').trim() };
  // 2) nome do vídeo ("Vídeo: Vídeo para editar") procurado nas pastas citadas, na entrada e nas pastas comuns
  const H = require('os').homedir(), citadas = pastasCitadas(texto);
  const padrao = [path.join(pastaNiobe(), 'entrada'), ...['Downloads', 'Videos', 'Desktop', 'Documents/Meus Vídeos', 'OneDrive/Desktop'].map(r => path.join(H, r))];
  const dica = (texto.match(/(?:v[ií]deo|arquivo|nome)\s*:\s*([^\n,;]+?)(?=\s+(?:pasta|pedido|quero|fa[cç]a)\s*:|$|[,;\n])/i) || [])[1];
  const alvo = dica ? limpaNome(dica) : '', todoTexto = limpaNome(texto);
  const bate = f => { const n = limpaNome(path.basename(f)); return n.length >= 3 && ((alvo && (n === alvo || n.includes(alvo) || alvo.includes(n))) || todoTexto.includes(n)); };
  for (const d of [...new Set([...citadas, ...padrao])]) {
    const vs = videosEm(d, citadas.includes(d) ? 2 : 1).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const achou = vs.find(f => alvo && limpaNome(path.basename(f)) === alvo) || vs.find(bate);
    if (achou) return { arq: achou, resto: texto };
  }
  // 3) pasta citada com um vídeo só: é ele
  for (const d of citadas) { const vs = videosEm(d, 1); if (vs.length === 1) return { arq: vs[0], resto: texto }; }
  // 4) não achou: lista o que existe (pasta citada primeiro)
  const lista = [];
  for (const d of (citadas.length ? citadas : padrao.slice(0, 2))) for (const f of videosEm(d, 1).slice(0, 8)) lista.push(`${path.basename(f)} (${path.basename(d)})`);
  return { lista, citadas, dica };
}
function editarVideo(arq, pedido) {
  // Modo ao vivo: abre o FilmCraft no modo ponte e a camada dos 30 agentes; espera a camada zerar o eventos.jsonl
  // A análise do vídeo começa na hora; o FilmCraft e a camada dos agentes abrem em paralelo (a Niobe espera a ponte antes de montar)
  if (WIN) { try { abrirBat('../agente-niobe', 'NIOBE-AO-VIVO.bat', 'Niobe ao vivo'); } catch {} }
  editarVideoJa(arq, pedido);
}
function editarVideoJa(arq, pedido) {
  niobeOcupada = true; registrar('niobe', 'Niobe', 'começou a editar ' + path.basename(arq));
  const filho = spawn(process.execPath, ['-e', "require('./niobe.js').editar(process.env.NIOBE_ARQ, process.env.NIOBE_PEDIDO).then(() => process.exit(0), e => { console.error(e.message); process.exit(1); })"],
    { cwd: pastaNiobe(), env: { ...process.env, NIOBE_ARQ: arq, NIOBE_PEDIDO: pedido }, windowsHide: true, stdio: 'ignore' });
  filho.on('exit', c => { niobeOcupada = false; registrar('niobe', 'Niobe', c === 0 ? 'terminou ' + path.basename(arq) + ' (pasta saida)' : 'deu erro em ' + path.basename(arq) + ' (veja niobe.log)'); });
  filho.on('error', () => { niobeOcupada = false; });
}
function acharNavegador() {
  const e = process.env, c = [[e.ProgramFiles, 'Google/Chrome/Application/chrome.exe'], [e['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'], [e.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'], [e['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'], [e.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe']];
  for (const [b, r] of c) { if (b) { const p = path.join(b, r); if (fs.existsSync(p)) return p; } } return null;
}
const PEDE_ARTE = /\b(arte|artes|post|banner|flyer|cartaz|card|carrossel|capa|thumbnail|criativo est[aá]tico)\b/i;
const SISTEMA_ARTE = 'Você é um diretor de arte sênior. Responda SOMENTE com um arquivo HTML completo (de <!DOCTYPE html> até </html>), sem explicações. Regras: a arte ocupa exatamente LARGURAxALTURA px (body com margin 0 e esse tamanho fixo, overflow hidden); todo o CSS dentro de <style>; nada de JavaScript; nada de imagens ou fontes externas (use fontes do sistema, gradientes, formas em CSS e ilustrações em SVG embutido); texto em português, pouco e grande, com hierarquia clara (título, apoio, chamada para ação); bom contraste; visual profissional e moderno.';
function gravarArte(id, html) {
  const pasta = path.join(DIR, 'entregas', id); fs.mkdirSync(pasta, { recursive: true });
  const base = path.join(pasta, 'arte-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
  fs.writeFileSync(base + '.html', html);
  return base;
}

// Quem pensa por quem: a Niobe e os 30 especialistas dela usam só o Haiku 5.5 (agente-niobe/haiku.js);
// os outros agentes usam a Unidade (Kimi K3 + Mistral Large numa IA só); o FreeLLMAPI direto fica de reserva.
async function pensar(id, sistema, msgs, maxTokens) {
  const daNiobe = id.startsWith('niobe');
  if (daNiobe) {
    try {
      const hk = require(path.join(pastaNiobe(), 'haiku.js'));
      if (hk.config().pronto) return { status: 200, texto: await hk.conversar({ sistema, mensagens: msgs.map(m => ({ role: m.role, content: String(m.content || '') })), maxTokens }) };
    } catch (e) { registrar('niobe', 'Niobe', 'Haiku falhou (' + String(e.message).slice(0, 60) + '); usando a reserva'); }
  }
  const { apiKey } = freeCfg(), u = CFG.unidade || {};
  const rotas = [...(u.baseUrl && !daNiobe ? [[u.baseUrl, u.modelo || 'unidade']] : []), [CFG.freellmapi.baseUrl, 'auto']];
  let ultimo = { status: 0, texto: '' };
  for (const [base, model] of rotas) {
    try {
      const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model, max_tokens: maxTokens, stream: false, messages: [{ role: 'system', content: sistema }, ...msgs] }) });
      let texto = ''; try { texto = JSON.parse(await r.text()).choices[0].message.content || ''; } catch {}
      ultimo = { status: r.status, texto };
      if (r.ok && texto) return ultimo;
    } catch {}
  }
  return ultimo;
}

async function chatHermes(body) {
  const { id, sistema } = personaDe(body);
  const msgs = (body.messages || []).filter(m => m && m.role !== 'system').slice(-20);
  const pedido = String((msgs.filter(m => m.role === 'user').pop() || {}).content || '');
  const responder = texto => ({ status: 200, text: JSON.stringify({ id: 'central-' + Date.now(), object: 'chat.completion', model: 'auto', choices: [{ index: 0, message: { role: 'assistant', content: texto }, finish_reason: 'stop' }] }) });
  // 0) Neo + "virais/referências" = estuda os vídeos da pasta referencias e atualiza o manual da Niobe
  if (id === 'neo' && /(viral|virais|refer[eê]ncia|estud|manual)/i.test(pedido)) {
    const pasta = pastaNiobe(), ref = path.join(pasta, 'referencias'); let lista = [];
    try { fs.mkdirSync(ref, { recursive: true }); lista = fs.readdirSync(ref).filter(f => VIDEO_EXT.test(f)); } catch {}
    if (!lista.length) return responder('Coloque os vídeos virais que você quer que eu estude na pasta agente-niobe\\referencias (Documentos) e me chame de novo. Eu meço o ritmo dos cortes, o gancho e as legendas e passo as lições para a Niobe.');
    const filho = spawn(process.execPath, ['neo-viral.js'], { cwd: pasta, windowsHide: true, stdio: 'ignore' });
    registrar('neo', 'Neo', `estudando ${lista.length} vídeo(s) viral(is)`);
    filho.on('exit', c => registrar('neo', 'Neo', c === 0 ? 'manual da Niobe atualizado (manual-profissional.json)' : 'não consegui estudar os virais (veja niobe.log)'));
    return responder(`Estudando ${lista.length} vídeo(s) da pasta referencias: ${lista.slice(0, 6).join(', ')}. Em menos de um minuto as lições entram no manual da Niobe, e ela já usa na próxima edição.`);
  }
  // 1) Niobe (ou alguém da equipe dela) + vídeo = edita de verdade com o programa da Niobe
  if (id.startsWith('niobe')) {
    const v = acharVideo(pedido);
    if (v.arq) {
      if (niobeOcupada) return responder('Ainda estou editando o vídeo anterior. Me mande este de novo quando eu avisar que terminei (veja a Atividade ao vivo da Central).');
      editarVideo(v.arq, v.resto);
      return responder(`Recebido: ${path.basename(v.arq)}. Minha equipe já está editando aqui no PC, sem usar o Claude. Leva cerca de um minuto. Vou abrir o FilmCraft com a camada dos agentes para você acompanhar ao vivo. Os vídeos prontos saem em agente-niobe\\saida e entram no FilmCraft no fim.`);
    }
    if (/\b(edit|reels|cort|legend|limp|v[ií]deo)/i.test(pedido) && !PEDE_ARTE.test(pedido)) {
      const onde = v.citadas && v.citadas.length ? v.citadas.map(d => path.basename(d)).join(', ') : 'entrada e Downloads';
      const naoAchei = v.dica ? `Não achei "${v.dica.trim()}" em ${onde}. ` : '';
      return responder(v.lista.length ? `${naoAchei}Vídeos que encontrei: ${v.lista.join(', ')}. Me diga qual (o nome basta, ex.: "Pasta: Downloads, Vídeo: ${path.parse(v.lista[0].replace(/ \([^)]*\)$/, '')).name}, 3 reels com legenda").` : `${naoAchei}Não encontrei vídeos em ${onde}. Me mande o caminho completo do arquivo (botão direito no vídeo > Copiar como caminho) e o que quer.`);
    }
  }
  // 2) Pedido de arte = gera o arquivo da arte e abre no navegador
  if (PEDE_ARTE.test(pedido)) {
    const quadrado = /\b(quadrad|1:1|feed quadrado)\b/i.test(pedido), deitado = /\b(16:9|horizontal|capa|thumbnail|banner)\b/i.test(pedido), story = /\b(story|stories|9:16|reels|vertical)\b/i.test(pedido);
    const [L, A] = quadrado ? [1080, 1080] : deitado ? [1280, 720] : story ? [1080, 1920] : [1080, 1350];
    try {
      const ra = await pensar(id, SISTEMA_ARTE.replace('LARGURAxALTURA', L + 'x' + A), msgs.slice(-6), 6000);
      if (ra.status === 429) return responder('A cota gratuita acabou neste momento. Tente de novo em alguns minutos.');
      let html = ra.texto;
      const ini = html.search(/<!DOCTYPE html|<html/i), fim = html.toLowerCase().lastIndexOf('</html>');
      if (ini >= 0 && fim > ini) {
        html = html.slice(ini, fim + 7).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
        const base = gravarArte(id, html), nav = acharNavegador();
        let png = false;
        if (nav) { try { await new Promise((ok, ruim) => execFile(nav, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${L},${A}`, '--screenshot=' + base + '.png', 'file:///' + (base + '.html').replace(/\\/g, '/')], { timeout: 40000, windowsHide: true }, e => e ? ruim(e) : ok())); png = fs.existsSync(base + '.png'); } catch {} }
        if (WIN) spawn('cmd', ['/c', 'start', '""', png ? base + '.png' : base + '.html'], { detached: true, windowsHide: true }).unref();
        registrar(id.split('-')[0], id, 'entregou uma arte: ' + pedido.slice(0, 50));
        return responder(`Arte pronta (${L}x${A}) e aberta na sua tela. Arquivo: central-agentes\\entregas\\${id}\\${path.basename(base)}${png ? '.png (imagem) e .html (editável)' : '.html'}. Quer ajuste? Diga o que mudar (cor, texto, estilo) que eu refaço.`);
      }
    } catch {}
    // se a arte falhar, segue e responde em texto
  }
  const r = await pensar(id, sistema, msgs, Math.max(Number(body.max_tokens) || 0, 2000));
  if (!r.status) return responder('A Unidade e o FreeLLMAPI não responderam. Abra o app FreeLLMAPI no PC e mande de novo.');
  if (r.status === 429) return responder('A cota gratuita acabou neste momento. Tente de novo em alguns minutos.');
  const resposta = r.texto;
  if (r.status !== 200 || !resposta) return responder('Não consegui responder agora (erro ' + r.status + '). Tente de novo.');
  try { // guarda a entrega em arquivo e mostra na atividade ao vivo
    const pasta = path.join(DIR, 'entregas', id); fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.md'), `# Pedido\n\n${pedido}\n\n# Entrega (${id})\n\n${resposta}\n`);
    registrar(id.split('-')[0], id, 'entregou: ' + pedido.slice(0, 60));
  } catch {}
  return responder(resposta);
}

// ---------- Servidor ----------
const lerCorpo = req => new Promise(res => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); });
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };

const servidor = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }
    if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(DIR, 'painel.html'))); }
    if (p === '/prospeccao' || p === '/api/prospeccao') return require('./prospeccao-painel').tratar(req, res, p, { lerCorpo, json }); // painel da prospecção de sites
    if (p === '/api/agentes') return json(res, { agentes: await Promise.all(CFG.agentes.map(statusAgente)), atividade, areas: AREAS });
    let m = p.match(/^\/api\/agentes\/([\w-]+)\/(ligar|desligar|escritorio|log)$/);
    if (m) {
      const a = CFG.agentes.find(x => x.id === m[1]); if (!a) return json(res, { erro: 'agente não existe' }, 404);
      if (m[2] === 'log') return json(res, { log: tailLog(a) });
      if (m[2] === 'escritorio') { estado.ativos[a.id] = !noEscritorio(a.id); salvarEstado(); return json(res, { noEscritorio: noEscritorio(a.id) }); }
      if (req.method !== 'POST') return json(res, { erro: 'use POST' }, 405);
      if (a.tipo === 'skill') return json(res, { erro: 'skills rodam no Claude, não dá para ligar daqui' }, 400);
      await (m[2] === 'ligar' ? ligar(a) : desligar(a));
      return json(res, { ok: true });
    }
    // Hermes3D (runtime custom)
    if (p === '/health') return json(res, { ok: true, status: 'ok' });
    if (p === '/state') return json(res, { profileName: 'central-maike', runtime: { name: 'Central de Agentes do Maike', version: '1.0', vendor: 'Maike', status: 'online', active_model: 'auto' }, active: idsEscritorio() });
    if (p === '/registry') return json(res, { models: { auto: { via: 'FreeLLMAPI' } } });
    if (p === '/v1/chat/completions' && req.method === 'POST') {
      const r = await chatHermes(await lerCorpo(req));
      res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(r.text);
    }
    json(res, { erro: 'não encontrado' }, 404);
  } catch (e) { json(res, { erro: String(e.message || e) }, 500); }
};
http.createServer(servidor).listen(CFG.porta, '127.0.0.1', () => console.log(`Central de Agentes em http://localhost:${CFG.porta}  (Hermes3D: Custom com esta URL)`));
// também em IPv6 (::1): o Hermes3D resolve "localhost" assim
http.createServer(servidor).on('error', () => {}).listen(CFG.porta, '::1');
