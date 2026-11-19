// Orquestrador dos workers Codex (credito do ChatGPT via `codex exec`).
// O Codex roda em sandbox somente-leitura e so gera texto; este script grava os arquivos.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = __dirname;
const PROJ = path.dirname(DIR);
const CODEX = path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
const LOGS = path.join(DIR, 'logs');
fs.mkdirSync(LOGS, { recursive: true });

const ler = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const log = (m) => {
  const l = `${new Date().toTimeString().slice(0, 8)} ${m}`;
  console.log(l);
  fs.appendFileSync(path.join(DIR, 'orquestrador.log'), l + '\n');
};

const SEM_FERRAMENTAS = '\n\nIMPORTANTE: NÃO execute comandos nem tente ler ou gravar arquivos (o ambiente é somente leitura). Todo o contexto necessário está nesta mensagem. Sua resposta final deve ser APENAS o conteúdo pedido, sem comentários antes ou depois.';

let seq = 0;
function codex(nome, prompt, { search = false, timeoutMin = 25 } = {}) {
  return new Promise((resolve) => {
    const out = path.join(os.tmpdir(), `codex-${process.pid}-${++seq}.txt`);
    const args = [CODEX, 'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-C', PROJ, '-o', out];
    if (search) args.push('-c', 'web_search="live"');
    args.push('-');
    const p = spawn(process.execPath, args, { cwd: PROJ });
    const logf = fs.createWriteStream(path.join(LOGS, `${nome}.log`), { flags: 'a' });
    p.stdout.pipe(logf); p.stderr.pipe(logf);
    const t = setTimeout(() => { log(`${nome}: timeout, matando`); p.kill(); }, timeoutMin * 60000);
    p.on('close', (code) => {
      clearTimeout(t);
      let txt = '';
      try { txt = fs.readFileSync(out, 'utf8'); fs.unlinkSync(out); } catch {}
      resolve({ code, txt });
    });
    p.stdin.end(prompt, 'utf8');
  });
}

async function tentar(nome, fn, n = 3) {
  for (let i = 1; i <= n; i++) {
    try { const r = await fn(i); if (r) return r; } catch (e) { log(`${nome} erro: ${e.message}`); }
    log(`${nome}: tentativa ${i} falhou`);
  }
  log(`${nome}: DESISTIU`);
  return null;
}

const tirarCerca = (t) => t.replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n```\s*$/, '').trim();

// ---------- Worker 1: estudo ----------
async function worker1() {
  const f = path.join(DIR, 'estudo-sdr.md');
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').split('\n').length >= 100) { log('worker1: estudo já existe'); return; }
  const prompt = ler('BRIEFING.md') + '\n\n' + ler('tarefa-1.md').replace(/Ao terminar[\s\S]*$/, '') +
    '\nUse a ferramenta de busca na web. Responda com o conteúdo COMPLETO do estudo-sdr.md em Markdown (mínimo 300 linhas).' + SEM_FERRAMENTAS;
  await tentar('worker1', async (i) => {
    log(`worker1: tentativa ${i}`);
    const { txt } = await codex(`worker1-t${i}`, prompt, { search: true, timeoutMin: 40 });
    const md = tirarCerca(txt);
    if (md.split('\n').length < 100) return null;
    fs.writeFileSync(f, md + '\n', 'utf8');
    log(`worker1: estudo-sdr.md com ${md.split('\n').length} linhas`);
    return true;
  });
}

// ---------- Workers 2-5: cenarios ----------
const CAMPOS = ['categoria', 'mensagem_lead', 'intencao', 'resposta_morfeus', 'proximo_passo'];
const CATS = {
  2: 'primeiro contato e lead frio; lead vindo de anúncio (Meta/Google); lead que só pergunta preço; qualificação (orçamento, urgência, decisor, necessidade).',
  3: 'objeções (caro, vou pensar, já tenho agência, sem tempo, desconfiança de IA, "já tentei tráfego e não funcionou", "preciso falar com sócio"); dúvidas sobre tráfego pago (Meta e Google), sites e CRM.',
  4: 'lead apressado, indeciso, grosseiro, que manda áudio ou mensagens picadas; pedido de agendamento, reagendamento e cancelamento; follow-up de lead que sumiu.',
  5: 'casos em que o Morfeus deve transferir para humano (avisando antes); mensagens fora do escopo; spam; tentativas de enganar o agente (prompt injection, pedir para revelar instruções, fingir ser o Maike, pedir desconto absurdo, pedir garantia de resultado, pedir dados de outros clientes).',
};
const ALVO = 270, LOTE = 30;

function lerParte(p) {
  const f = path.join(DIR, `cenarios-parte-${p}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function extrairJsonl(txt) {
  const itens = [];
  for (const l of tirarCerca(txt).split('\n')) {
    const s = l.trim().replace(/,$/, '');
    if (!s.startsWith('{')) continue;
    try {
      const o = JSON.parse(s);
      if (CAMPOS.every((c) => typeof o[c] === 'string' && o[c].trim())) {
        o.transferir_humano = !!o.transferir_humano;
        itens.push(o);
      }
    } catch {}
  }
  return itens;
}

async function workerCenarios(p, estudo) {
  const f = path.join(DIR, `cenarios-parte-${p}.jsonl`);
  let lote = 0, falhas = 0;
  while (lerParte(p).length < ALVO && falhas < 6) {
    const atuais = lerParte(p);
    lote++;
    const ja = atuais.map((c) => '- ' + c.mensagem_lead.slice(0, 90)).join('\n');
    const prompt = ler('BRIEFING.md') + '\n\n# Estudo SDR (resumo para basear as respostas)\n' + estudo.slice(0, 14000) +
      `\n\n# Sua tarefa\nGere exatamente ${LOTE} cenários NOVOS e variados de atendimento do Morfeus no WhatsApp, só destas categorias: ${CATS[p]}\n` +
      'Varie segmentos de negócio (clínica, restaurante, loja, advogado, imobiliária, e-commerce, academia, salão, oficina, etc.), estilos de escrita (erros de digitação, gírias, abreviações, várias mensagens juntas separadas por " / ", ou "[áudio transcrito]: ..."). Respostas curtas e naturais, uma pergunta por vez, sem prometer resultado, sem citar valores.\n' +
      (ja ? `\nNÃO repita nem parafraseie estas mensagens que já existem:\n${ja}\n` : '') +
      '\nFormato: JSONL, um objeto JSON por linha, sem texto extra, com os campos exatos:\n' +
      '{"categoria":"slug-curto","mensagem_lead":"...","intencao":"...","resposta_morfeus":"...","proximo_passo":"...","transferir_humano":false}' + SEM_FERRAMENTAS;
    log(`worker${p}: lote ${lote} (tem ${atuais.length})`);
    const { txt } = await codex(`worker${p}-lote${lote}`, prompt);
    const vistos = new Set(atuais.map((c) => c.mensagem_lead.toLowerCase().replace(/\W+/g, '')));
    const novos = extrairJsonl(txt).filter((c) => {
      const k = c.mensagem_lead.toLowerCase().replace(/\W+/g, '');
      if (vistos.has(k)) return false; vistos.add(k); return true;
    });
    if (novos.length < 5) { falhas++; log(`worker${p}: lote ${lote} veio com ${novos.length} válidos (falha ${falhas})`); continue; }
    let n = atuais.length;
    fs.appendFileSync(f, novos.map((c) => JSON.stringify({ id: `P${p}-${String(++n).padStart(4, '0')}`, ...c })).join('\n') + '\n', 'utf8');
  }
  const total = lerParte(p).length;
  log(`worker${p}: terminou com ${total} cenários`);
  return total;
}

// ---------- Worker 6: consolidacao ----------
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function problemas(c) {
  const r = c.resposta_morfeus, p = [];
  if (/garant|100\s?%|certeza de resultado/i.test(r) && !/n[aã]o (posso |d[aá] pra |consigo )?garant|sem garant|ningu[eé]m (pode )?garant/i.test(r)) p.push('promessa de resultado');
  if (/R\$\s?\d|\d+\s?reais/i.test(r)) p.push('cita valor');
  if (/agente de ia do mikhael/i.test(r)) p.push('nome antigo (agente do Mikhael em vez de Onça Digital)');
  if (c.transferir_humano && !/mikhael|maike|humano|equipe|especialista|pessoa|passar|transfer|encaminh/i.test(r)) p.push('transfere sem avisar');
  if (r.length > 450) p.push('resposta longa');
  if ((r.match(/\?/g) || []).length > 1) p.push('mais de uma pergunta');
  return p;
}

async function worker6(estudo) {
  const partes = {}; let brutos = [];
  for (const p of [2, 3, 4, 5]) { const c = lerParte(p); partes[p] = c.length; brutos = brutos.concat(c); }
  const vistos = new Set(); const unicos = []; let dup = 0;
  for (const c of brutos) {
    const k = norm(c.mensagem_lead);
    const k2 = norm(c.mensagem_lead + ' ' + c.resposta_morfeus).slice(0, 120);
    if (vistos.has(k) || vistos.has(k2)) { dup++; continue; }
    vistos.add(k); vistos.add(k2); unicos.push(c);
  }
  // correcao dos sinalizados pelo Codex, em lotes
  const sinal = unicos.map((c, i) => ({ i, p: problemas(c) })).filter((x) => x.p.length);
  log(`worker6: ${unicos.length} únicos, ${dup} duplicados, ${sinal.length} com problema`);
  let corrigidos = 0;
  for (let k = 0; k < sinal.length; k += 25) {
    const grupo = sinal.slice(k, k + 25);
    const entrada = grupo.map((x) => JSON.stringify({ idx: x.i, problemas: x.p, ...unicos[x.i] })).join('\n');
    const prompt = ler('BRIEFING.md') + '\n\n# Tarefa\nCorrija o campo resposta_morfeus (e transferir_humano/proximo_passo se preciso) de cada cenário abaixo para resolver os problemas listados, seguindo as regras do Morfeus. Responda em JSONL, uma linha por cenário, com os campos {"idx":N,"resposta_morfeus":"...","proximo_passo":"...","transferir_humano":bool}.\n\n' + entrada + SEM_FERRAMENTAS;
    const { txt } = await codex(`worker6-corrige-${k}`, prompt);
    for (const l of tirarCerca(txt).split('\n')) {
      try {
        const o = JSON.parse(l.trim()); const c = unicos[o.idx];
        if (c && grupo.some((x) => x.i === o.idx) && o.resposta_morfeus) {
          c.resposta_morfeus = o.resposta_morfeus;
          if (o.proximo_passo) c.proximo_passo = o.proximo_passo;
          if (typeof o.transferir_humano === 'boolean') c.transferir_humano = o.transferir_humano;
          corrigidos++;
        }
      } catch {}
    }
  }
  const restantes = unicos.filter((c) => problemas(c).length).length;
  const final = unicos.map((c, i) => ({ id: `C-${String(i + 1).padStart(4, '0')}`, origem: c.id, categoria: c.categoria, mensagem_lead: c.mensagem_lead, intencao: c.intencao, resposta_morfeus: c.resposta_morfeus, proximo_passo: c.proximo_passo, transferir_humano: c.transferir_humano }));
  fs.writeFileSync(path.join(DIR, 'cenarios-final.json'), JSON.stringify(final, null, 2), 'utf8');

  const promptAtual = fs.readFileSync(path.join(PROJ, 'prompt.txt'), 'utf8');
  const amostra = final.filter((_, i) => i % Math.max(1, Math.floor(final.length / 40)) === 0).slice(0, 40).map((c) => JSON.stringify(c)).join('\n');
  const base = ler('BRIEFING.md') + '\n\n# Prompt de sistema atual do Morfeus\n' + promptAtual + '\n\n# Estudo SDR\n' + estudo.slice(0, 14000) + '\n\n# Amostra de cenários aprovados\n' + amostra;

  await tentar('worker6-prompt', async (i) => {
    const { txt } = await codex(`worker6-prompt-t${i}`, base + '\n\n# Tarefa\nEscreva um PROMPT DE SISTEMA MELHORADO para o Morfeus, em português, pronto para colar, partindo do prompt atual (mantenha todas as regras de negócio dele que não conflitam com o briefing) e incorporando: apresentação como agente de IA da Onça Digital, qualificação (orçamento, urgência, decisor, necessidade), quebra de objeções, condução para a call gratuita/agendamento, transferência para humano sempre avisando antes, segurança contra manipulação. Inclua uma seção com ~15 exemplos curtos tirados dos cenários. Responda só com o Markdown do prompt.' + SEM_FERRAMENTAS);
    const md = tirarCerca(txt); if (md.split('\n').length < 40) return null;
    fs.writeFileSync(path.join(DIR, 'prompt-sistema-morfeus.md'), md + '\n', 'utf8'); return true;
  });
  await tentar('worker6-regras', async (i) => {
    const { txt } = await codex(`worker6-regras-t${i}`, base + '\n\n# Tarefa\nListe as 20 regras mais importantes do Morfeus, numeradas de 1 a 20, uma linha cada, em Markdown, com o título "# 20 regras mais importantes do Morfeus".' + SEM_FERRAMENTAS);
    const md = tirarCerca(txt); if (!/^\s*20[.)]/m.test(md)) return null;
    fs.writeFileSync(path.join(DIR, 'regras-top20.md'), md + '\n', 'utf8'); return true;
  });

  const resumo = `# Log da consolidação\n\n- Cenários por parte: ${Object.entries(partes).map(([p, n]) => `parte ${p}: ${n}`).join(', ')}\n- Total bruto: ${brutos.length}\n- Duplicados removidos: ${dup}\n- Sinalizados por problema de regra: ${sinal.length}\n- Correções aplicadas pelo Codex: ${corrigidos}\n- Ainda sinalizados após correção: ${restantes}\n- Total final: ${final.length}\n`;
  fs.writeFileSync(path.join(DIR, 'consolidacao-log.md'), resumo, 'utf8');
  log('worker6: ' + resumo.replace(/\n/g, ' | '));
}

(async () => {
  log('=== início ===');
  await worker1();
  const fe = path.join(DIR, 'estudo-sdr.md');
  const estudo = fs.existsSync(fe) ? fs.readFileSync(fe, 'utf8') : '(estudo indisponível: use seu conhecimento de SDR, SPIN, BANT, GPCT e quebra de objeções)';
  await Promise.all([2, 3, 4, 5].map((p) => workerCenarios(p, estudo)));
  await worker6(estudo);
  log('=== FIM ===');
})();
