// Simulador: uma IA faz papel de lead e conversa com o Morfeus (prompt.txt). Não usa WhatsApp.
const fs = require('fs'), path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const PROMPT = fs.readFileSync(path.join(__dirname, 'prompt.txt'), 'utf8');
const cenarios = [
  'Dono de loja de celulares em Goiânia, nunca anunciou, não sabe o que precisa, responde curto.',
  'Dona de clínica de estética em Anápolis, já impulsionou posts no Instagram e "não deu certo", desconfiada.',
  'Advogado trabalhista em São Paulo, quer aparecer no Google, pergunta logo "quanto custa a gestão?" e insiste no preço.',
  'Dono de pizzaria delivery, diz que não tem verba, mas quer mais pedidos no WhatsApp.',
  'Empresária de e-commerce de roupas, já investe R$ 5 mil/mês na Meta, ROAS caiu, faz perguntas técnicas sobre API de Conversões e Advantage+.',
  'Pessoa que pergunta se está falando com um robô e depois pede para falar com uma pessoa.',
  'Corretor de imóveis que diz "vou pensar" quando chega a hora de agendar.',
  'Pessoa que quer um site para a academia dela e também quer organizar os alunos que chamam no WhatsApp (CRM).',
  'Pessoa que pergunta coisa fora do assunto (conserto de celular, preço de iPhone) e depois some.',
  'Dono de assistência técnica com urgência: quer clientes ainda esta semana e topa agendar rápido.'
];
function umaPergunta(txt) { // corta tudo depois da 1ª pergunta (exceto as marcas finais)
  const m = txt.match(/\n?\[(TRANSFERIR|LEAD_QUALIFICADO)\][^\n]*$/); const tag = m ? m[0] : '';
  let corpo = tag ? txt.slice(0, txt.length - tag.length) : txt;
  const i = corpo.indexOf('?'); if (i >= 0) corpo = corpo.slice(0, i + 1);
  return (corpo.trim() + (tag ? '\n' + tag.trim() : '')).trim();
}
async function ia(msgs, system) {
  const modelos = [].concat(cfg.llm.model || 'auto', 'auto');
  const vazou = r => !r || /(We need|We should|The user|User hasn't|I think we|Let's respond)/.test(r);
  for (const model of modelos) {
    try {
      const r = await fetch(cfg.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.llm.apiKey },
        body: JSON.stringify({ model, temperature: 0.5, max_tokens: 1200, reasoning_effort: 'low',
          messages: [{ role: 'system', content: system }, ...msgs] }) });
      if (!r.ok) continue;
      const j = await r.json();
      const txt = (j.choices?.[0]?.message?.content || '').trim();
      const cortado = j.choices?.[0]?.finish_reason === 'length';
      if (!vazou(txt) && !cortado) return umaPergunta(txt);
    } catch {}
  }
  if (!ia._retry) { ia._retry = true; await new Promise(r => setTimeout(r, 8000)); try { return await ia(msgs, system); } finally { ia._retry = false; } }
  throw new Error('nenhum modelo respondeu bem');
}
(async () => {
  const filtro = process.argv[2] ? [Number(process.argv[2]) - 1] : cenarios.map((_, i) => i);
  let out = `# Treino do Morfeus - ${new Date().toLocaleString('pt-BR')}\n\n`;
  for (const i of filtro) {
    const persona = cenarios[i]; console.log(`Cenário ${i + 1}/${cenarios.length}...`);
    const lead = `Você está SIMULANDO um potencial cliente conversando no WhatsApp com uma empresa de marketing. Perfil: ${persona} Escreva como pessoa real no WhatsApp: mensagens curtas, informais, às vezes com erros. Responda só a sua fala. Se a conversa terminar (agendou, desistiu ou foi transferido), escreva FIM.`;
    const agente = [], hist = []; let fala = 'oi';
    out += `## Cenário ${i + 1}: ${persona}\n\n`;
    for (let turno = 0; turno < 10; turno++) {
      out += `**Lead:** ${fala}\n\n`; agente.push({ role: 'user', content: fala });
      const resp = await ia(agente, PROMPT).catch(() => '(erro)'); agente.push({ role: 'assistant', content: resp });
      out += `**Morfeus:** ${resp.replace(/\n/g, '  \n')}\n\n`;
      if (/\[LEAD_QUALIFICADO\]/.test(resp) || (/\[TRANSFERIR\]/.test(resp) && /transfer/i.test(resp.split('[TRANSFERIR]')[0]))) break;
      hist.push({ role: 'user', content: resp });
      fala = await ia(hist, lead).catch(() => 'ok'); hist.push({ role: 'assistant', content: fala });
      if (/^\s*FIM\s*$/i.test(fala) || !fala) break;
      fala = fala.replace(/\bFIM\b/g, '').trim() || 'ok';
    }
    out += '---\n\n';
    fs.writeFileSync(path.join(__dirname, 'treino-resultado.md'), out);
  }
  console.log('Pronto! Resultado em treino-resultado.md');
})();
