// MATRIX CRM · prepara o banco, cria o dono e publica.  Uso: node publicar.js local | nuvem
const { execSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
process.chdir(__dirname);
const modo = process.argv[2] === 'nuvem' ? 'nuvem' : 'local', ALVO = modo === 'nuvem' ? '--remote' : '--local';
const W = 'npx --yes wrangler';
const rodar = (cmd, mostrar = true) => execSync(`${W} ${cmd}`, { encoding: 'utf8', stdio: mostrar ? 'inherit' : ['inherit', 'pipe', 'pipe'] });
const LOG = path.join(__dirname, 'publicar.log');
const anotar = t => { try { fs.appendFileSync(LOG, `[${new Date().toLocaleString('pt-BR')}] ${t}\n`); } catch {} };
const tentar = cmd => { let o; try { o = rodar(cmd, false) || ''; } catch (e) { o = String(e.stdout || '') + String(e.stderr || ''); } anotar('> wrangler ' + cmd.replace(/--command ".*"/, '--command "..."') + '\n' + o.slice(-1500)); return o; };
const perguntar = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); r(a.trim()); }); });
const sql = comando => tentar(`d1 execute matrix-crm ${ALVO} --yes --json --command "${comando}"`);
function temDono() { const o = sql("SELECT COUNT(*) AS n FROM usuarios WHERE funcao='dono'"), m = o.match(/"n"\s*:\s*(\d+)/); if (!m) throw new Error('Não consegui consultar o banco. Detalhes no arquivo publicar.log'); return Number(m[1]) > 0; }

(async () => {
  anotar(`=== início (${modo}) · node ${process.version} ===`);
  console.log(`\n=== MATRIX CRM · ${modo === 'nuvem' ? 'publicar na Cloudflare' : 'teste no seu PC'} ===\n`);
  if (modo === 'nuvem') {
    if (!/You are logged in|associated with the email/i.test(tentar('whoami'))) { console.log('Vai abrir o navegador para você entrar na Cloudflare e autorizar...'); rodar('login'); }
    let toml = fs.readFileSync('wrangler.toml', 'utf8');
    if (toml.includes('"PENDENTE"')) {
      console.log('Criando o banco de dados...');
      let saida = tentar('d1 create matrix-crm'), id = (saida.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
      if (!id) { try { const l = tentar('d1 list --json'); id = JSON.parse(l.slice(l.indexOf('['))).find(d => d.name === 'matrix-crm').uuid; } catch {} }
      if (!id) throw new Error('Não consegui criar o banco:\n' + saida);
      fs.writeFileSync('wrangler.toml', toml.replace('"PENDENTE"', `"${id}"`)); console.log('Banco criado.');
    }
  }
  console.log('Preparando as tabelas...');
  tentar(`d1 execute matrix-crm ${ALVO} --file=schema.sql --yes`);
  tentar(`d1 execute matrix-crm ${ALVO} --file=schema-etapa2-crm.sql --yes`); // pacientes, funil, oportunidades (só cria o que falta)
  for (const col of ['totp_secret TEXT', 'totp_ativo INTEGER NOT NULL DEFAULT 0', 'totp_ultimo INTEGER NOT NULL DEFAULT 0']) tentar(`d1 execute matrix-crm ${ALVO} --yes --command "ALTER TABLE usuarios ADD COLUMN ${col}"`);
  if (process.argv[3] === 'reset2f') {
    sql("UPDATE usuarios SET totp_ativo = 0, totp_secret = NULL WHERE funcao = 'dono'"); sql("DELETE FROM codigos_reserva WHERE usuario_id IN (SELECT id FROM usuarios WHERE funcao = 'dono')"); sql("DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE funcao = 'dono')");
    console.log('Pronto: a verificação em 2 fatores do dono foi zerada. No próximo login o sistema pede para configurar de novo.'); return;
  }
  if (!temDono()) {
    console.log('\nVamos criar o SEU login de dono da plataforma.');
    const nome = (await perguntar('Seu nome: ')).replace(/[^\p{L}\p{N} .-]/gu, '').slice(0, 60) || 'Dono';
    let email, senha;
    do { email = (await perguntar('Seu e-mail (será o login): ')).toLowerCase(); } while (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,80}\.[a-z]{2,}$/.test(email) && console.log('E-mail inválido.') === undefined);
    do { senha = await perguntar('Crie uma senha (mínimo 10 caracteres, sem espaços no começo ou fim): '); } while (senha.length < 10 && console.log('Senha curta demais.') === undefined);
    const sal = crypto.randomBytes(16), hash = crypto.pbkdf2Sync(senha, sal, 100000, 32, 'sha256');
    const arq = path.join(__dirname, '.dono.sql');
    fs.writeFileSync(arq, `INSERT INTO usuarios (id, subconta_id, nome, email, senha_hash, funcao, ativo, trocar_senha, criado_em) VALUES ('${crypto.randomUUID()}', NULL, '${nome}', '${email}', 'pbkdf2$100000$${sal.toString('base64')}$${hash.toString('base64')}', 'dono', 1, 0, ${Date.now()});`);
    try { tentar(`d1 execute matrix-crm ${ALVO} --file=.dono.sql --yes`); } finally { fs.unlinkSync(arq); }
    if (!temDono()) throw new Error('O login não foi gravado no banco. Detalhes no arquivo publicar.log');
    console.log('Login de dono criado. A senha não fica guardada em nenhum arquivo, só o código embaralhado dela no banco.\n');
  }
  if (modo === 'local') {
    console.log('Abrindo o sistema em http://localhost:8788  (deixe esta janela aberta; Ctrl+C para parar)\n');
    setTimeout(() => { try { execSync('start http://localhost:8788/login.html', { stdio: 'ignore' }); } catch {} }, 9000);
    spawnSync(`${W} pages dev --port 8788`, { stdio: 'inherit', shell: true });
  } else {
    tentar('pages project create matrix-crm --production-branch main');
    console.log('Publicando...'); rodar('pages deploy --project-name matrix-crm --branch main --commit-dirty=true');
    console.log('\nPUBLICADO. O endereço aparece logo acima (termina em .pages.dev).');
  }
})().catch(e => { anotar('ERRO: ' + (e.stack || e)); console.error('\nERRO: ' + (e.message || e) + '\n(o registro completo está em publicar.log, nesta pasta)'); process.exitCode = 1; });
