// MATRIX CRM · liga o Morfeus (WhatsApp) a UMA subconta do Matrix.
// Uso: node chave-integracao.js local   (Matrix rodando no PC: TESTAR-NO-PC.bat)
//      node chave-integracao.js nuvem   (Matrix publicado na Cloudflare)
// Gera uma chave nova, guarda só o código embaralhado dela no banco e grava a chave direto no
// ../agente-whatsapp/config.json (bloco "matrix"). A chave não aparece na tela nem em log.
// O Morfeus só passa a usar depois de reiniciado.
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
process.chdir(__dirname);
const modo = process.argv[2] === 'nuvem' ? 'nuvem' : 'local', ALVO = modo === 'nuvem' ? '--remote' : '--local';
const CFG = path.join(__dirname, '..', 'agente-whatsapp', 'config.json');
const W = 'npx --yes wrangler';
const rodar = cmd => { try { return execSync(`${W} ${cmd}`, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const perguntar = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); r(a.trim()); }); });
const consulta = sqlTxt => { const o = rodar(`d1 execute matrix-crm ${ALVO} --yes --json --command "${sqlTxt}"`); try { return JSON.parse(o.slice(o.indexOf('[')))[0].results; } catch { throw new Error('Não consegui ler o banco. Saída do wrangler:\n' + o.slice(-800)); } };

(async () => {
  console.log(`\n=== Ligar o Morfeus ao MATRIX CRM (${modo === 'nuvem' ? 'Cloudflare' : 'PC'}) ===\n`);
  if (!fs.existsSync(CFG)) throw new Error('Não achei ' + CFG);
  rodar(`d1 execute matrix-crm ${ALVO} --file=schema-etapa2-crm.sql --yes`); // garante a tabela de integrações
  const subs = consulta('SELECT id, nome FROM subcontas WHERE ativa = 1 ORDER BY criada_em');
  if (!subs.length) throw new Error('Nenhuma subconta ativa. Crie o cliente na tela Agência primeiro.');
  subs.forEach((s, i) => console.log(`  ${i + 1}) ${s.nome}`));
  const n = Number(await perguntar('\nEm qual cliente as conversas do Morfeus devem cair? Número: '));
  const sub = subs[n - 1]; if (!sub) throw new Error('Número inválido.');
  let url = modo === 'local' ? 'http://localhost:8788' : '';
  if (modo === 'nuvem') { url = (await perguntar('Endereço do Matrix na Cloudflare (ex.: https://matrix-crm.pages.dev): ')).replace(/\/$/, ''); }
  if (!/^https?:\/\/[\w.-]+(:\d+)?$/.test(url)) throw new Error('Endereço inválido: ' + url);
  const ligar = /^s/i.test(await perguntar('Ligar o registro no CRM já no próximo reinício do Morfeus? (s/n): '));

  const token = crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(token).digest('hex');
  const agora = Date.now(), id = crypto.randomUUID(), arq = path.join(__dirname, '.integracao.sql');
  fs.writeFileSync(arq, `UPDATE integracoes SET ativa = 0 WHERE subconta_id = '${sub.id.replace(/'/g, "''")}' AND nome = 'Morfeus WhatsApp';\n` +
    `INSERT INTO integracoes (id, subconta_id, nome, token_hash, ativa, criada_em) VALUES ('${id}', '${sub.id.replace(/'/g, "''")}', 'Morfeus WhatsApp', '${hash}', 1, ${agora});\n`);
  try { rodar(`d1 execute matrix-crm ${ALVO} --file=.integracao.sql --yes`); } finally { fs.unlinkSync(arq); }
  if (!consulta(`SELECT 1 AS ok FROM integracoes WHERE id = '${id}' AND ativa = 1`).length) throw new Error('A chave não foi gravada no banco.');

  const texto = fs.readFileSync(CFG, 'utf8'), cfg = JSON.parse(texto);
  const backup = CFG.replace(/\.json$/, `.backup-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, texto);
  cfg.matrix = { ativo: ligar, url, token, timeoutSegundos: 8, cliente: sub.nome,
    _ajuda: 'Registra as conversas do WhatsApp no MATRIX CRM (paciente, card no funil e linha do tempo). Gerado por matrix-crm/chave-integracao.js. Para desligar, ponha ativo: false e reinicie o Morfeus.' };
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`\nPronto. Chave criada para "${sub.nome}" e gravada no config do Morfeus (a chave não fica em nenhum outro lugar).`);
  console.log(ligar ? 'Reinicie o Morfeus (REINICIAR-MORFEUS.bat) quando for um bom momento: a partir daí as conversas aparecem no Matrix.'
    : 'Ficou DESLIGADO. Para ligar: no config.json do Morfeus, bloco "matrix", troque "ativo": false por true e reinicie o Morfeus.');
  if (modo === 'local') console.log('Lembrete: no modo PC, o Matrix precisa estar aberto (TESTAR-NO-PC.bat) para receber as conversas.');
})().catch(e => { console.error('\nERRO: ' + (e.message || e)); process.exitCode = 1; });
