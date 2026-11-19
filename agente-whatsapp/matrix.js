// PONTE DO MORFEUS COM O MATRIX CRM — cada conversa do WhatsApp vira paciente + card no funil + linha do tempo no Matrix.
// É só aviso: nunca espera resposta, nunca atrasa nem bloqueia o atendimento, e não muda nada no que o Morfeus fala.
// Se o Matrix estiver fora do ar, para de tentar por 1 minuto e avisa uma vez no log.
// Liga em config.json > matrix: { "ativo": true, "url": "https://SEU-MATRIX.pages.dev", "token": "..." }
// A chave (token) é gerada no Matrix com: node chave-integracao.js local|nuvem  (pasta matrix-crm)
module.exports = function criar(cfg, log) {
  const c = cfg.matrix || {};
  const ligado = () => c.ativo === true && /^https?:\/\//.test(c.url || '') && /^[a-f0-9]{64}$/.test(c.token || '');
  let foraAte = 0, avisado = false;

  // tipo: recebida | enviada | humano | transferido | lead_qualificado
  // jid: o endereço do WhatsApp (número@s.whatsapp.net ou id@lid quando o número está oculto)
  function registrar(tipo, { jid, telefone, texto, nome, veioAudio }) {
    if (!ligado() || Date.now() < foraAte) return;
    const lid = /@lid$/.test(jid || '') && String(telefone || '') === String(jid || '').split('@')[0];
    const corpo = { tipo, telefone: lid ? null : telefone, lid, whatsappId: String(jid || '').slice(0, 60), texto: String(texto || '').slice(0, 2000), nome: nome || null, veioAudio: !!veioAudio, em: Date.now() };
    fetch(c.url.replace(/\/$/, '') + '/api/integracao/whatsapp', {
      method: 'POST', signal: AbortSignal.timeout((c.timeoutSegundos || 8) * 1000),
      headers: { 'Content-Type': 'application/json', 'X-Matrix': '1', Authorization: 'Bearer ' + c.token },
      body: JSON.stringify(corpo),
    }).then(r => {
      if (r.status === 401) throw new Error('chave recusada (gere outra com chave-integracao.js)');
      if (!r.ok) throw new Error('http ' + r.status);
      if (avisado) { log('📇 Matrix CRM voltou: conversas sendo registradas de novo'); avisado = false; }
    }).catch(e => {
      foraAte = Date.now() + 60000;
      if (!avisado) { log('📇 Matrix CRM indisponível (' + String(e.message).slice(0, 80) + '): o atendimento segue normal, só não registra no CRM'); avisado = true; }
    });
  }

  return { registrar, ligado };
};
