// FÁBRICA DO MATRIX CRM: o Neo (FreeLLMAPI) e a Trinity (design) constroem as telas. O Claude só supervisiona.
// Uso: node construir.js            -> constrói o que falta
//      node construir.js funil      -> refaz só essa tela (ou "style", "shell", "login")
const fs = require('fs'), path = require('path');
const DIR = __dirname, SITE = path.join(DIR, 'site'), BRUTO = path.join(DIR, 'bruto');
fs.mkdirSync(SITE, { recursive: true }); fs.mkdirSync(BRUTO, { recursive: true });
const cfgArq = ['../Agentes/morfeus/config.json', '../agente-whatsapp/config.json', '../morfeus/config.json'].map(p => path.join(DIR, p)).find(fs.existsSync);
if (!cfgArq) { console.log('Não achei o config.json do Morfeus (chave do FreeLLMAPI).'); process.exit(1); }
const llm = JSON.parse(fs.readFileSync(cfgArq, 'utf8')).llm;
const MODELOS = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.6-flash', 'openai/gpt-oss-120b', 'auto'];
const TRINITY = fs.readFileSync(path.join(DIR, 'trinity.md'), 'utf8');
const TELAS = JSON.parse(fs.readFileSync(path.join(DIR, 'telas.json'), 'utf8'));
const refazer = process.argv[2];
const log = t => { console.log(t); fs.appendFileSync(path.join(DIR, 'progresso.log'), `[${new Date().toLocaleTimeString('pt-BR')}] ${t}\n`); };
const espera = ms => new Promise(r => setTimeout(r, ms));

function codigo(txt) {
  const blocos = [...txt.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map(m => m[1]);
  if (blocos.length) return blocos.sort((a, b) => b.length - a.length)[0].trim();
  return txt.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
}
async function neo(nome, pedido, valida) {
  for (let volta = 0; volta < 2; volta++) for (const model of MODELOS) {
    try {
      const t0 = Date.now();
      const r = await fetch(llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(240000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.apiKey },
        body: JSON.stringify({ model, temperature: 0.5, max_tokens: 12000, messages: [{ role: 'system', content: TRINITY }, { role: 'user', content: pedido }] }),
      });
      if (!r.ok) { log(`  ${nome}: ${model} recusou (${r.status})`); await espera(4000); continue; }
      const j = await r.json(); const c = j.choices?.[0];
      const out = codigo(c?.message?.content || '');
      const cortado = c?.finish_reason === 'length';
      const erro = cortado ? 'resposta cortada' : valida(out);
      if (erro) { log(`  ${nome}: ${model} entregou com problema (${erro})`); continue; }
      log(`  ${nome}: ok com ${j.model || model} em ${((Date.now() - t0) / 1000).toFixed(0)}s (${out.length} caracteres)`);
      return out;
    } catch (e) { log(`  ${nome}: ${model} falhou (${e.message})`); await espera(4000); }
  }
  throw new Error('nenhum modelo entregou ' + nome);
}
async function etapa(nome, arq, pedido, valida) {
  const destino = path.join(BRUTO, arq);
  if (fs.existsSync(destino) && refazer !== nome) return fs.readFileSync(destino, 'utf8');
  log(`Trinity trabalhando: ${nome}`);
  const out = await neo(nome, pedido, valida);
  fs.writeFileSync(destino, out); return out;
}

(async () => {
  log('=== MATRIX CRM · construção iniciada ===');
  const menu = [['painel', 'Painel'], ['conversas', 'Conversas'], ['pacientes', 'Pacientes'], ['funil', 'Funil'], ['agenda', 'Agenda'], ['agentes', 'Agentes de IA'], ['automacoes', 'Automações'], ['configuracoes', 'Configurações'], ['agencia', 'Agência']];
  const css = await etapa('style', 'style.css',
`Crie o arquivo style.css completo: o design system do MATRIX CRM. Você tem autonomia total na estética. Direção: inspirado no universo Matrix (escuro, verde fósforo, toque tecnológico), porém elegante, limpo e muito legível para uso diário numa clínica; nada de poluição visual.
Obrigatório:
- :root com variáveis: --marca e --marca-2 (padrão em tons de verde), fundo, superfícies, bordas, textos, estados (sucesso, alerta, erro, info), raios, sombras, espaçamentos e fonte (pilha de fontes do sistema).
- Tema claro alternativo em [data-tema="claro"] trocando só as variáveis.
- Estrutura: .app (grade com menu lateral e área principal), .lateral, .lateral a, .lateral a.ativo, .topo, .conteudo; no celular o menu vira barra recolhível (.lateral.aberta).
- Componentes: .btn (.btn-primario, .btn-suave, .btn-perigo, .btn-icone), .cartao, .kpi, .grade (colunas automáticas), .tabela, campos de formulário (.campo, label, input, select, textarea), .abas e .aba.ativa, .etiqueta com variações de cor, .avatar, .modal e .modal.aberto, .painel-lateral e .painel-lateral.aberto, .interruptor (checkbox estilizado), .kanban, .coluna, .cartao-kanban, .balao e .balao.meu (chat), .vazio, utilitários (.linha, .entre, .mudo, .oculto).
- Estados de foco visíveis, transições suaves respeitando prefers-reduced-motion, e @media print básico que esconde .lateral, .topo e botões.
- No topo do arquivo, um comentário listando todas as classes criadas com uma linha de uso cada.`,
    o => !o.includes('--marca') ? 'sem --marca' : o.length < 4000 ? 'curto demais' : '');
  fs.writeFileSync(path.join(SITE, 'style.css'), css);

  const shell = await etapa('shell', 'shell.html',
`Com base no style.css abaixo, crie o esqueleto HTML completo (<!DOCTYPE html> até </html>) das páginas internas do MATRIX CRM.
- <title><!--TITULO--> · MATRIX CRM</title> e <link rel="stylesheet" href="style.css">.
- Menu lateral com logotipo "MATRIX CRM" desenhado em SVG/CSS, seletor de subconta ("Clínica Sorriso (exemplo)") e os links, cada um com ícone SVG: ${menu.map(([a, t]) => `${t} (${a}.html)`).join(', ')}.
- Barra do topo com botão de abrir o menu no celular, o título da página (<!--TITULO-->), busca, alternador de tema claro/escuro e avatar do usuário.
- Dentro de <main class="conteudo"> coloque exatamente o marcador <!--CONTEUDO--> e nada mais.
- Um <script> no fim que: marca como .ativo o link da página atual (pelo nome do arquivo na URL), abre/fecha o menu no celular, alterna e guarda o tema no localStorage, e aplica as cores salvas em localStorage 'matrix-marca' e 'matrix-marca-2' nas variáveis --marca e --marca-2.
STYLE.CSS:
${css}`,
    o => !o.includes('<!--CONTEUDO-->') ? 'sem marcador de conteúdo' : !/<\/html>/i.test(o) ? 'incompleto' : '');

  const login = await etapa('login', 'login.html',
`Com base no style.css abaixo, crie a página de login completa (<!DOCTYPE html> até </html>) do MATRIX CRM, usando <link rel="stylesheet" href="style.css">. Tela dividida: de um lado a marca "MATRIX CRM" com um efeito visual marcante e leve feito só com CSS/canvas (chuva de caracteres discreta, que respeita prefers-reduced-motion) e uma frase de valor; do outro o formulário (e-mail, senha, mostrar senha, lembrar de mim, "Esqueci minha senha", botão Entrar). Ao enviar, valida os campos e redireciona para painel.html (é um protótipo, sem servidor).
STYLE.CSS:
${css}`,
    o => !/<form/i.test(o) ? 'sem formulário' : !/<\/html>/i.test(o) ? 'incompleto' : '');
  fs.writeFileSync(path.join(SITE, 'login.html'), login);
  fs.writeFileSync(path.join(SITE, 'index.html'), login);

  const falhas = [];
  for (const t of TELAS) {
    try {
      const corpo = await etapa(t.arq, t.arq + '.html',
`Com base no style.css abaixo, crie SOMENTE o conteúdo interno da tela "${t.titulo}" do MATRIX CRM (o que vai dentro de <main class="conteudo">; não inclua <html>, <head>, menu nem barra do topo, que já existem). Pode incluir um <style> e um <script> próprios no trecho. Tudo precisa funcionar de verdade no navegador com dados fictícios (protótipo navegável).
TELA: ${t.pedido}
STYLE.CSS:
${css}`,
        o => o.length < 1500 ? 'curto demais' : /<html|<body/i.test(o) ? 'veio página inteira' : '');
      fs.writeFileSync(path.join(SITE, t.arq + '.html'), shell.replace(/<!--TITULO-->/g, t.titulo).replace('<!--CONTEUDO-->', corpo));
    } catch (e) { falhas.push(t.arq); log(`  FALHOU: ${t.arq} (${e.message})`); }
  }
  log(falhas.length ? `=== Terminou com pendências: ${falhas.join(', ')}. Rode de novo o CONSTRUIR.bat para tentar só o que faltou. ===` : '=== MATRIX CRM · protótipo pronto em site\\login.html ===');
})().catch(e => { log('ERRO: ' + e.message); process.exit(1); });
