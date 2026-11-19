// PONTE DO MORFEUS COM O N8N — o atendimento passa por um fluxo que o Maike edita visualmente (http://localhost:5678).
// 1) resposta(): manda a conversa para o fluxo "Morfeus - Atendimento" e recebe o texto a enviar.
//    Se o n8n estiver desligado, demorar demais, der erro ou devolver vazio, devolve null e o Morfeus responde do jeito de sempre.
// 2) evento(): avisa o fluxo "Morfeus - Eventos" (mensagem respondida, lead qualificado, transferência) para automações.
//    É só aviso: nunca atrasa nem bloqueia o atendimento.
// O Morfeus continua sendo o único que fala com o WhatsApp, e continua só respondendo quem chama.
module.exports = function criar(cfg, log) {
  const c = cfg.n8n || {};
  const ligado = () => c.ativo === true && /^https?:\/\//.test(c.webhookAtendimento || '');
  let foraAte = 0, avisado = false;

  async function resposta({ system, historico, telefone, nome, veioAudio, prospeccao }) {
    if (!ligado() || Date.now() < foraAte) return null;
    try {
      const ultima = [...historico].reverse().find(m => m.role === 'user');
      const r = await fetch(c.webhookAtendimento, { method: 'POST', signal: AbortSignal.timeout((c.timeoutSegundos || 30) * 1000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone, nome: nome || null, mensagem: ultima ? ultima.content : '', veioAudio: !!veioAudio, prospeccao: !!prospeccao, system, historico, em: new Date().toISOString() }) });
      if (!r.ok) throw new Error('http ' + r.status);
      let j = await r.json(); if (Array.isArray(j)) j = j[0] || {};
      const txt = typeof j.resposta === 'string' ? j.resposta.trim() : '';
      if (avisado) { log('🔀 n8n voltou: atendimento pelo fluxo de novo'); avisado = false; }
      return txt || null; // vazio = "use o padrão"
    } catch (e) {
      foraAte = Date.now() + 60000; // não insiste por 1 minuto
      if (!avisado) { log('🔀 n8n indisponível (' + String(e.message).slice(0, 60) + '): respondendo pelo caminho normal'); avisado = true; }
      return null;
    }
  }

  function evento(tipo, dados) {
    if (c.ativo !== true || !/^https?:\/\//.test(c.webhookEventos || '') || Date.now() < foraAte) return;
    fetch(c.webhookEventos, { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, em: new Date().toISOString(), ...dados }) }).catch(() => {});
  }

  return { resposta, evento, ligado };
};
