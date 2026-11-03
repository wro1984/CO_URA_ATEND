/* URA Atendimento — telas.
 *
 * Fluxo: credencial do HUB neste aparelho -> baixa o dados.json (sempre da rede, cópia cifrada no cache para offline)
 * -> abre com cripto.js -> desenha. Os dias do histórico (hist/…) são baixados só quando a tela precisa e ficam
 * cifrados no cache do aparelho (o arquivo de um dia nunca muda). Confere de novo a cada 2 min com o app aberto.
 * Nada aberto é guardado no aparelho: só os arquivos cifrados.
 *
 * Telas: AGORA (Pulse: última leitura e o dia de hoje em blocos de 15 min, contra a média das últimas 7 semanas no
 * mesmo dia da semana até o mesmo horário) e HISTÓRICO (um dia fechado contra a média das 7 semanas anteriores).
 * Recorte: Total, CO ou TEL; grupos da tradutora e, ao abrir o grupo, as skills.
 */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const CONFERIR_MS = 2 * 60 * 1000;
  const FRESCO_MIN = 20;               // leitura do Pulse mais velha que isso: o ponto do topo fica cinza
  const DIAS_NAVEGAVEIS = 90;
  const CACHE_HIST = 'co-ura-atend-hist';
  const HUB_URL = new URL('/', location.href).href;

  const C = window.URACalc, K = window.URAACripto;
  const $ = id => document.getElementById(id);
  const esc = v => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const fNum = v => v == null ? '—' : nf.format(Math.round(v));
  const fPct = v => v == null ? '—' : String(Math.round(v * 10) / 10).replace('.', ',') + '%';
  const fTempo = s => {
    if (s == null) return '—';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  const isoDe = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const SEMANA_LONGA = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
  const diaBR = iso => { const d = new Date(iso + 'T12:00:00'); return `${SEMANA[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };
  const semanaDe = iso => SEMANA_LONGA[new Date(iso + 'T12:00:00').getDay()];
  const minutosDesde = iso => { const t = Date.parse(iso); return isNaN(t) ? Infinity : (Date.now() - t) / 60000; };
  const horaDe = iso => { const t = Date.parse(iso); return isNaN(t) ? '—' : new Date(t).toTimeString().slice(0, 5); };

  let cont = null, chaveHist = null, cred = null, gerado = null;
  const est = { aba: 'agora', filtro: 'total', gran: 30, metrica: 'of', dia: null, abertos: new Set(), sel: null };
  const dias = new Map();          // iso -> dia aberto (memória)
  const baixando = new Map();      // iso -> Promise

  // ---------- dados ----------
  async function baixar() {
    const r = await fetch('dados.json', { cache: 'no-store' });
    if (r.status === 404) { const e = new Error('Ainda não há dados publicados.'); e.code = 'sem_dados'; throw e; }
    if (!r.ok) throw new Error('Não consegui baixar os dados (HTTP ' + r.status + ').');
    return r.json();
  }

  // acesso perdido: tira do aparelho as cópias cifradas (dados.json e dias)
  async function apagarCopia() {
    dias.clear();
    if (!('caches' in window)) return;
    try {
      await caches.delete(CACHE_HIST);
      for (const k of await caches.keys()) {
        if (!k.startsWith('co-ura-atend-v')) continue;
        const c = await caches.open(k);
        for (const req of await c.keys()) if (new URL(req.url).pathname.endsWith('/dados.json')) await c.delete(req);
      }
    } catch (e) { /* sem cache: nada a apagar */ }
  }

  // dias que saíram da publicação (139 dias, ou chave trocada): fora do cache
  async function podarCache() {
    if (!('caches' in window) || !cont) return;
    try {
      const quer = new Set(Object.values(cont.hist.dias || {}).map(p => new URL(p, location.href).href));
      const c = await caches.open(CACHE_HIST);
      for (const req of await c.keys()) if (!quer.has(req.url)) await c.delete(req);
    } catch (e) { /* segue */ }
  }

  async function carregar() {
    cred = await K.lerCredHub();
    if (!cred) { cont = null; await apagarCopia(); return telaAviso('Entre pelo HUB',
      'Este app abre com o login do HUB dos apps. Entre no HUB com sua matrícula e chave e toque no atalho da URA Atendimento.', true); }
    let pacote;
    try { pacote = await baixar(); }
    catch (e) {
      if (cont) return marcarOffline(true);
      return telaAviso(e.code === 'sem_dados' ? 'Sem dados ainda' : 'Sem conexão', e.message, false);
    }
    if (pacote.gerado_em && pacote.gerado_em === gerado && cont) { marcarOffline(false); return desenhar(); }
    try {
      const idAntes = cont && cont.hist && cont.hist.id;
      const r = await K.abrir(pacote, cred);
      cont = r.conteudo; chaveHist = r.chaveHist; gerado = pacote.gerado_em || null;
      if (idAntes && idAntes !== cont.hist.id) dias.clear();
    } catch (e) {
      if (e.code === 'sem_acesso') { cont = null; await apagarCopia(); return telaAviso('Sem acesso', e.message, true); }
      return telaAviso('Não deu para abrir', e.message, false);
    }
    marcarOffline(false);
    podarCache();
    desenhar();
  }

  const disponiveis = () => Object.keys((cont && cont.hist && cont.hist.dias) || {}).sort();

  function dia(iso) {
    if (dias.has(iso)) return Promise.resolve(dias.get(iso));
    if (baixando.has(iso)) return baixando.get(iso);
    const caminho = cont && cont.hist.dias[iso];
    if (!caminho) return Promise.resolve(null);
    const p = fetch(caminho).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(arq => K.abrirDia(arq, chaveHist))
      .then(d => { dias.set(iso, d); return d; })
      .catch(() => null)
      .finally(() => baixando.delete(iso));
    baixando.set(iso, p);
    return p;
  }

  // dias que a tela pede: quando chegarem, desenha de novo
  function pedir(lista) {
    const faltam = lista.filter(i => !dias.has(i));
    if (!faltam.length) return true;
    Promise.all(faltam.map(dia)).then(() => desenhar());
    return false;
  }

  function marcarOffline(on) {
    const n = $('offline');
    n.hidden = !on;
    n.textContent = on ? 'Sem conexão: mostrando os últimos dados abertos.' : '';
  }

  // ---------- telas ----------
  function telaAviso(titulo, texto, comHub) {
    $('nav').hidden = true;
    $('sub').textContent = '';
    $('conteudo').innerHTML = `<div class="aviso-tela"><div class="ic" aria-hidden="true">🎧</div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      ${comHub ? `<a class="bt" href="${esc(HUB_URL)}">Abrir o HUB</a>` : '<button type="button" class="bt" id="btTentar">Tentar de novo</button>'}</div>`;
    const t = $('btTentar');
    if (t) t.onclick = () => carregar();
    $('rodape').textContent = 'v' + APP_VERSION;
  }

  const recorte = extra => Object.assign({ filtro: est.filtro }, extra || {});
  const soVolume = () => est.filtro === 'TEL';

  function chip(atual, ref, tipo) {
    // tipo 'vol' = variação em %; 'pp' = diferença em pontos; 'tempo' = variação em %
    if (atual == null || ref == null) return '';
    let txt, cls;
    if (tipo === 'pp') {
      const d = atual - ref;
      txt = (d > 0 ? '+' : d < 0 ? '−' : '') + String(Math.abs(Math.round(d * 10) / 10)).replace('.', ',') + ' p.p.';
      cls = Math.abs(d) < 1 ? 'estavel' : (d > 0 ? 'alta' : 'baixa');
    } else {
      const v = C.variacao(atual, ref);
      if (v == null) return '';
      txt = (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.abs(Math.round(v * 10) / 10)).replace('.', ',') + '%';
      cls = Math.abs(v) < 5 ? 'estavel' : (v > 0 ? 'alta' : 'baixa');
    }
    return `<span class="var ${cls}">${esc(txt)}</span>`;
  }

  const card = (nome, valor, extra, destaque) =>
    `<div class="cA${destaque ? ' destaque' : ''}"><span class="n">${esc(nome)}</span><span class="v num">${valor}</span>${extra ? `<span class="l">${extra}</span>` : ''}</div>`;

  function seletores() {
    const f = ['total', 'CO', 'TEL'].map(v => `<button type="button" data-filtro="${v}" aria-pressed="${est.filtro === v}">${v === 'total' ? 'Total' : v}</button>`).join('');
    return `<div class="filtros"><div class="alterna" role="group" aria-label="Recorte">${f}</div></div>`;
  }

  function desenhar() {
    if (!cont) return;
    const ag = cont.agora;
    const fresco = ag && minutosDesde(ag.em) <= FRESCO_MIN;
    $('sub').innerHTML = ag ? `<span class="vivo${fresco ? '' : ' parado'}" aria-hidden="true"></span> Pulse às ${esc(horaDe(ag.em))}`
      : '<span class="vivo parado" aria-hidden="true"></span> Sem leitura do Pulse';
    $('nav').hidden = false;
    $('nav').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aba === est.aba)));
    $('conteudo').innerHTML = seletores() + (est.aba === 'agora' ? telaAgora() : telaHist());
    ligar();
    $('rodape').textContent = `Publicado às ${horaDe(gerado)} · v${APP_VERSION}` + (cred && cred.matricula ? ` · entrou pelo HUB (${cred.matricula})` : '');
  }

  // ----- AGORA -----
  function telaAgora() {
    const hoje = cont.hoje, trad = cont.trad, sel = recorte();
    const isoHoje = (hoje && hoje.dia) || isoDe(new Date());
    const ate = hoje && hoje.h && hoje.h.length ? C.minutos(hoje.h[hoje.h.length - 1]) + 15 : null;
    const refs = C.diasReferencia(isoHoje, disponiveis());
    const prontos = pedir(refs);
    const a = C.agora(cont.agora, trad, sel);
    const kh = C.kpis(C.total(hoje, trad, sel));
    const km = prontos && refs.length ? C.kpis(C.media(refs.map(r => C.total(dias.get(r), trad, sel, ate)).filter(Boolean))) : null;
    const legRef = refs.length ? `vs média das ${refs.length} últimas ${semanaDe(isoHoje)} até ${ate != null ? C.hhmm(ate) : 'agora'}` : 'sem histórico para comparar';
    let h = '';
    if (cont.aviso) h += `<div class="faixa">${esc(cont.aviso)}</div>`;
    if (!a) h += '<div class="faixa">Sem leitura do Genesys Pulse: os números de agora não chegaram.</div>';
    h += `<section class="secA"><h3>Agora <span>${a ? 'Pulse às ' + esc(horaDe(cont.agora.em)) : ''}</span></h3><div class="gradeA">`;
    if (soVolume()) {
      h += card('Oferecidas hoje', fNum(a ? a.of : kh.of), chip(kh.of, km && km.of, 'vol'), true);
      h += '</div><p class="nota">TEL: só o volume (no histórico toda chamada da TEL vem como abandonada).</p>';
    } else {
      h += card('Em espera (CO)', fNum(a && a.fila), a && a.maisAntiga ? `mais antiga ${fTempo(a.maisAntiga)}` : '', true);
      h += card('Oferecidas hoje', fNum(a ? a.of : kh.of), chip(kh.of, km && km.of, 'vol'));
      h += card('Atendidas (CO)', fNum(a ? a.at : kh.at), chip(kh.at, km && km.at, 'vol'));
      h += card('NS 300s', fPct(a ? a.ns300 : kh.ns300), chip(kh.ns300, km && km.ns300, 'pp'));
      h += card('% Abandono', fPct(a ? a.pctAb : kh.pctAb), chip(kh.pctAb, km && km.pctAb, 'pp'));
      h += card('TMA', fTempo(a ? a.tma : kh.tma), chip(kh.tma, km && km.tma, 'tempo'));
      h += card('TME', fTempo(a && a.tme), '');
      h += card('Agentes', a && a.logados != null ? `${fNum(a.logados)}<small> / ${fNum(a.disponiveis)} disp.</small>` : '—', 'o maior de uma fila');
      h += '</div>';
    }
    h += `<p class="leg-ref">${esc(legRef)}${prontos || !refs.length ? '' : ' · carregando…'}</p></section>`;
    h += grafico(hoje, refs, ate, `Hoje × média das ${semanaDe(isoHoje)}`);
    h += listaGrupos(hoje, null, true);
    return h;
  }

  // ----- HISTÓRICO -----
  function telaHist() {
    const lista = disponiveis().slice(-DIAS_NAVEGAVEIS);
    if (!lista.length) return '<section class="secA"><p class="vazio">O histórico ainda não foi publicado.</p></section>';
    if (!est.dia || !lista.includes(est.dia)) est.dia = lista[lista.length - 1];
    const i = lista.indexOf(est.dia);
    const refs = C.diasReferencia(est.dia, disponiveis());
    const pronto = pedir([est.dia].concat(refs));
    let h = `<div class="navdia"><button type="button" class="ib2" data-dia="${esc(lista[i - 1] || '')}" ${i > 0 ? '' : 'disabled'} aria-label="Dia anterior">‹</button>
      <label class="dsel"><span class="num">${esc(diaBR(est.dia))}</span><select id="selDia" aria-label="Escolher o dia">${lista.slice().reverse().map(d =>
        `<option value="${d}"${d === est.dia ? ' selected' : ''}>${esc(diaBR(d))}</option>`).join('')}</select></label>
      <button type="button" class="ib2" data-dia="${esc(lista[i + 1] || '')}" ${i < lista.length - 1 ? '' : 'disabled'} aria-label="Dia seguinte">›</button></div>`;
    const d = dias.get(est.dia);
    if (!d) return h + `<section class="secA"><p class="vazio">${pronto ? 'Não consegui abrir este dia.' : 'Abrindo o dia…'}</p></section>`;
    const trad = cont.trad, sel = recorte();
    const k = C.kpis(C.total(d, trad, sel));
    const refsOk = refs.filter(r => dias.has(r));
    const km = refsOk.length ? C.kpis(C.media(refsOk.map(r => C.total(dias.get(r), trad, sel)))) : null;
    h += `<section class="secA"><h3>${esc(diaBR(est.dia))} <span>${refsOk.length ? `vs média das ${refsOk.length} ${semanaDe(est.dia)} anteriores` : 'sem semanas anteriores'}</span></h3><div class="gradeA">`;
    h += card('Oferecidas', fNum(k.of), chip(k.of, km && km.of, 'vol'), true);
    if (soVolume()) h += '</div><p class="nota">TEL: só o volume.</p>';
    else {
      h += card('Atendidas (CO)', fNum(k.at), chip(k.at, km && km.at, 'vol'));
      h += card('Abandonadas (CO)', fNum(k.ab), chip(k.ab, km && km.ab, 'vol'));
      h += card('NS 300s', fPct(k.ns300), chip(k.ns300, km && km.ns300, 'pp'));
      h += card('% Abandono', fPct(k.pctAb), chip(k.pctAb, km && km.pctAb, 'pp'));
      h += card('TMA', fTempo(k.tma), chip(k.tma, km && km.tma, 'tempo'));
      h += card('TME', fTempo(k.tme), chip(k.tme, km && km.tme, 'tempo'));
      h += card('Maior fila', fNum(k.fi), k.em ? `espera mais longa ${fTempo(k.em)}` : '');
      h += '</div>';
    }
    h += '</section>';
    h += grafico(d, refsOk, null, `${diaBR(est.dia)} × média das ${semanaDe(est.dia)}`);
    h += listaGrupos(d, null, false);
    h += tabelaPeriodos(d);
    return h;
  }

  // ----- gráfico (barras = o dia; linha = média das semanas) -----
  const METRICAS = { of: 'Oferecidas', ns: 'NS 300s', fi: 'Fila' };
  function valorMetrica(p, m) {
    if (!p) return null;
    const k = C.kpis(p);
    return m === 'of' ? k.of : m === 'ns' ? k.ns300 : k.fi;
  }

  function grafico(diaObj, refs, ate, titulo) {
    const trad = cont.trad, sel = recorte(), g = est.gran;
    const m = soVolume() ? 'of' : est.metrica;
    const ps = C.periodos(C.blocos(diaObj, trad, sel, ate), g, ate);
    const refsOk = refs.filter(r => dias.has(r));
    const med = C.mediaPorPeriodo(refsOk.map(r => C.periodos(C.blocos(dias.get(r), trad, sel), g)));
    const inicios = new Set(ps.map(p => p.inicio));
    med.forEach((_, k) => inicios.add(k));
    const eixo = [...inicios].sort((a, b) => a - b);
    const metr = soVolume() ? '' : `<div class="alterna" role="group" aria-label="Indicador">${Object.keys(METRICAS).map(k =>
      `<button type="button" data-metrica="${k}" aria-pressed="${m === k}">${METRICAS[k]}</button>`).join('')}</div>`;
    const grans = `<div class="alterna" role="group" aria-label="Período">${[15, 30, 60].map(v =>
      `<button type="button" data-gran="${v}" aria-pressed="${g === v}">${v === 60 ? '1 h' : v + ' min'}</button>`).join('')}</div>`;
    let h = `<section class="secA tg"><h3>${esc(titulo)}</h3><div class="ctrl">${metr}${grans}</div>`;
    if (!eixo.length) return h + '<p class="vazio">Sem chamadas neste recorte.</p></section>';
    const porIni = new Map(ps.map(p => [p.inicio, p]));
    const val = eixo.map(k => valorMetrica(porIni.get(k), m));
    const ref = eixo.map(k => valorMetrica(med.get(k), m));
    const max = m === 'ns' ? 100 : C.escala(Math.max(1, ...val.filter(v => v != null), ...ref.filter(v => v != null)));
    const W = 340, H = 150, E = 30, B = 18, T = 8, lw = (W - E - 4) / eixo.length;
    const y = v => T + (H - T - B) * (1 - v / max);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(METRICAS[m])} por período">`;
    [0, 0.5, 1].forEach(f => { const yy = y(max * f); svg += `<line x1="${E}" x2="${W - 2}" y1="${yy}" y2="${yy}" class="grade"/><text x="${E - 4}" y="${yy + 3}" text-anchor="end">${esc(m === 'ns' ? Math.round(max * f) + '%' : fNum(max * f))}</text>`; });
    val.forEach((v, i) => {
      if (v == null) return;
      const x = E + i * lw + lw * 0.15, yy = y(v);
      svg += `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${(lw * 0.7).toFixed(1)}" height="${Math.max(0, H - B - yy).toFixed(1)}" rx="1.5" class="barra${est.sel === eixo[i] ? ' sel' : ''}"/>`;
    });
    const pts = ref.map((v, i) => v == null ? null : `${(E + i * lw + lw / 2).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean);
    if (pts.length > 1) svg += `<polyline points="${pts.join(' ')}" class="linha"/>`;
    const passo = Math.max(1, Math.ceil(eixo.length / 6));
    eixo.forEach((k, i) => { if (i % passo === 0) svg += `<text x="${(E + i * lw + lw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${C.hhmm(k)}</text>`; });
    svg += `<rect x="${E}" y="0" width="${W - E}" height="${H}" fill="transparent" data-toque="${eixo.join(',')}" data-e="${E}" data-w="${W}"/></svg>`;
    h += svg + `<div class="leg"><span><i class="br"></i>${esc(diaObj === cont.hoje ? 'hoje' : 'o dia')}</span>${refsOk.length ? `<span><i class="ln"></i>média (${refsOk.length} sem.)</span>` : ''}</div>`;
    const s = est.sel != null && eixo.includes(est.sel) ? est.sel : null;
    h += s == null ? '<p class="toque">Toque no gráfico para ver o período.</p>'
      : `<p class="toque num">${C.hhmm(s)}: ${esc(METRICAS[m])} ${m === 'ns' ? fPct(valorMetrica(porIni.get(s), m)) : fNum(valorMetrica(porIni.get(s), m))} · média ${m === 'ns' ? fPct(valorMetrica(med.get(s), m)) : fNum(valorMetrica(med.get(s), m))}</p>`;
    return h + '</section>';
  }

  // ----- grupos (abre para ver as skills) -----
  function linhaKpi(k, filaAgora) {
    if (soVolume()) return `<span class="num">${fNum(k.of)}</span>`;
    return `<span class="num">${fNum(k.of)}</span><span class="num">${fPct(k.ns300)}</span><span class="num">${fPct(k.pctAb)}</span><span class="num">${fNum(filaAgora != null ? filaAgora : k.fi)}</span>`;
  }

  function listaGrupos(diaObj, ate, comAgora) {
    const trad = cont.trad, sel = recorte();
    const gs = C.grupos(diaObj, trad, sel, ate);
    const titulo = trad && trad.colunas && trad.colunas[0] ? String(trad.colunas[0]).replace(/_/g, ' ').toLowerCase() : 'grupo';
    let h = `<section class="secA"><h3>Por ${esc(titulo)} <span>toque para ver as skills</span></h3>`;
    if (!gs.length) return h + '<p class="vazio">Sem chamadas neste recorte.</p></section>';
    const cab = soVolume() ? '<span>Ofer.</span>' : `<span>Ofer.</span><span>NS</span><span>Aband.</span><span>${comAgora ? 'Espera' : 'Maior fila'}</span>`;
    h += `<div class="gl cab${soVolume() ? ' v1' : ''}"><span></span>${cab}</div>`;
    for (const g of gs) {
      const aberto = est.abertos.has(g.grupo);
      const fa = comAgora ? (C.agora(cont.agora, trad, recorte({ grupo: g.grupo })) || {}).fila : null;
      h += `<button type="button" class="gl${soVolume() ? ' v1' : ''}" data-grupo="${esc(g.grupo)}" aria-expanded="${aberto}"><span class="gn">${aberto ? '▾' : '▸'} ${esc(g.grupo)}</span>${linhaKpi(g.k, fa)}</button>`;
      if (aberto) for (const s of g.skills) {
        const fs = comAgora ? (C.agora(cont.agora, trad, recorte({ grupo: g.grupo, skill: s.skill })) || {}).fila : null;
        h += `<div class="gl sk${soVolume() ? ' v1' : ''}"><span class="gn" title="${esc(s.skill)}">${esc(C.curto(s.skill))}</span>${linhaKpi(s.k, fs)}</div>`;
      }
    }
    return h + '</section>';
  }

  // ----- tabela por período (histórico) -----
  function tabelaPeriodos(d) {
    const ps = C.periodos(C.blocos(d, cont.trad, recorte()), est.gran);
    if (!ps.length) return '';
    const v = soVolume();
    let h = `<section class="secA"><h3>Por período <span>${est.gran === 60 ? '1 h' : est.gran + ' min'} · fila = último retrato</span></h3><div class="tab"><table><thead><tr><th>Início</th><th>Ofer.</th>`;
    if (!v) h += '<th>Atend.</th><th>NS</th><th>Aband.</th><th>TMA</th><th>TME</th><th>Fila</th><th>Espera máx.</th>';
    h += '</tr></thead><tbody>';
    for (const p of ps) {
      const k = C.kpis(p);
      h += `<tr><td>${esc(p.rotulo)}</td><td>${fNum(k.of)}</td>`;
      if (!v) h += `<td>${fNum(k.at)}</td><td>${fPct(k.ns300)}</td><td>${fPct(k.pctAb)}</td><td>${fTempo(k.tma)}</td><td>${fTempo(k.tme)}</td><td>${fNum(k.fi)}</td><td>${fTempo(k.em)}</td>`;
      h += '</tr>';
    }
    return h + '</tbody></table></div></section>';
  }

  // ---------- eventos ----------
  function ligar() {
    const raiz = $('conteudo');
    raiz.querySelectorAll('[data-filtro]').forEach(b => b.onclick = () => { est.filtro = b.dataset.filtro; est.sel = null; desenhar(); });
    raiz.querySelectorAll('[data-gran]').forEach(b => b.onclick = () => { est.gran = Number(b.dataset.gran); est.sel = null; desenhar(); });
    raiz.querySelectorAll('[data-metrica]').forEach(b => b.onclick = () => { est.metrica = b.dataset.metrica; desenhar(); });
    raiz.querySelectorAll('[data-grupo]').forEach(b => b.onclick = () => {
      const g = b.dataset.grupo;
      if (est.abertos.has(g)) est.abertos.delete(g); else est.abertos.add(g);
      desenhar();
    });
    raiz.querySelectorAll('[data-dia]').forEach(b => b.onclick = () => { if (b.dataset.dia) { est.dia = b.dataset.dia; est.sel = null; desenhar(); } });
    const s = $('selDia');
    if (s) s.onchange = () => { est.dia = s.value; est.sel = null; desenhar(); };
    const alvo = raiz.querySelector('[data-toque]');
    if (alvo) {
      const lista = alvo.dataset.toque.split(',').map(Number);
      alvo.onclick = ev => {
        const svg = alvo.ownerSVGElement, r = svg.getBoundingClientRect();
        const W = Number(alvo.dataset.w), E = Number(alvo.dataset.e);
        const x = (ev.clientX - r.left) * W / r.width;
        const i = Math.min(lista.length - 1, Math.max(0, Math.floor((x - E) / ((W - E - 4) / lista.length))));
        est.sel = est.sel === lista[i] ? null : lista[i];
        desenhar();
      };
    }
  }

  $('nav').querySelectorAll('button').forEach(b => b.onclick = () => { est.aba = b.dataset.aba; est.sel = null; desenhar(); window.scrollTo(0, 0); });
  $('btAtualizar').onclick = () => carregar();

  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
  setInterval(() => { if (!document.hidden) carregar(); }, CONFERIR_MS);

  // versões diferentes (cache do celular com arquivos de versões misturadas): recarrega até baterem
  if (K.VERSAO !== APP_VERSION) {
    if (!sessionStorage.getItem('co-ura-atend-recarregou')) { sessionStorage.setItem('co-ura-atend-recarregou', '1'); location.reload(); }
  } else sessionStorage.removeItem('co-ura-atend-recarregou');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sem offline */ });
  carregar();
})();
