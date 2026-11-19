/* MATRIX CRM · sessão e perfis (dono da plataforma x cliente). As permissões são conferidas no servidor. */
(function () {
  var AGENTES = [['recepcionista', 'Recepcionista'], ['sdr', 'SDR de Vendas'], ['lembretes', 'Lembretes'], ['pos', 'Pós-consulta']];
  var pagina = (location.pathname.split('/').pop() || 'painel').toLowerCase().replace(/\.html$/, '');
  function el(tag, attrs, texto) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (texto != null) e.textContent = texto; return e; }
  function api(metodo, caminho, corpo) {
    return fetch('/api/' + caminho, { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Matrix': '1' }, body: corpo ? JSON.stringify(corpo) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (r.status === 401) location.href = 'login.html'; if (!r.ok) { var e = new Error(d.erro || 'Não foi possível concluir.'); e.codigo = d.codigo; throw e; } return d; }); });
  }
  function entrar(id) { return api('POST', 'entrar-como', { subconta: id }).then(function () { location.href = 'painel.html'; }); }
  function voltar() { return api('POST', 'entrar-como', { subconta: null }).then(function () { location.href = 'agencia.html'; }); }
  function sair() { api('POST', 'sair').catch(function () {}).then(function () { location.href = 'login.html'; }); }
  var pronto = api('GET', 'eu');
  window.MATRIX = { AGENTES: AGENTES, api: api, entrar: entrar, voltar: voltar, sair: sair, pronto: pronto, el: el };

  function telaTrocarSenha() {
    var tela = el('div', { style: 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:24px' });
    var f = el('form', { class: 'cartao', style: 'display:flex;flex-direction:column;gap:14px;max-width:380px;width:100%' });
    f.appendChild(el('h2', {}, 'Crie a sua senha')); f.appendChild(el('p', { class: 'mudo' }, 'Você entrou com uma senha provisória. Escolha uma senha só sua, com pelo menos 10 caracteres.'));
    var c1 = el('div', { class: 'campo' }), a = el('input', { type: 'password', required: '', autocomplete: 'current-password' }); c1.appendChild(el('label', {}, 'Senha provisória')); c1.appendChild(a);
    var c2 = el('div', { class: 'campo' }), n = el('input', { type: 'password', required: '', minlength: '10', maxlength: '128', autocomplete: 'new-password' }); c2.appendChild(el('label', {}, 'Nova senha')); c2.appendChild(n);
    var msg = el('p', { style: 'color:var(--erro);font-size:13px' }), b = el('button', { class: 'btn btn-primario', type: 'submit' }, 'Salvar e entrar');
    f.appendChild(c1); f.appendChild(c2); f.appendChild(msg); f.appendChild(b); tela.appendChild(f); document.body.appendChild(tela);
    f.addEventListener('submit', function (e) { e.preventDefault(); b.disabled = true; api('POST', 'senha', { atual: a.value, nova: n.value }).then(function () { location.reload(); }).catch(function (er) { msg.textContent = er.message; b.disabled = false; }); });
  }

  function tela2f(nova) {
    var tela = el('div', { style: 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:24px;overflow:auto' });
    var f = el('form', { class: 'cartao', style: 'display:flex;flex-direction:column;gap:12px;max-width:460px;width:100%' });
    tela.appendChild(f); document.body.appendChild(tela);
    f.appendChild(el('h2', {}, 'Proteja a sua conta'));
    f.appendChild(el('p', { class: 'mudo' }, 'Sua conta controla dados de clientes, então o login pede também um código do celular.'));
    var msg = el('p', { style: 'color:var(--erro);font-size:13px' });
    api('POST', '2f/iniciar', { nova: nova === true }).then(function (d) {
      f.appendChild(el('p', {}, '1. Abra o Google Authenticator (ou Microsoft Authenticator) no celular.'));
      f.appendChild(el('p', {}, '2. Toque em "+" e em "Inserir chave de configuração". Em Conta, escreva MATRIX CRM. Em Chave, digite:'));
      f.appendChild(el('code', { style: 'font-family:var(--fonte-mono);font-size:16px;letter-spacing:2px;word-break:break-all;padding:10px;border:1px solid var(--borda);border-radius:var(--raio-sm);user-select:all' }, d.chave.replace(/(.{4})/g, '$1 ').trim()));
      f.appendChild(el('a', { href: d.link, class: 'mudo', style: 'font-size:13px' }, 'Está no celular? Toque aqui para abrir direto no app.'));
      var outra = el('a', { href: '#', class: 'mudo', style: 'font-size:13px' }, 'Gerar outra chave (use se alguém mais viu esta)'); outra.onclick = function (e) { e.preventDefault(); tela.remove(); tela2f(true); }; f.appendChild(outra);
      var c = el('div', { class: 'campo' }), i = el('input', { type: 'text', inputmode: 'numeric', maxlength: '6', pattern: '[0-9]{6}', required: '', autocomplete: 'one-time-code', placeholder: '000000' });
      c.appendChild(el('label', {}, '3. Digite o código de 6 números que o app mostrar')); c.appendChild(i); f.appendChild(c); f.appendChild(msg);
      var b = el('button', { class: 'btn btn-primario', type: 'submit' }, 'Ativar'); f.appendChild(b);
      f.addEventListener('submit', function (e) {
        e.preventDefault(); b.disabled = true;
        api('POST', '2f/confirmar', { codigo: i.value }).then(function (r) {
          f.textContent = '';
          f.appendChild(el('h2', {}, 'Guarde estes códigos de reserva'));
          f.appendChild(el('p', { class: 'mudo' }, 'Se perder o celular, cada código abaixo vale por um login. Anote em papel ou num gerenciador de senhas. Eles não aparecem de novo.'));
          var cx = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;font-family:var(--fonte-mono);font-size:15px' }); r.codigos.forEach(function (k) { cx.appendChild(el('span', { style: 'user-select:all' }, k)); }); f.appendChild(cx);
          var ok = el('button', { class: 'btn btn-primario', type: 'button' }, 'Já anotei, continuar'); ok.onclick = function () { location.reload(); }; f.appendChild(ok);
        }).catch(function (er) { msg.textContent = er.message; b.disabled = false; });
      });
    }).catch(function (er) { msg.textContent = er.message; f.appendChild(msg); });
    var sx = el('a', { href: '#', class: 'mudo', style: 'font-size:13px' }, 'Sair'); sx.onclick = function (e) { e.preventDefault(); sair(); }; tela.firstChild.appendChild(sx);
  }

  function montar(eu) {
    var dono = eu.funcao === 'dono', sub = eu.subconta;
    if (eu.trocarSenha) return telaTrocarSenha();
    if (eu.configurar2f) return tela2f();
    if (sub && /^#[0-9a-f]{6}$/i.test(sub.cor)) document.documentElement.style.setProperty('--marca', sub.cor);
    var nav = document.querySelector('.lateral nav') || document.querySelector('.lateral');
    document.querySelectorAll('.lateral a').forEach(function (a) { var alvo = (a.getAttribute('href') || '').replace(/\.html$/, ''); a.classList.toggle('ativo', alvo === pagina); });
    var linkAgencia = document.querySelector('.lateral a[href="agencia.html"]');
    if (!dono && linkAgencia) linkAgencia.remove();
    if (nav) { var s = el('a', { href: '#' }); s.appendChild(el('span', {}, 'Sair (' + eu.nome + ')')); s.onclick = function (e) { e.preventDefault(); sair(); }; nav.appendChild(s); }
    var seletor = document.querySelector('.seletor-subconta select');
    if (seletor) {
      seletor.textContent = '';
      if (dono) {
        seletor.appendChild(el('option', { value: '' }, 'Agência (todos os clientes)'));
        api('GET', 'subcontas').then(function (d) { d.subcontas.forEach(function (c) { var o = el('option', { value: c.id }, c.nome); if (sub && c.id === sub.id) o.selected = true; seletor.appendChild(o); }); });
        seletor.onchange = function () { seletor.value ? entrar(seletor.value) : voltar(); };
      } else { seletor.appendChild(el('option', {}, sub ? sub.nome : 'Minha clínica')); seletor.disabled = true; }
    }
    var conteudo = document.querySelector('main.conteudo') || document.querySelector('.conteudo');
    if (dono && sub && conteudo) {
      var faixa = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;margin-bottom:16px;border:1px solid var(--alerta);background:var(--alerta-fundo);border-radius:var(--raio);font-size:14px' });
      faixa.appendChild(el('span', {}, 'Você está vendo o sistema como o cliente: ' + sub.nome));
      var b = el('button', { class: 'btn btn-suave', type: 'button' }, 'Voltar à agência'); b.onclick = voltar; faixa.appendChild(b);
      conteudo.insertBefore(faixa, conteudo.firstChild);
    }
    if (pagina === 'agentes' && sub) {
      var chaves = document.querySelectorAll('.conteudo .interruptor input[type=checkbox]');
      AGENTES.forEach(function (ag, i) {
        var c = chaves[i]; if (!c) return;
        c.checked = !!sub.agentes[ag[0]]; c.disabled = !sub.podeMexer;
        c.onchange = function () { api('PATCH', 'agentes', { agente: ag[0], ligado: c.checked }).catch(function (er) { c.checked = !c.checked; alertar(er.message); }); };
      });
      if (!sub.podeMexer && conteudo) conteudo.insertBefore(el('p', { class: 'mudo', style: 'margin-bottom:12px' }, 'Os agentes são ligados e desligados pela equipe MATRIX. Para alterar, fale com o suporte.'), conteudo.children[1] || null);
    }
  }
  function alertar(t) { var a = el('div', { style: 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:12px 16px;border-radius:var(--raio);background:var(--erro-fundo);border:1px solid var(--erro);color:var(--texto)' }, t); document.body.appendChild(a); setTimeout(function () { a.remove(); }, 5000); }
  MATRIX.alertar = alertar;
  function quandoPronto(f) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); }
  pronto.then(function (eu) { quandoPronto(function () { montar(eu); }); }).catch(function () {});
})();
