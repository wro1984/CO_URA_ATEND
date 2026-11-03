/* URA · Suporte B2C — telas (Agora, Evolução, Skills), leitura dos dados e atualização automática.
 * PRODUÇÃO (CO_URA_ATEND): os dados vêm do fonte.js (login do HUB e arquivos cifrados do MAPI), no MESMO formato do
 * pulse.json e do historico.csv da homologação. Nada aberto é guardado no aparelho (sem a cópia no localStorage). */
(function () {
  'use strict';
  const APP_VERSION = '2.0.0';
  const D = window.Dados, G = window.Graf, Hs = window.Historico, F = window.URAFonte;
  const HUB_URL = new URL('/', location.href).href;

  // ---------------------------------------------------------------- configuração
  const META_NS = 90;          // meta do NS (%) — mesma do painel de Nível de Serviço do B2C
  const LIM_ATENCAO = 70;      // abaixo da meta e acima disto: "Em atenção"; abaixo: "Crítico"
  const PARAM = new URLSearchParams(location.search);
  const HIST_RECARGA_MIN = 60;                          // o histórico muda uma vez por dia: confere a cada 1 h
  const CK = 'ura-b2c:';                                // prefixo das chaves no localStorage
  const ATRASO_MIN = 15;                                // sem coleta nova há mais que isto (no expediente): aviso
  const STATUS = { VERDE: 'Meta atingida', AMARELO: 'Em atenção', VERMELHO: 'Crítico' };
  const PASSO_NOME = { auto: 'Auto', 15: '15 min', 30: '30 min', 60: '1 h', 120: '2 h' };
  const DS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DS_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];

  // ---------------------------------------------------------------- estado
  let dados = null;            // dados normalizados em uso (sempre o último arquivo VÁLIDO)
  let origem = '';             // 'site' | 'copia' | 'arquivo'
  let nomeArq = '';
  let erroFonte = null;        // falha ao ler do site (rede/HTTP)
  let erroDados = null;        // arquivo recebido com problema (estrutura)
  let carregando = false;
  let pagina = 'alarmes';
  let hist = null;             // histórico lido (Historico.parse) — o último VÁLIDO
  let histErro = null;         // falha ao ler/entender o historico.csv
  let histCarregando = false;
  let histEm = 0;              // quando o histórico foi conferido pela última vez (ms)
  let histOrigem = '';         // 'site' | 'arquivo'
  let filaErro = null;         // historico_fila.csv ausente ou com problema (o app segue sem a fila nos dias do histórico)
  // modo: 'int' = por intervalo (padrão, sempre ao abrir) | 'acum' = acumulado do dia
  // ctl: controles da Evolução abertos (começam sempre recolhidos)
  // fixo: controles + faixa de grupos presos no topo ao rolar (escolha lembrada no aparelho; só se troca com os controles abertos)
  // dia: null = o mais recente (ao vivo) | 'aaaa-mm-dd' = dia escolhido na navegação
  // cmp: comparação pela mediana — 'sem' (7 mesmos dias da semana, padrão) | 'dias' (7 dias corridos); lembrada no aparelho.
  //      Fica sempre ligada quando há histórico (área clara atrás das barras).
  // Ao abrir o app, a Evolução começa SEMPRE nas primeiras opções (as da esquerda): Total URA · Por intervalo · Auto.
  // skill: filtro por skill (nome simplificado da tradutora), escolhido no painel "Grupos e skills"
  // abertos: grupos expandidos no painel (só enquanto o app está aberto)
  // vista: 'hora' (eixo = horários do dia) | 'dia' (eixo = dias; cada coluna é um dia inteiro)
  // ndias: quantos dias no eixo da vista por dia (7 a 13; começa em 7; a escolha fica lembrada no aparelho)
  const evo = { ndias: Math.min(13, Math.max(7, +lerPref('ndias', 7) || 7)), vista: 'hora', skill: null, abertos: new Set(), dir: 'TODOS', passo: 'auto', grupo: null, sel: null, modo: 'int', menu: null,
    dia: null, cmp: ['dias', 'sem', 'off'].includes(lerPref('cmp', 'sem')) ? lerPref('cmp', 'sem') : 'sem' };
  const sk = { dir: 'TODOS', q: '', zeros: false };
  // aba Agora: filtro do painel de grupos (grupo/skill), grupos abertos e coluna selecionada nos gráficos da hora
  // dir: atendimento escolhido nos botões do topo (começa sempre em Total URA, como a Evolução)
  const ag = { tabTudo: false, dir: 'TODOS', grupo: null, skill: null, abertos: new Set(), sel: null };
  let agCols = [];
  let evoCols = [];  // colunas em exibição na Evolução (horários ou dias), para o toque nas colunas e na tabela   // colunas da hora em exibição na aba Agora (para o toque nas colunas)

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fI = D.fmtInt, fP = D.fmtPct, fS = D.fmtSeg;
  function lerPref(k, def) { try { const v = localStorage.getItem(CK + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function gravarPref(k, v) { try { localStorage.setItem(CK + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento: segue sem lembrar */ } }

  const situacao = ns => ns == null ? null : (Math.round(ns * 10) / 10 >= META_NS ? 'VERDE' : ns >= LIM_ATENCAO ? 'AMARELO' : 'VERMELHO');
  const corSit = s => s === 'VERDE' ? 'var(--verdeS)' : s === 'AMARELO' ? 'var(--amareloS)' : s === 'VERMELHO' ? 'var(--vermelhoS)' : 'var(--grid)';
  const ddmmaaaa = dia => dia.split('-').reverse().join('/');
  const hojeISO = () => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); };
  const rotPasso = (m, passo) => passo >= 60 ? D.hhmm(m).slice(0, 2) + 'h' : D.hhmm(m);
  const ewtTx = s => s == null ? '—' : s >= D.EWT_SEM_AGENTE ? 'sem agente' : fS(s);

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------------------------------------------------------------- leitura
  // aplica um texto JSON; se não servir, NÃO troca os dados em uso (lança o erro para quem chamou)
  function aplicarTexto(txt, org, nome) {
    let raw;
    try { raw = JSON.parse(txt); } catch (e) { throw new Error('o arquivo não é um JSON válido'); }
    const d = D.normalizar(raw);
    dados = d; origem = org; nomeArq = nome || ''; erroDados = null;
    if (evo.sel != null && !d.leituras.length) evo.sel = null;
  }
  // produção: a cópia para usar sem rede é o dados.json CIFRADO no cache do service worker (o fonte.js abre de novo).
  // Apaga a cópia aberta que a versão de homologação guardava no aparelho, se houver.
  function usarCopia() {
    try { localStorage.removeItem(CK + 'ultimo'); localStorage.removeItem(CK + 'ultimoNome'); } catch (e) { /* segue */ }
  }
  // sem login do HUB neste aparelho ou sem o app no perfil: tela própria, sem dados
  let semAcesso = null;
  function telaAcesso(titulo, texto) {
    semAcesso = { titulo, texto };
    dados = null; hist = null;
    ['alarmes', 'agora', 'evo', 'skills'].forEach(p => { $('#pg' + p[0].toUpperCase() + p.slice(1)).hidden = true; });
    $('#banners').innerHTML = ''; $('#tabs').hidden = true;
    const pg = $('#pgAcesso'); pg.hidden = false;
    pg.innerHTML = `<div class="card vazio"><p><b>${esc(titulo)}</b><br>${esc(texto)}</p><a class="bt" href="${esc(HUB_URL)}">Abrir o HUB</a></div>`;
    const dot = $('#syncDot'), tx = $('#syncTx'); if (dot) dot.className = 'dot err'; if (tx) tx.textContent = titulo;
  }
  async function carregar(manual) {
    if (carregando) return;
    carregando = true; $('#btRefresh').classList.add('spin');
    try {
      let obj;
      try { obj = await F.pulse(); }
      catch (e) {
        if (e.code === 'sem_cred') { carregando = false; $('#btRefresh').classList.remove('spin'); return telaAcesso('Entre pelo HUB', 'Este app abre com o login do HUB dos apps. Entre no HUB com sua matrícula e chave e toque no atalho do app.'); }
        if (e.code === 'sem_acesso') { carregando = false; $('#btRefresh').classList.remove('spin'); return telaAcesso('Sem acesso', e.message); }
        throw Object.assign(new Error(e.message), { rede: true });
      }
      if (semAcesso) { semAcesso = null; $('#pgAcesso').hidden = true; $('#tabs').hidden = false; }
      try { aplicarTexto(JSON.stringify(obj), 'site', ''); erroFonte = null; }
      catch (e) { erroDados = e.message; erroFonte = null; }
      if (manual) toast(erroDados ? 'Os dados novos têm problema — mantidos os últimos dados válidos.' : 'Dados atualizados.');
    } catch (e) {
      erroFonte = e.rede ? e.message : 'sem conexão com o site';
      if (manual) toast('Não consegui atualizar: ' + erroFonte + '.');
    } finally {
      carregando = false; $('#btRefresh').classList.remove('spin');
      if (!semAcesso) render();
    }
  }
  // Histórico: baixado no início e conferido a cada 1 h (o arquivo muda uma vez por dia). Se o arquivo novo vier com
  // problema, continua o último válido. Sem histórico o app funciona igual, só sem navegação e comparação.
  async function carregarHist(forcar) {
    if (histCarregando || histOrigem === 'arquivo' || !Hs) return;
    if (!forcar && hist && Date.now() - histEm < HIST_RECARGA_MIN * 60000) return;
    histCarregando = true;
    try {
      if (semAcesso) return;
      const txt = await F.historico();          // os dias cifrados do MAPI, remontados no formato do historico.csv
      const novo = Hs.parse(txt);
      filaErro = null;   // a fila vem nas colunas FILA e ESPERA_MAX_S de cada dia
      hist = novo; histErro = null; histOrigem = 'site';
    } catch (e) {
      histErro = e.message || 'falha ao ler o histórico';
    } finally {
      histCarregando = false; histEm = Date.now();
      if (semAcesso) return;
      if (dados && pagina !== 'skills') redesenhar(); else renderBanners();   // Evolução e Agora usam o histórico (previsto)
    }
  }
  function abrirArquivo(file) {
    const fr = new FileReader();
    const csv = /\.(csv|txt)$/i.test(file.name);
    fr.onload = () => {
      if (csv && Hs.ehFila(fr.result)) {
        // fila do histórico aberta do aparelho: liga ao histórico em uso
        if (!hist) { toast('Abra primeiro o histórico; a fila é um complemento dele.'); return; }
        if (hist.colsFila) { toast('Este histórico já traz a fila nas colunas FILA e ESPERA_MAX_S.'); return; }
        try { const F = Hs.parseFila(String(fr.result)); Hs.anexarFila(hist, F); filaErro = null; toast(`Fila do histórico aberta: ${ddmmaaaa(F.inicio)} a ${ddmmaaaa(F.fim)}.`); }
        catch (e) { toast('Este arquivo da fila não serve: ' + e.message + '.'); }
        return render();
      }
      if (csv) {
        // arquivo do histórico aberto do aparelho (para testes): vale até recarregar o app
        try { const F = hist && hist.fila; hist = Hs.parse(String(fr.result)); histErro = null; histOrigem = 'arquivo'; if (F && !hist.colsFila) Hs.anexarFila(hist, F); evo.dia = null; toast(`Histórico aberto: ${hist.lista.length} dias (${ddmmaaaa(hist.inicio)} a ${ddmmaaaa(hist.fim)}).`); }
        catch (e) { toast('Este histórico não serve: ' + e.message + '.'); }
        return render();
      }
      try { aplicarTexto(String(fr.result), 'arquivo', file.name); erroFonte = null; toast('Arquivo aberto: ' + file.name); }
      catch (e) { toast('Este arquivo não serve: ' + e.message + '.'); }
      render();
    };
    fr.onerror = () => toast('Não consegui ler o arquivo.');
    fr.readAsText(file);
  }

  // ---------------------------------------------------------------- topo e avisos
  function ultima() { return dados.leituras[dados.leituras.length - 1]; }
  function minutosDesde(ms) { return ms == null ? null : Math.round((Date.now() - ms) / 60000); }
  function atrasado() {
    if (!dados || dados.dia !== hojeISO()) return null;
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    if (m < D.INICIO || m > D.FIM + 10) return null;
    const L = ultima(), min = minutosDesde(L.col);
    return min != null && min > ATRASO_MIN ? min : null;
  }
  function renderSync() {
    const dot = $('#syncDot'), tx = $('#syncTx');
    if (!dados) { dot.className = 'dot ' + (erroFonte ? 'err' : ''); tx.textContent = erroFonte ? 'Sem dados' : 'Carregando…'; return; }
    const L = ultima(), hoje = dados.dia === hojeISO();
    const min = minutosDesde(L.col);
    let t = (hoje ? 'Coleta das ' : 'Coleta de ' + ddmmaaaa(dados.dia).slice(0, 5) + ' às ') + L.horario;
    if (hoje && min != null && min >= 0) t += min < 1 ? ' · agora' : ' · há ' + (min < 60 ? min + ' min' : Math.floor(min / 60) + 'h' + String(min % 60).padStart(2, '0'));
    tx.textContent = t;
    dot.className = 'dot ' + (origem === 'arquivo' ? 'off' : erroFonte || erroDados ? 'err' : !hoje || atrasado() ? 'off' : 'live');
  }
  // Avisos laranja do topo podem ser fechados no X. Fica fechado enquanto o motivo for o mesmo
  // (mesmo dia dos dados, mesma última coleta, mesmo erro); se o motivo mudar, o aviso volta.
  // Vale até o app ser fechado. O aviso vermelho (arquivo com problema) não fecha.
  const avisosFechados = new Set();
  const aviso = (chave, html) => avisosFechados.has(chave) ? '' :
    `<div class="banner warn bx"><span>${html}</span><button class="bx-x" data-fecha-aviso="${esc(chave)}" aria-label="Fechar aviso" title="Fechar aviso"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
  function renderBanners() {
    const b = [];
    if (erroDados) b.push(`<div class="banner bad"><b>O arquivo recebido tem problema:</b> ${esc(erroDados)}. ${dados ? 'Continuo mostrando os últimos dados válidos (coleta das ' + esc(ultima().horario) + ').' : ''}</div>`);
    if (erroFonte && origem !== 'arquivo') b.push(aviso('fonte:' + erroFonte, `Não consegui ler os dados do site (${esc(erroFonte)}).${dados ? ' Mostrando a última cópia guardada no aparelho.' : ''}`));
    if (origem === 'arquivo') b.push(`<div class="banner info">Mostrando o arquivo <b>${esc(nomeArq)}</b> aberto do aparelho. A atualização automática fica pausada; toque em ↻ para voltar aos dados do site.</div>`);
    if (dados && dados.dia !== hojeISO()) b.push(aviso('dia:' + dados.dia, `Estes dados são de <b>${ddmmaaaa(dados.dia)}</b>, não de hoje.`));
    const at = atrasado();
    if (at && origem !== 'arquivo') b.push(aviso('atraso:' + dados.dia + ultima().horario, `Sem coleta nova há ${at} min. Os números podem estar desatualizados.`));
    $('#banners').innerHTML = b.filter(Boolean).join('');
    const av = (dados ? dados.avisos : []).concat(hist ? hist.avisos : []);
    $('#avisos').innerHTML = av.length ? `<div class="banner warn"><b>Avisos do arquivo</b><br>${av.map(esc).join('<br>')}</div>` : '';
    $('#footDia').textContent = dados ? ' · dados de ' + ddmmaaaa(dados.dia) : '';
  }

  // ---------------------------------------------------------------- render geral
  function render() {
    renderSync(); renderBanners(); medirTopo();
    ['alarmes', 'agora', 'evo', 'skills'].forEach(p => { $('#pg' + p[0].toUpperCase() + p.slice(1)).hidden = p !== pagina; });
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === pagina));
    if (!dados) { renderBadge(null); $('#pg' + pagina[0].toUpperCase() + pagina.slice(1)).innerHTML = vazio(); return; }
    // alarmes: avaliados em todo desenho (a bolinha da aba fica sempre em dia), desenhados só na página deles
    let resAl = null;
    try { resAl = avaliarAlarmes(); } catch (e) { console.warn('alarmes:', e); }
    renderBadge(resAl);
    if (pagina === 'alarmes') renderAlarmes(resAl);
    else if (pagina === 'agora') renderAgora();
    else if (pagina === 'evo') {
      // a faixa de grupos é redesenhada a cada atualização: guarda a rolagem para não "pular" para o início
      const fx = $('#pgEvo .chips'), antes = fx ? fx.scrollLeft : 0;
      renderEvo();
      posicionarGrupos(antes, chipAnimar); chipAnimar = false;
    }
    else renderSkills();
  }
  function vazio() {
    return `<div class="card vazio"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--p300)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-3H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1z"/></svg>
      <p>${carregando ? 'Carregando os dados…' : 'Ainda não há dados para mostrar.<br>O MAPI ainda não publicou o dia de hoje; para testar, abra um arquivo JSON da coleta.'}</p>
      <button class="bt" data-act="arq">Abrir arquivo JSON</button></div>`;
  }


  // altura do topo roxo: os controles fixados ficam presos logo abaixo dele
  function medirTopo() { const h = document.querySelector('header.top'); if (h) document.documentElement.style.setProperty('--topo', h.offsetHeight + 'px'); }

  // Faixa de grupos da Evolução: o grupo selecionado corre para a esquerda e fica como o primeiro visível;
  // sem grupo, volta para o início ("Todos os grupos"). Se o grupo estiver no fim da faixa, um respiro à direita
  // deixa ele chegar até a esquerda.
  let chipAnimar = false;
  function posicionarGrupos(de, animar) {
    const fx = $('#pgEvo .chips'); if (!fx) return;
    fx.style.paddingRight = '';
    fx.scrollLeft = de || 0;
    const sel = evo.grupo ? fx.querySelector('.chip[aria-pressed="true"]') : null;
    let alvo = 0;
    if (sel) {
      alvo = Math.max(0, fx.scrollLeft + sel.getBoundingClientRect().left - fx.getBoundingClientRect().left);
      const max = fx.scrollWidth - fx.clientWidth;
      if (alvo > max) fx.style.paddingRight = Math.ceil(alvo - max) + 'px';
    }
    const suave = animar && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    fx.scrollTo({ left: alvo, behavior: suave ? 'smooth' : 'auto' });
  }

  // larguras: quantas colunas cabem sem poluir
  function maxColunas(el) {
    const w = (el && el.clientWidth) || Math.min(760, window.innerWidth) - 56;
    return Math.max(8, Math.min(24, Math.floor(w / 27)));
  }
  // cartão de gráfico: legenda e explicações ficam escondidas atrás do botão (i), no canto inferior direito.
  // Só um aberto por vez (abrir outro fecha o anterior); o aberto continua aberto quando a tela se redesenha.
  let infoAberto = null;
  const ICONE_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><path d="M12 7.4h.01" stroke-width="2.8"/></svg>';
  // filtro: texto discreto à esquerda do (i), na mesma linha (ex.: "CO – MANOBRA"); vazio = nada
  // tot: total do período embaixo do título (valor em destaque + detalhe); det: comparação com a mediana, em letra
  // bem pequena, na linha do (i); o filtro aplicado fica embaixo dela.
  function cartaoGraf(id, titulo, svg, info, fixo, filtro, cls, tot, det) {
    const ab = infoAberto === id;
    return `<div class="card ${cls || 'chart'}" data-ch="${id}"><h2>${titulo}</h2>${tot ? `<div class="ch-tot">${tot}</div>` : ''}${svg}
      <div class="ch-pe">${fixo || ''}<div class="ch-base"><span class="ch-det">${det || ''}</span><button class="info" data-info="${id}" aria-expanded="${ab}" aria-controls="inf-${id}" aria-label="${ab ? 'Esconder' : 'Mostrar'} a explicação do gráfico" title="Explicação do gráfico">${ICONE_INFO}</button></div>${filtro ? `<div class="ch-filtro" title="Filtro aplicado">${esc(filtro)}</div>` : ''}</div>
      <div class="ch-info" id="inf-${id}"${ab ? '' : ' hidden'}>${info}</div></div>`;
  }
  function alternarInfo(id) {
    infoAberto = infoAberto === id ? null : id;
    document.querySelectorAll('button.info[data-info]').forEach(b => {
      const ab = b.dataset.info === infoAberto;
      b.setAttribute('aria-expanded', ab); b.setAttribute('aria-label', (ab ? 'Esconder' : 'Mostrar') + ' a explicação do gráfico');
      const p = document.getElementById('inf-' + b.dataset.info); if (p) p.hidden = !ab;
    });
  }
  const kpi = (l, v, s, cls, r) => `<div class="kpi${cls ? ' ' + cls : ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div>${r ? `<div class="r">${r}</div>` : ''}</div>`;
  const nsTx = (ns, cls) => ns == null ? '—' : `<span class="${cls === false ? '' : 'c-' + situacao(ns)}">${fP(ns)}</span>`;

  // ---------------------------------------------------------------- AGORA
  // Previsto da aba Agora: o dia do Pulse contra os dias anteriores do histórico (mesma chave da Evolução).
  // "Até agora" = até o mesmo minuto da última coleta, proporcional dentro do bloco de 15 min do histórico.
  function cmpAgora() {
    if (!hist || evo.cmp === 'off' || !dados) return null;
    const refs = Hs.referencias(hist, dados.dia, evo.cmp);
    if (!refs.length) return null;
    const porRef = refs.map(r => { const dR = Hs.diaComoDados(hist, r, dados.trad); return { dR, coR: D.filtro(dR, { dir: 'CO' }), telR: D.filtro(dR, { dir: 'TEL' }) }; });
    return { refs, porRef, nome: nomeCmp(dados.dia, refs.length), curto: nomeCmp(dados.dia, refs.length, true) };
  }
  const medAg = (cmp, f) => cmp ? Hs.mediana(cmp.porRef.map(f)) : null;
  const linhaMed = (cmp, r, fmt, atual, pp) => !cmp ? '' : `med. ${esc(cmp.curto)}: <b>${r == null ? '—' : fmt(r)}</b> <span class="df">${r == null ? '' : difTx(atual, r, pp)}</span>`;

  // ---------------------------------------------------------------- ALARMES (página própria, a primeira)
  // Duas visões, na chave do topo: Agora (a hora aberta — a mesma janela dos gráficos da hora) e Hoje (o dia até a
  // última coleta). Sempre o Total URA. O previsto usa a mesma chave da Evolução; com o previsto desligado, os alarmes
  // usam os mesmos dias da semana (eles não podem desligar). A página sempre abre em Agora.
  // aberto: alarme com o detalhe aberto · a configuração (alarmes desligados por visão) fica guardada no aparelho
  // filEvo: níveis marcados no filtro do resumo da Evolução (vazio = lista inteira; pode combinar mais de um)
  const al = { vista: 'agora', aberto: null, filEvo: new Set() };
  const VISTAS_AL = [['agora', 'Agora'], ['dia', 'Hoje']];
  let alCache = null;
  function metricasAlarme() {
    const d = dados, L = ultima();
    const tipo = evo.cmp === 'off' ? 'sem' : evo.cmp;
    const chave = [d.dia, L.m, L.col, d.leituras.length, nomeArq, origem, hist ? hist.lista.length + ':' + hist.inicio + ':' + hist.fim + ':' + histOrigem : '-', tipo].join('|');
    let m;
    if (alCache && alCache.k === chave && alCache.d === d && alCache.h === hist) m = alCache.m;
    else { m = calcularMetricasAlarme(d, L, tipo); alCache = { k: chave, d, h: hist, m }; }
    const n = new Date(), mm = n.getHours() * 60 + n.getMinutes();
    m.vivo = d.dia === hojeISO() && mm >= D.INICIO && mm <= D.FIM + 10;
    m.atrasoMin = m.vivo ? Math.max(0, minutosDesde(L.col) || 0) : 0;
    return m;
  }
  // sel: filtro da Evolução { dir, grupo, skill } para o resumo do dia (null = a URA inteira, como na página Alarmes)
  function calcularMetricasAlarme(d, L, tipo, sel) {
    const sk = (dd, dir) => !sel ? D.filtro(dd, { dir }) : sel.dir !== 'TODOS' && sel.dir !== dir ? [] : filtroEvo(dd, dir, sel);
    const co = sk(d, 'CO'), tel = sk(d, 'TEL'), perm = new Set(co.concat(tel));
    const refs = hist ? Hs.referencias(hist, d.dia, tipo) : [];
    const porRef = refs.map(r => { const dR = Hs.diaComoDados(hist, r, d.trad), coR = sk(dR, 'CO'), telR = sk(dR, 'TEL'); return { dR, coR, telR, todos: coR.concat(telR) }; });
    const med = f => porRef.length ? Hs.mediana(porRef.map(f)) : null;
    const cmpNome = refs.length ? refs.length + ' ' + (tipo === 'dias' ? 'dias' : DS_CURTO[Hs.diaSemana(d.dia)]) : '';
    // grupos (todos os atendimentos)
    const gmap = new Map();
    d.skills.forEach(s => { const t = d.trad[s], g = t.SKILL_GRUPO; if (!g || !perm.has(s)) return; if (!gmap.has(g)) gmap.set(g, { ss: [], dirs: new Set() }); gmap.get(g).ss.push(s); gmap.get(g).dirs.add(t.DIRECIONAMENTO); });
    // fila agora (CO), por skill
    const filas = [...porSimpl(d, 'CO').entries()].map(([nome, ss]) => ({ nome, a: D.agregar(L, ss.filter(s => perm.has(s))) })).filter(x => x.a.fila > 0).sort((x, y) => y.a.espMax - x.a.espMax || y.a.fila - x.a.fila);
    const ondeFila = filas.map(x => ({ nome: x.nome, tx: fI(x.a.fila) + ' esperando, ' + fS(x.a.espMax) }));
    // maior fila (técnicos em espera) no trecho: retratos depois do início até o fim (no histórico, o retrato no fim é proporcional)
    // dia do histórico sem a fila (fora do arquivo): sem dado de técnicos em espera
    const picoHoje = ini => d.historico && !d.temFila ? null : Math.max(0, ...d.leituras.filter(l => l.m > ini && l.m <= L.m).map(l => D.agregar(l, co).fila));
    const picoRef = (r, ini) => !r.dR.temFila ? null : Math.max(filaEm(r.dR, L.m, r.coR), ...r.dR.leituras.filter(l => l.m > ini && l.m <= L.m).map(l => D.agregar(l, r.coR).fila));
    // um trecho do dia: ini < 0 = o dia até a última coleta; senão de ini até a última coleta (a hora aberta)
    function periodo(ini) {
      const lDe = ini < 0 ? null : [...d.leituras].reverse().find(x => x.m <= ini) || null;
      const hoje = ss => ini < 0 ? D.agregar(L, ss) : D.delta(D.agregar(L, ss), D.agregar(lDe, ss));
      const ref = (dR, ss) => ini < 0 ? D.agregarEm(dR, L.m, ss) : D.intervaloEm(dR, ini, L.m, ss);
      const fin = x => x.fin != null ? x.fin : x.atend + x.aband;
      const cC = hoje(co), cT = hoje(tel);
      const telPct = (c, t) => c.ofer + t.ofer > 0 ? t.ofer / (c.ofer + t.ofer) * 100 : null;
      const grupos = [...gmap.entries()].map(([g, x]) => ({ g, dir: x.dirs.size === 1 ? [...x.dirs][0] : 'TODOS', v: hoje(x.ss).ofer,
        prev: med(r => ref(r.dR, r.todos.filter(s => r.dR.trad[s] && r.dR.trad[s].SKILL_GRUPO === g)).ofer) }));
      const porGrupo = f => [...gmap.entries()].map(([g, x]) => ({ g, v: f(x.ss.filter(s => d.trad[s].DIRECIONAMENTO === 'CO')) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
      const picos = porRef.map(r => picoRef(r, ini));
      return {
        ini: ini < 0 ? null : ini, ate: L.m, fecha: ini >= 0 && L.m >= ini + 60,
        ofer: cC.ofer + cT.ofer, oferPrev: med(r => ref(r.dR, r.coR).ofer + ref(r.dR, r.telR).ofer),
        oferPrevHora: ini < 0 ? null : med(r => D.intervaloEm(r.dR, ini, ini + 60, r.coR).ofer + D.intervaloEm(r.dR, ini, ini + 60, r.telR).ofer),
        co: { ofer: cC.ofer, fin: fin(cC), a300: cC.a300, ns: cC.ns, aband: cC.aband, abandPct: cC.abandPct, tme: cC.tme, tma: cC.tma, dir60: cC.dir60 },
        prev: { ns: med(r => ref(r.dR, r.coR).ns), aband: med(r => ref(r.dR, r.coR).aband), tme: med(r => ref(r.dR, r.coR).tme), tma: med(r => ref(r.dR, r.coR).tma),
          dir60: cC.dir60 == null ? null : med(r => ref(r.dR, r.coR).dir60) },
        // CO/TEL: só faz sentido com os dois atendimentos (sem o filtro de CO ou TEL)
        telPct: sel && sel.dir !== 'TODOS' ? null : telPct(cC, cT), telPctPrev: sel && sel.dir !== 'TODOS' ? null : med(r => telPct(ref(r.dR, r.coR), ref(r.dR, r.telR))),
        filaPico: picoHoje(ini), filaPicoPrev: picos.some(x => x != null) ? Hs.mediana(picos) : null,
        filaDiasRef: picos.filter(x => x != null && x > 0).length, filaRefs: picos.filter(x => x != null).length,
        grupos: porRef.length ? grupos : null,
        onde: {
          ns: porGrupo(ss => { const x = hoje(ss); return (ini < 0 ? x.ofer : fin(x)) - x.a300; }).map(x => ({ nome: x.g, tx: fI(x.v) + ' fora dos 5 min' })),
          aband: porGrupo(ss => hoje(ss).aband).map(x => ({ nome: x.g, tx: fI(x.v) + (x.v === 1 ? ' abandono' : ' abandonos') })),
          vol: grupos.filter(x => x.prev != null).map(x => Object.assign({ dv: x.v - x.prev }, x)).filter(x => Math.abs(x.dv) >= 1).sort((a, b) => Math.abs(b.dv) - Math.abs(a.dv))
            .map(x => ({ nome: x.g, tx: (x.dv > 0 ? '+' : '−') + fI(Math.abs(x.dv)) + ' vs. previsto' })),
          fila: ondeFila
        }
      };
    }
    // hora aberta: a mesma janela dos gráficos da hora (na virada da hora, a hora anterior)
    const desde = inicioHora(L.m);
    // skills paradas: nenhuma chamada nos últimos 60 min (só depois da primeira hora do expediente)
    const skR = (dR, ss) => { const nomes = new Set(ss.map(s => d.trad[s].SKILL_SIMPLIFICADO)); return dR.skills.filter(s => dR.trad[s] && nomes.has(dR.trad[s].SKILL_SIMPLIFICADO)); };
    let paradas = null;
    // (retrato da última hora: só no dia do Pulse; num dia fechado do histórico não se aplica)
    if (porRef.length && L.m - 60 >= D.INICIO && !d.historico) {
      paradas = [];
      porSimpl(d, 'TODOS').forEach((ss0, nome) => {
        const ss = ss0.filter(s => perm.has(s)); if (!ss.length) return;
        if (D.delta(D.agregar(L, ss), D.agregarEm(d, L.m - 60, ss)).ofer > 0) return;
        const prev = med(r => D.intervaloEm(r.dR, L.m - 60, L.m, skR(r.dR, ss)).ofer);
        if (prev != null) paradas.push({ nome, prev, dir: d.trad[ss[0]].DIRECIONAMENTO });
      });
    }
    const aC = D.agregar(L, co);
    return { horario: L.horario, cmpNome, agora: periodo(desde), dia: periodo(-1), paradas,
      // retrato da última coleta (só no Pulse; o histórico não tem agentes): num dia do histórico fica sem dado
      fila: d.historico ? { total: null, espMax: null, skillMax: '', semAgente: null }
        : { total: aC.fila, espMax: aC.espMax, skillMax: filas.length ? filas[0].nome : '', semAgente: filas.filter(x => x.a.dispMax === 0).map(x => x.nome) } };
  }
  // alarmes desligados na configuração: { agora: [tipos], dia: [tipos] }
  // evo: o resumo do dia na Evolução (configuração própria)
  function alDesligados() { const c = lerPref('alarmesDesl', null) || {}; return { agora: new Set(c.agora || []), dia: new Set(c.dia || []), evo: new Set(c.evo || []) }; }
  function gravarDesligados(c) { gravarPref('alarmesDesl', { agora: [...c.agora], dia: [...c.dia], evo: [...c.evo] }); }
  // as duas visões, avaliadas a cada desenho; o histórico do aparelho (desde, último, silenciados) é separado por visão
  function avaliarAlarmes() {
    const A = window.Alarmes;
    if (!A || !dados || !dados.leituras.length) return null;
    const L = ultima(), m = metricasAlarme(), desl = alDesligados(), out = {};
    VISTAS_AL.forEach(([v]) => {
      const lista = A.avaliar(m, v, A.LIM);
      const h = A.registrar(lerPref('alarmes:' + v, null), dados.dia, L.horario, lista, Date.now());
      gravarPref('alarmes:' + v, h);
      const ligados = lista.filter(x => !desl[v].has(x.tipo));
      const ativos = ligados.filter(x => x.nivel === 'crit' || x.nivel === 'aten');
      const vis = ativos.filter(x => !h.sil[x.id]);
      out[v] = { lista, ligados, ativos, vis, sil: ativos.filter(x => h.sil[x.id]), h, desl: desl[v],
        nC: vis.filter(x => x.nivel === 'crit').length, nA: vis.filter(x => x.nivel === 'aten').length };
    });
    return out;
  }
  // bolinha na aba Alarmes: alarmes ativos da visão escolhida (rosa se houver crítico, laranja se só atenção)
  function renderBadge(res) {
    const b = $('#alBadge'); if (!b) return;
    const r = res && res[al.vista], n = r ? r.vis.length : 0;
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('aten', !!r && !r.nC);
    const bt = b.closest('button'); if (bt) bt.setAttribute('aria-label', 'Alarmes' + (n ? ` (${n} ${n === 1 ? 'ativo' : 'ativos'})` : ''));
  }
  const ICO_AL = {
    crit: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--rosa)"/><path d="M12 6.5v7" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.5" fill="#fff"/></svg>',
    aten: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2 23 21.5H1z" fill="var(--laranja)" stroke="var(--laranja)" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="18.2" r="1.35" fill="#fff"/></svg>',
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--okc)"/><path d="m6.8 12.4 3.4 3.4 7-7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sil: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-9.3-5M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M13.7 21a2 2 0 0 1-3.4 0M2 2l20 20"/></svg>',
    na: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--ink3)" opacity=".55"/><path d="M7.5 12h9" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
    todos: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4" cy="6.5" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="17.5" r="1.2" fill="currentColor"/></svg>',
    cfg: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };
  const hhmmMs = ms => { const t = new Date(ms); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
  let alUltimos = [];   // alarmes da visão em exibição (para os botões)
  const contagem = (r, curto) => r.vis.length ? [r.nC ? `${r.nC} ${r.nC === 1 ? 'crítico' : 'críticos'}` : '', r.nA ? `${r.nA} em atenção` : ''].filter(Boolean).join(curto ? ', ' : ' · ') : 'tudo normal';
  function renderAlarmes(res) {
    const pg = $('#pgAlarmes');
    if (!res) { pg.innerHTML = '<div class="card"><p class="nota">Os alarmes aparecem assim que houver a primeira coleta do dia.</p></div>'; return; }
    const v = al.vista, r = res[v];
    const L = ultima(), m = metricasAlarme(), P = m[v];
    alUltimos = r.ligados;
    if (al.aberto && !r.vis.some(x => x.id === al.aberto)) al.aberto = null;
    // botões Agora · Hoje com a bolinha no canto: quantos alarmes ativos em cada visão (rosa se houver crítico)
    const bolinha = x => x.vis.length ? `<b class="nb${x.nC ? '' : ' aten'}" aria-hidden="true">${x.vis.length > 99 ? '99+' : x.vis.length}</b>` : '';
    const botoes = `<div class="seg alvista" role="tablist" aria-label="Visão dos alarmes">${VISTAS_AL.map(([k, tx]) => `<button data-alvista="${k}" class="${v === k ? 'on' : ''}" aria-pressed="${v === k}" aria-label="${tx}: ${contagem(res[k], true)}">${tx}${bolinha(res[k])}</button>`).join('')}</div>`;
    // título fora do cartão, com "ativos / ligados na configuração" da visão escolhida (por tipo de alarme)
    const nTipos = window.Alarmes.TIPOS.length - r.desl.size, nAtivos = new Set(r.vis.map(x => x.tipo)).size;
    const titulo = `<h2 class="sec al-sec">Alarmes<span class="sp"></span><span class="al-qt num${r.nC ? ' c' : r.nA ? ' a' : ''}" title="alarmes ativos / ligados na configuração (${v === 'agora' ? 'Agora' : 'Hoje'})" aria-label="${nAtivos} de ${nTipos} alarmes ligados estão ativos"><b>${nAtivos}</b>/${nTipos}</span></h2>`;
    const h = r.h;
    const linha = x => {
      const ab = al.aberto === x.id, c = x.nivel === 'crit' ? 'c' : 'a';
      const mais = !ab ? '' : `<div class="al-mais"><p><b>Regra:</b> ${esc(x.regra)}</p>${x.onde ? `<p>Onde mais pesa: ${x.onde}</p>` : ''}
        <div class="al-bts">${x.alvo ? `<button class="al-bt" data-alver="${esc(x.id)}">Ver na Evolução ›</button>` : ''}<button class="al-bt" data-alsil="${esc(x.id)}">${ICO_AL.sil}Silenciar 1 h</button></div></div>`;
      return `<div class="al al-${c}${ab ? ' aberto' : ''}" data-anc="al:${esc(x.id)}" data-al-id="${esc(x.id)}">
        <button class="al-top" data-al="${esc(x.id)}" aria-expanded="${ab}">
          <span class="al-ic">${ICO_AL[x.nivel]}</span>
          <span class="al-tx"><span class="al-tt">${esc(A_NOME(x.tipo))}</span><span class="al-st">${esc(x.status)}</span><span class="al-dt"><span class="al-tg">${esc(x.tag)}</span>${x.det}</span></span>
          <span class="al-vl num">${esc(x.valor)}<small>${esc(x.valorSub)}</small>${h.desde[x.id] ? `<em class="al-sp">desde ${esc(h.desde[x.id])}</em>` : ''}</span>
        </button>${mais}</div>`;
    };
    const pill = (n, cls, ic, um, varios) => n ? `<span class="al-pill ${cls}">${ICO_AL[ic]}${n} ${n === 1 ? um : varios}</span>` : '';
    const oks = r.ligados.filter(x => x.nivel === 'ok'), nas = r.ligados.filter(x => x.nivel === 'na');
    // verificações normais: uma cápsula por linha, com o número atual e a referência (meta, mediana ou limite)
    const chips = xs => `<ul class="al-okl">${xs.filter((x, i, a) => a.findIndex(y => y.tipo === x.tipo) === i).map(x =>
      `<li data-ok="${esc(x.tipo)}"><span class="al-okx"><span class="al-okn">${esc(A_NOME(x.tipo))}</span>${x.ref ? `<span class="al-okr">${esc(x.ref)}</span>` : ''}</span><b class="al-okv num">${esc(x.atual)}</b></li>`).join('')}</ul>`;
    let corpo;
    if (r.vis.length) {
      corpo = `<div class="al-res">${pill(r.nC, 'c', 'crit', 'crítico', 'críticos')}${pill(r.nA, 'a', 'aten', 'em atenção', 'em atenção')}${pill(oks.length, 'o', 'ok', 'normal', 'normais')}</div>
        ${r.vis.map(linha).join('')}
        ${oks.length ? `<div class="al-okg"><div class="al-okt">${ICO_AL.ok}${oks.length} ${oks.length === 1 ? 'verificação normal' : 'verificações normais'}</div>${chips(oks)}</div>` : ''}`;
    } else {
      corpo = `<div class="al-tudo">${ICO_AL.ok}<div><b>Tudo dentro do normal</b><small>${oks.length} ${oks.length === 1 ? 'verificação' : 'verificações'} · ${r.sil.length ? 'só os silenciados abaixo' : 'nenhum desvio ' + (v === 'agora' ? 'agora' : 'no dia')}</small></div></div>
        ${oks.length ? `<div class="al-okg">${chips(oks)}</div>` : ''}`;
    }
    if (r.sil.length) corpo += `<div class="al-silx">${ICO_AL.sil}<span>${r.sil.length === 1 ? 'Silenciado' : r.sil.length + ' silenciados'} até ${esc(hhmmMs(Math.max(...r.sil.map(x => h.sil[x.id]))))}: ${r.sil.map(x => esc(x.titulo)).join(', ')}</span><button class="lnk" data-alreat>reativar</button></div>`;
    if (nas.length) corpo += `<div class="al-na">sem dado para avaliar agora: ${[...new Set(nas.map(x => A_NOME(x.tipo)))].map(esc).join(', ')}</div>`;
    if (r.desl.size) corpo += `<button class="al-desl" data-alcfg>${r.desl.size} ${r.desl.size === 1 ? 'alarme desligado' : 'alarmes desligados'} nesta visão · configurar</button>`;
    const pe = h.ult && !r.vis.length ? `último alarme: ${esc(h.ult.titulo)}${h.ult.mais ? ` (e mais ${h.ult.mais})` : ''}, ${h.ult.mais ? 'encerrados' : 'encerrado'} às ${esc(h.ult.fim)}` : r.vis.length ? 'toque num alarme para ver a regra e o gráfico' : '';
    const ab = infoAberto === 'alarmes';
    const periodo = v === 'agora' ? `hora aberta ${D.hhmm(P.ini)}–${D.hhmm(P.ate)}` : `dia até ${esc(L.horario)}`;
    const info = `<p><b>${v === 'agora' ? 'Agora' : 'Hoje'}:</b> ${v === 'agora' ? 'a hora aberta (de HH:00 até a última coleta; na virada da hora, a hora anterior) — mostra se o problema continua e quando volta ao normal.' : 'o dia inteiro até a última coleta — mostra como o dia está no acumulado.'}
      Sempre no Total URA. O previsto é a mediana ${evo.cmp === 'dias' ? 'dos 7 dias anteriores' : 'dos 7 mesmos dias da semana'} no mesmo trecho do dia${evo.cmp === 'off' ? ' (com o previsto desligado, os alarmes usam os mesmos dias da semana)' : ''}.</p>
      <ul>${r.lista.filter((x, i, a) => a.findIndex(y => y.tipo === x.tipo) === i).map(x => `<li><b>${esc(A_NOME(x.tipo))}:</b> ${esc(x.regra)}</li>`).join('')}</ul>
      <p>"Desde", o último alarme encerrado e os silenciados ficam guardados neste aparelho, separados por visão, e recomeçam a cada dia. Silenciar esconde o alarme por 1 h. A engrenagem liga e desliga cada alarme em cada visão.</p>`;
    pg.innerHTML = `${botoes}${titulo}
      <div class="card alarmes" data-ch="alarmes">
        <div class="al-cab"><h2>${v === 'agora' ? 'Agora' : 'Hoje'}</h2><span class="t">${periodo}${m.cmpNome ? ' · med. ' + esc(m.cmpNome) : ''}</span></div>
        <button class="al-cfg" data-alcfg aria-label="Configurar alarmes" title="Configurar alarmes">${ICO_AL.cfg}</button>
        ${corpo}
        <div class="al-pe"><span>${pe}</span><button class="info" data-info="alarmes" aria-expanded="${ab}" aria-controls="inf-alarmes" aria-label="${ab ? 'Esconder' : 'Mostrar'} a explicação dos alarmes" title="Como os alarmes funcionam">${ICONE_INFO}</button></div>
        <div class="ch-info al-info" id="inf-alarmes"${ab ? '' : ' hidden'}>${info}</div></div>`;
  }
  // ---------------------------------------------------------------- resumo dos alarmes na Evolução (o último item da tela)
  // O dia escolhido na barra de data, com as regras da visão Hoje: o fechamento do dia (no dia do Pulse, até a última
  // coleta). Uma linha por tipo de alarme, sempre na ordem da configuração (a lista não muda de lugar ao trocar de dia);
  // as cápsulas do topo (Todos, críticos, em atenção, normais) filtram a lista. Não é interativo como a página Alarmes.
  let alEvoCache = null;
  // com os filtros do topo da Evolução (Total URA/CO/TEL, grupo, skill): mostra o comportamento de cada grupo
  const selEvo = () => evo.dir === 'TODOS' && !evo.grupo && !evo.skill ? null : { dir: evo.dir, grupo: evo.grupo, skill: evo.skill };
  function metricasDiaEvo(ctx) {
    const sel = selEvo();
    if (ctx.vivo && !sel) return metricasAlarme();
    const tipo = evo.cmp === 'off' ? 'sem' : evo.cmp;
    const k = [ctx.iso, tipo, ctx.vivo ? ultima().m + ':' + ultima().col : '', sel ? [sel.dir, sel.grupo, sel.skill].join('/') : '', hist ? hist.lista.length + ':' + hist.inicio + ':' + hist.fim + ':' + histOrigem : '-'].join('|');
    let m;
    if (alEvoCache && alEvoCache.k === k && alEvoCache.h === hist && alEvoCache.d === ctx.d) m = alEvoCache.m;
    else { m = calcularMetricasAlarme(ctx.d, ctx.d.leituras[ctx.d.leituras.length - 1], tipo, sel); alEvoCache = { k, h: hist, d: ctx.d, m }; }
    if (ctx.vivo) { const v = metricasAlarme(); m.vivo = v.vivo; m.atrasoMin = v.atrasoMin; } else { m.vivo = false; m.atrasoMin = 0; }
    return m;
  }
  const PESO_AL = { crit: 0, aten: 1, ok: 2, na: 3 };
  const SO_AGORA = new Set(['agentes', 'parada', 'coleta']);   // retratos do momento: não existem num dia fechado
  function cartaoAlarmesEvo(ctx) {
    const A = window.Alarmes;
    if (!A || !ctx.d || !ctx.d.leituras.length) return '';
    let m;
    try { m = metricasDiaEvo(ctx); } catch (e) { console.warn('alarmes (Evolução):', e); return ''; }
    const lista = A.avaliar(m, 'dia', A.LIM), desl = alDesligados().evo;
    const linhas = A.TIPOS.filter(t => !desl.has(t.id)).map(t => {
      const xs = lista.filter(x => x.tipo === t.id), pior = xs.slice().sort((a, b) => PESO_AL[a.nivel] - PESO_AL[b.nivel])[0];
      const alarme = pior.nivel === 'crit' || pior.nivel === 'aten';
      let valor = pior.atual || pior.valor || '—', ref = pior.ref;
      if (t.id === 'grupos' && alarme) {
        const fora = xs.filter(x => x.nivel === 'crit' || x.nivel === 'aten');
        valor = fora.length + (fora.length === 1 ? ' grupo' : ' grupos'); ref = fora.map(x => `${x.alvo.grupo} ${x.valor}`).join(' · ');
      }
      const comp = pior.nivel === 'na' ? (!ctx.vivo && SO_AGORA.has(t.id) ? 'só vale no dia de hoje (retrato do momento)' : 'sem dado para avaliar neste dia') : alarme && pior.status ? pior.status + (ref ? ' · ' + ref : '') : ref;
      return { tipo: t.id, nome: t.nome, nivel: pior.nivel, valor, comp };
    });
    const n = k => linhas.filter(x => x.nivel === k).length;
    const fs = al.filEvo, comFiltro = fs.size > 0;
    const vis = comFiltro ? linhas.filter(x => fs.has(x.nivel)) : linhas;
    // três cápsulas: tocar filtra; com uma marcada, as outras ganham o "+" no canto (somar ao filtro);
    // tocar numa marcada tira só ela; o X à direita limpa tudo
    const pil = (k, ic, rot) => { const on = fs.has(k), mais = comFiltro && !on;
      return `<button class="al-pill ${k === 'crit' ? 'c' : k === 'aten' ? 'a' : 'o'}${on ? ' on' : ''}${mais ? ' mais' : ''}" data-alk="${k}" aria-pressed="${on}"${mais ? ` aria-label="${rot}: somar ao filtro"` : ''}>${ic}${rot}${mais ? '<b class="al-mais-ic" aria-hidden="true">+</b>' : ''}</button>`; };
    const nC = n('crit'), nA = n('aten'), nO = n('ok');
    const filtros = `<div class="al-res al-fil" role="group" aria-label="Filtrar alarmes do dia">
      ${pil('crit', ICO_AL.crit, `${nC} ${nC === 1 ? 'crítico' : 'críticos'}`)}${pil('aten', ICO_AL.aten, `${nA} atenção`)}${pil('ok', ICO_AL.ok, `${nO} ${nO === 1 ? 'normal' : 'normais'}`)}${comFiltro ? `<button class="al-pill al-x" data-alfil="todos" aria-label="Limpar o filtro" title="Limpar o filtro"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg></button>` : ''}</div>`;
    const rotulo = { crit: 'crítico', aten: 'em atenção', ok: 'normal', na: 'sem dado' };
    const corpo = vis.length ? `<ul class="al-okl alr">${vis.map(x => `<li class="alr-${x.nivel}" data-alr="${esc(x.tipo)}"><span class="alr-ic" title="${rotulo[x.nivel]}">${ICO_AL[x.nivel]}</span>` +
        `<span class="al-okx"><span class="al-okn">${esc(x.nome)}</span>${x.comp ? `<span class="al-okr">${esc(x.comp)}</span>` : ''}</span><b class="al-okv num">${esc(x.valor)}</b></li>`).join('')}</ul>`
      : `<p class="alr-vazio">Nenhum alarme ${[...fs].map(k => ({ crit: 'crítico', aten: 'em atenção', ok: 'normal' })[k]).join(' ou ')} neste dia.</p>`;
    const L = ctx.d.leituras[ctx.d.leituras.length - 1];
    const quando = ctx.vivo ? `dia até ${esc(ultima().horario)}` : 'fechamento do dia';
    return `<div class="card alarmes alresumo" data-ch="evo-alarmes">
      <div class="al-cab"><h2>Alarmes do dia</h2><span class="t">${quando}${m.cmpNome ? ' · med. ' + esc(m.cmpNome) : ''}</span></div>
      <button class="al-cfg" data-alcfg aria-label="Configurar alarmes" title="Configurar alarmes">${ICO_AL.cfg}</button>
      ${selEvo() ? `<div class="ch-filtro alr-filtro" title="Filtro aplicado">${esc(textoFiltro(ctx.d, evo.dir, evo))}</div>` : ''}
      ${filtros}${corpo}
      <p class="alr-pe">Regras da visão Hoje aplicadas ao dia escolhido${ctx.vivo ? '' : ' (em espera sem agente, skills sem chamadas e coleta são retratos do momento e só valem no dia de hoje)'}.${desl.size ? ` <button class="lnk" data-alcfg>${desl.size} ${desl.size === 1 ? 'desligado' : 'desligados'} · configurar</button>` : ''}</p>
    </div>`;
  }
  const A_NOME = t => { const x = window.Alarmes && window.Alarmes.TIPOS.find(y => y.id === t); return x ? x.nome : t; };
  // configuração: liga/desliga cada tipo de alarme em cada visão (Agora e Hoje), com "Todos" por coluna
  function abrirCfgAlarmes() {
    const sh = $('#sheet'), A = window.Alarmes; if (!A) return;
    desenharCfg();
    sh.scrollTop = 0;
    sh.classList.add('show'); $('#sheetBg').classList.add('show');
  }
  const COLS_CFG = [['agora', 'Agora'], ['dia', 'Hoje'], ['evo', 'Evolução']];
  function desenharCfg() {
    const sh = $('#sheet'), A = window.Alarmes, c = alDesligados();
    const caixa = (v, nome, t) => `<label class="alc-cx"><input type="checkbox" data-cfg="${v}" data-tipo="${t}"${c[v].has(t) ? '' : ' checked'} aria-label="${esc(A_NOME(t))} · ${nome}"></label>`;
    const todos = (v, nome) => { const n = A.TIPOS.filter(t => !c[v].has(t.id)).length; return `<label class="alc-cx"><input type="checkbox" data-cfgtodos="${v}"${n === A.TIPOS.length ? ' checked' : ''}${n && n < A.TIPOS.length ? ' data-meio="1"' : ''} aria-label="Todos · ${nome}"></label>`; };
    sh.innerHTML = `<button class="fechar" data-act="fechar" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
      <h3>Configurar alarmes</h3><p class="alc-sub">Escolha quais alarmes aparecem em cada lugar: <b>Agora</b> e <b>Hoje</b> (página Alarmes) e o resumo do dia na <b>Evolução</b>. Fica guardado neste aparelho.</p>
      <div class="card alc"><table class="alc-t"><thead><tr><th>Alarme</th>${COLS_CFG.map(([, n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody>
        <tr class="alc-todos"><td>Todos</td>${COLS_CFG.map(([v, n]) => `<td>${todos(v, n)}</td>`).join('')}</tr>
        ${A.TIPOS.map(t => `<tr><td><b>${esc(t.nome)}</b><small>${esc(t.desc)}</small></td>${COLS_CFG.map(([v, n]) => `<td>${caixa(v, n, t.id)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
    sh.querySelectorAll('input[data-meio]').forEach(i => { i.indeterminate = true; });
  }
  // "Ver na Evolução": o gráfico do alarme, já no atendimento (e grupo) dele, no dia de hoje por horas
  function verAlarme(id) {
    const x = alUltimos.find(a => a.id === id); if (!x || !x.alvo) return;
    mudarDir(x.alvo.dir || 'TODOS');
    evo.grupo = x.alvo.grupo || null; evo.skill = null; evo.vista = 'hora'; evo.dia = null; evo.sel = null;
    irPara('evo');
    const ch = $(`#pgEvo .chart[data-ch="evo-${x.alvo.ch}"]`) || $('#pgEvo .chart[data-ch="evo-of"]');
    if (ch) {
      const ctl = $('#pgEvo .evo-ctl.fixo'), topo = Math.max($('header.top').getBoundingClientRect().bottom, ctl ? ctl.getBoundingClientRect().bottom : 0);
      window.scrollBy(0, ch.getBoundingClientRect().top - topo - 8);
      ch.classList.add('al-alvo'); setTimeout(() => ch.classList.remove('al-alvo'), 1600);
    }
  }

  // hora aberta: de HH:00 até a última coleta; na virada da hora (coleta às HH:00), a hora anterior inteira
  function inicioHora(m) { let h = Math.floor(m / 60) * 60; if (h === m) h -= 60; return Math.max(D.INICIO, h); }

  function renderAgora() {
    const d = dados, L = ultima(), dir = ag.dir;
    const co = D.filtro(d, { dir: 'CO' }), tel = D.filtro(d, { dir: 'TEL' });
    const a = D.agregar(L, co), t = D.agregar(L, tel);
    // cartão de NS: a HORA ABERTA (o mesmo NS do alarme na visão Agora), ÷ finalizadas na hora; o NS do dia fica embaixo
    const hIni = inicioHora(L.m), lIni = [...d.leituras].reverse().find(x => x.m <= hIni) || null;
    const hC = D.delta(a, D.agregar(lIni, co));
    const sit = situacao(hC.ns);
    const pctBar = hC.ns == null ? 0 : Math.min(100, hC.ns);
    const cmp = cmpAgora();
    const nsMedHora = medAg(cmp, r => D.intervaloEm(r.dR, hIni, L.m, r.coR).ns);
    const faixaHora = `${D.hhmm(hIni)}–${D.hhmm(L.m)}`;

    // botões do topo: mesmos da aba Skills, na ordem da Evolução
    const botoes = `<div class="seg agdir" role="tablist" aria-label="Atendimento">${[['TODOS', 'Total URA'], ['CO', 'CO'], ['TEL', 'TEL']].map(([v, tx]) => `<button data-agdir="${v}" class="${dir === v ? 'on' : ''}" aria-pressed="${dir === v}">${tx}</button>`).join('')}</div>`;

    const hero = `<div class="card">
      <div class="hero">
        <div><div class="lbl">NS <span class="un">5 min</span> · CO</div><div class="big num c-${sit || 'x'}">${hC.ns == null ? '—' : fP(hC.ns)}</div><div class="lbl hr-f">${faixaHora}</div></div>
        <div class="dir">
          <div>${sit ? `<span class="pill st-${sit}">${STATUS[sit]}</span>` : '<span class="pill" style="background:var(--grid)">Sem chamadas</span>'}</div>
          <div class="prog" aria-hidden="true"><i style="width:${pctBar}%;background:${corSit(sit)}"></i><b style="left:calc(${META_NS}% - 1px)"></b></div>
          <div class="meta">meta ${META_NS}% · ${hC.fin ? `${fI(hC.a300)} de ${fI(hC.fin)} finalizadas na hora em até 5&nbsp;min` : 'nenhuma chamada finalizada ainda nesta hora'}</div>
          ${cmp ? `<div class="meta hr">${linhaMed(cmp, nsMedHora, x => fP(x), hC.ns, true)}</div>` : ''}
          <div class="meta dia">no dia: <b class="c-${situacao(a.ns) || 'x'}">${a.ns == null ? '—' : fP(a.ns)}</b> · ${fI(a.a300)} de ${fI(a.ofer)} oferecidas</div>
        </div>
      </div></div>`;
    // sem os cards (os totais ficam nos gráficos da hora); só o NS do dia, e na TEL o aviso de que ela é só volume
    const telNota = `<div class="card"><p class="nota">A TEL é atendida em outro sistema: aqui aparece só o volume que a URA encaminhou (sem atendidas, abandono, NS ou fila).</p></div>`;

    // fila agora (CO)
    const filas = [...porSimpl(d, 'CO').entries()].map(([nome, ss]) => ({ nome, ss, a: D.agregar(L, ss) })).filter(x => x.a.fila > 0)
      .sort((x, y) => y.a.espMax - x.a.espMax || y.a.fila - x.a.fila);
    const filaHtml = filas.length ? `<div class="fl">${filas.map(x => {
      const tr = d.trad[x.ss[0]], mx = x.a.espMax;
      const cor = mx >= 300 ? 'var(--rosa)' : mx >= 120 ? 'var(--laranja)' : 'var(--p300)';
      return `<button class="fi" data-sk="${esc(x.nome)}" data-skd="CO"><span class="bar" style="background:${cor}"></span>
        <span class="tx"><div class="nm">${esc(x.nome)}</div><div class="sb">${esc(tr.SKILL_GRUPO)}${tr.SKILL_TIPO_ATENDIMENTO ? ' · ' + esc(tr.SKILL_TIPO_ATENDIMENTO) : ''} · ${fI(x.a.dispMax)} agente(s) disponível(is)</div></span>
        <span class="nv"><b>${fI(x.a.fila)}</b><small>mais antiga ${fS(mx)}</small></span></button>`;
    }).join('')}</div>`
      : `<div class="okcard"><span class="okb"><svg viewBox="0 0 24 24"><path d="m6.5 12.3 3.6 3.6L17.5 8.6"/></svg></span><div>Nenhuma chamada em espera no CO<small>na coleta das ${esc(L.horario)}</small></div></div>`;

    // hora atual (gráficos + painel de grupos e skills) e a tabela do dia de 15 em 15 min, com o filtro da aba Agora
    const hora = horaAgora(d);
    const fC = filtroEvo(d, 'CO', ag), fT = filtroEvo(d, 'TEL', ag);
    const tab = tabelaIntervalos(D.intervalos(d, 15, fC), D.intervalos(d, 15, fT), dir, 15, -1, false, { id: 'tIvAg', filtro: textoFiltro(d, dir, ag), limite: 9, tudo: ag.tabTudo, acao: 'tabtudo', anc: 'tabAg', marcaAberto: true, ateM: L.m });

    const titulo = { TODOS: 'URA · Suporte B2C', CO: 'CO · Centro de Operações', TEL: 'TEL · Parceira' }[dir];
    $('#pgAgora').innerHTML = `
      ${botoes}
      <h2 class="sec">${titulo}<span class="sp"></span><span class="rt">${dir === 'TEL' ? 'acumulado do dia' : 'NS da hora aberta'}</span></h2>
      ${dir === 'TEL' ? telNota : hero}
      ${dir === 'TEL' ? '' : `<h2 class="sec">Em espera agora <span class="ct num">${fI(a.fila)}</span><span class="sp"></span><span class="rt">${esc(L.horario)} · ${fI(a.dispMax)} ${a.dispMax === 1 ? 'agente disponível' : 'agentes disponíveis'}</span></h2>${filaHtml}`}
      ${hora}
      ${tab}`;
    alinharListras();
  }
  // listrado da linha ainda aberta: cada célula começa o desenho onde a anterior parou (sem degrau entre células)
  function alinharListras() {
    document.querySelectorAll('table.conf tr.aberto').forEach(tr => {
      const x0 = tr.getBoundingClientRect().left;
      tr.querySelectorAll('td').forEach(td => { td.style.backgroundPosition = `${(x0 - td.getBoundingClientRect().left).toFixed(2)}px 0`; });
    });
  }

  function horaAgora(d) {
    const L = ultima();
    let desde = Math.floor(L.m / 60) * 60, passo = 5, nome = 'Hora atual · de 5 em 5 min';
    if (desde === L.m) { desde -= 60; passo = 15; nome = 'Última hora · de 15 em 15 min'; }
    if (desde < D.INICIO) desde = D.INICIO;
    const co = filtroEvo(d, 'CO', ag), tel = filtroEvo(d, 'TEL', ag);
    const ic = D.intervalos(d, passo, co, { desde }), it = D.intervalos(d, passo, tel, { desde });
    const ivC = [], ivT = [];
    for (let m = desde; m < desde + 60; m += passo) {
      ivC.push(ic.find(x => x.ini === m) || { ini: m, fim: m + passo, futuro: true });
      ivT.push(it.find(x => x.ini === m) || { ini: m, fim: m + passo, futuro: true });
    }
    agCols = ivC;
    if (ag.sel != null && !ivC.some(c => c.ini === ag.sel && !c.futuro)) ag.sel = null;
    const iSel = ag.sel == null ? -1 : ivC.findIndex(c => c.ini === ag.sel);
    // previsto: mesmos filtros da aba Agora; colunas menores que o bloco do histórico (fino)
    let cmp = null;
    if (hist && evo.cmp !== 'off') {
      const refs = Hs.referencias(hist, d.dia, evo.cmp);
      if (refs.length) cmp = { refs, fino: true, acum: false, nome: nomeCmp(d.dia, refs.length), curto: nomeCmp(d.dia, refs.length, true),
        porRef: refs.map(r => { const dR = Hs.diaComoDados(hist, r, d.trad); return { dR, coR: filtroEvo(dR, 'CO', ag), telR: filtroEvo(dR, 'TEL', ag) }; }) };
    }
    const rot = c => (c.ini - desde) % 15 === 0 ? D.hhmm(c.ini) : '';
    const tit = c => `${D.hhmm(c.ini)}–${D.hhmm(c.andamento ? c.ateM : c.fim)}${c.futuro ? ' (ainda não chegou)' : c.andamento ? ' (em andamento)' : ''}`;
    // resumo fixo do 1º gráfico (sem coluna selecionada): a hora até agora × previsto, e o previsto da hora inteira
    let resumo = '';
    if (cmp) {
      const urA = (r, i, f) => D.intervaloEm(r.dR, i, f, r.coR).ofer + D.intervaloEm(r.dR, i, f, r.telR).ofer;
      const ateM = Math.min(L.m, desde + 60), fecha = ateM >= desde + 60;
      const atual = ic.concat(it).reduce((t, c) => t + (c && c.v ? c.v.ofer : 0), 0);
      const pAte = Hs.mediana(cmp.porRef.map(r => urA(r, desde, ateM))), pHora = Hs.mediana(cmp.porRef.map(r => urA(r, desde, desde + 60)));
      resumo = `<div class="cap capsel csel hres"><b>${D.hhmm(desde)}–${D.hhmm(ateM)}${fecha ? '' : ' · até agora'}</b>` +
        `<span>${fI(atual)} oferecidas · previsto ${pAte == null ? '—' : fI(pAte)} ${pAte == null ? '' : difTx(atual, pAte)}</span>` +
        (fecha ? '' : `<small>previsto para a hora inteira (${D.hhmm(desde)}–${D.hhmm(desde + 60)}): <b>${pHora == null ? '—' : fI(pHora)}</b></small>`) +
        `<small class="cref">mediana ${esc(cmp.nome)}</small></div>`;
    }
    const notaExtra = (ivC.some(c => c.futuro) ? '<span>colunas vazias: o resto da hora, ainda sem coleta — o previsto já aparece atrás</span>' : '') +
      (cmp && passo === 5 ? '<span>de 5 em 5 min o histórico não tem o detalhe: cada bloco de 15 min é dividido em 3 partes iguais (aproximação); a fila prevista fica entre os retratos de 15 min</span>' : '');
    let html = `<h2 class="sec">${nome}<span class="sp"></span><span class="rt">${D.hhmm(desde)}–${D.hhmm(desde + 60)}</span></h2>`;
    if (hist) html += chaveCmp({ iso: d.dia });
    const lDe = [...d.leituras].reverse().find(x => x.m <= desde) || null;
    const per = { aC: D.delta(D.agregar(L, co), D.agregar(lDe, co)), aT: D.delta(D.agregar(L, tel), D.agregar(lDe, tel)), esp: D.espera(d.leituras, desde, L.m, co), parcial: true, onde: '',
      med: f => !cmp ? null : Hs.mediana(cmp.porRef.map(r => f(D.intervaloEm(r.dR, desde, L.m, r.coR), D.intervaloEm(r.dR, desde, L.m, r.telR)))),
      medEsp: () => !cmp ? null : Hs.mediana(cmp.porRef.map(r => { if (!r.dR.temFila) return null; const e = D.espera(r.dR.leituras, desde, L.m, r.coR); return e ? e.pico : null; })) };
    html += graficos({ per, ivC, ivT, dir: ag.dir, acum: false, passo, iSel, rot, tit, cmp, temFilaDia: true, vivo: true, filtroTx: textoFiltro(d, ag.dir, ag),
      pre: 'agora', suf: '', gopt: { maxRot: 12, rotulos: true }, fixoOf: resumo, notaExtra, cmpTipo: evo.cmp });
    html += painelGrupos(d, L, ivC, iSel, false, ag, { dir: ag.dir, desde, id: 'agora-grupos' });
    return html;
  }




  // ---------------------------------------------------------------- EVOLUÇÃO
  // filtro da Evolução: atendimento + grupo + skill (nome simplificado; pode juntar várias skills do Pulse)
  function filtroEvo(dd, dir, st) {
    st = st || evo;
    const ss = D.filtro(dd, { dir, grupo: st.grupo });
    return st.skill ? ss.filter(s => dd.trad[s] && dd.trad[s].SKILL_SIMPLIFICADO === st.skill) : ss;
  }
  // texto do filtro no rodapé dos gráficos
  function textoFiltro(d, dir, st) {
    if (dir !== 'TODOS') return dir + (st.grupo ? ' – ' + st.grupo : '') + (st.skill ? ' › ' + st.skill : '');
    if (!st.grupo) return '';
    const ds = [...new Set(D.filtro(d, { dir: 'TODOS', grupo: st.grupo }).map(s => d.trad[s].DIRECIONAMENTO))];
    return (ds.length === 1 ? ds[0] + ' – ' : '') + st.grupo + (st.skill ? ' › ' + st.skill : '');
  }
  // fila (técnicos em espera) num minuto qualquer de um dia do histórico: entre dois retratos de 15 min, proporcional
  function filaEm(dd, m, ss) {
    let ant = null, pos = null;
    for (const l of dd.leituras) { if (l.m <= m) ant = l; if (l.m >= m && !pos) pos = l; }
    const tot = l => D.agregar(l, ss).fila;
    if (!ant) return 0;
    if (!pos || pos === ant) return tot(ant);
    const a = tot(ant), b = tot(pos);
    return a + (b - a) * (m - ant.m) / (pos.m - ant.m);
  }
  // ---------------------------------------------------------------- dia da Evolução (ao vivo ou do histórico)
  // Dias disponíveis = o dia do Pulse (sempre do Pulse, com fila) + os dias do histórico ANTERIORES a ele.
  // O histórico só vale "para trás": se ele tiver o próprio dia do Pulse (ou depois), esses dias ficam de fora.
  function diasDisp() {
    const c = new Set(hist ? hist.lista.filter(x => !dados || x < dados.dia) : []);
    if (dados) c.add(dados.dia);
    return [...c].sort();
  }
  const usaPulse = iso => !!dados && iso === dados.dia;
  function diaEvo() {
    const lista = diasDisp();
    if (evo.dia && !lista.includes(evo.dia)) evo.dia = null;
    const alvo = evo.dia || lista[lista.length - 1];
    if (!hist || usaPulse(alvo)) return { d: dados, iso: dados.dia, vivo: true, lista, i: lista.indexOf(dados.dia) };
    return { d: Hs.diaComoDados(hist, alvo, dados.trad), iso: alvo, vivo: false, lista, i: lista.indexOf(alvo) };
  }
  // nome da comparação: "7 sextas", "5 sextas" (perto do início do histórico), "7 dias"
  function nomeCmp(iso, n, curto) {
    if (evo.cmp === 'dias') return n + ' dias';
    const w = Hs.diaSemana(iso);
    return n + ' ' + (curto ? DS_CURTO[w] : n === 1 ? DS_PLURAL[w].slice(0, -1) : DS_PLURAL[w]);
  }
  // Mediana do histórico para o dia em exibição: mesmos filtros, mesmo eixo e mesmo modo (intervalo/acumulado).
  // Lm: horário da última leitura do dia em exibição — os cards comparam "o dia até agora" com os outros dias até a mesma hora.
  function comparacao(iso, passo, acum, Lm) {
    if (!hist || evo.cmp === 'off') return null;   // previsto desligado: gráficos e cards limpos
    const refs = Hs.referencias(hist, iso, evo.cmp);
    const porRef = refs.map(r => {
      const dR = Hs.diaComoDados(hist, r, dados.trad);
      const coR = filtroEvo(dR, 'CO'), telR = filtroEvo(dR, 'TEL');
      let ivC = D.intervalos(dR, passo, coR), ivT = D.intervalos(dR, passo, telR);
      if (acum) { ivC = D.acumulados(dR, ivC, coR); ivT = D.acumulados(dR, ivT, telR); }
      // "o dia até agora" nos outros dias = até o MESMO minuto, proporcional dentro do bloco de 15 min
      return { dR, coR, telR, ivC: new Map(ivC.map(c => [c.ini, c])), ivT: new Map(ivT.map(c => [c.ini, c])), diaC: D.agregarEm(dR, Lm, coR), diaT: D.agregarEm(dR, Lm, telR) };
    });
    return { refs, porRef, acum, nome: nomeCmp(iso, refs.length), curto: nomeCmp(iso, refs.length, true) };
  }
  // mediana de uma coluna. Coluna em andamento: os outros dias no MESMO trecho (ex.: 19:00–19:20), proporcional
  // dentro do bloco de 15 min do histórico; no acumulado, o dia até o mesmo minuto.
  function medCol(cmp, c, f) {
    if (!cmp || !cmp.porRef.length || !c || c.semColeta) return null;
    // vista por dia: cada coluna (dia) traz os seus dias de referência
    if (cmp.porDia) return cmp.linha(f);
    // coluna em andamento, coluna futura (resto da hora na aba Agora) ou colunas menores que o bloco do histórico (5 min):
    // os outros dias no MESMO trecho, proporcional dentro do bloco de 15 min
    if (c.andamento || c.futuro || cmp.fino) return Hs.mediana(cmp.porRef.map(r => {
      const fimC = c.andamento ? c.ateM : c.fim;
      const x = cmp.acum ? D.agregarEm(r.dR, fimC, r.coR) : D.intervaloEm(r.dR, c.ini, fimC, r.coR);
      const y = cmp.acum ? D.agregarEm(r.dR, fimC, r.telR) : D.intervaloEm(r.dR, c.ini, fimC, r.telR);
      return f(x, y);
    }));
    return Hs.mediana(cmp.porRef.map(r => { const x = r.ivC.get(c.ini), y = r.ivT.get(c.ini); return x && x.v ? f(x.v, y && y.v) : null; }));
  }
  const medDia = (cmp, f) => !cmp || !cmp.porRef.length ? null : Hs.mediana(cmp.porRef.map(r => f(r.diaC, r.diaT)));
  // fila (técnicos em espera): pico das coletas. Dias de referência sem fila (fora do arquivo) ficam de fora da mediana.
  function medEsp(cmp, c) {
    if (!cmp || !cmp.porRef.length || !c || c.semColeta) return null;
    if (cmp.porDia) return cmp.linhaEsp();
    return Hs.mediana(cmp.porRef.map(r => {
      if (!r.dR.temFila) return null;
      // colunas de 5 min ou futuras: o retrato no fim da coluna (proporcional entre os retratos de 15 min)
      if (cmp.fino || c.futuro) return filaEm(r.dR, c.andamento ? c.ateM : c.fim, r.coR);
      if (c.andamento) { const e = D.espera(r.dR.leituras, cmp.acum ? -1 : c.ini, c.ateM, r.coR); return e ? e.pico : null; }
      const x = r.ivC.get(c.ini); return x && x.esp ? x.esp.pico : null;
    }));
  }
  const medEspDia = (cmp, Lm) => !cmp || !cmp.porRef.length ? null :
    Hs.mediana(cmp.porRef.map(r => { if (!r.dR.temFila) return null; const e = D.espera(r.dR.leituras, -1, Lm, r.coR); return e ? e.pico : null; }));
  // diferença para a mediana: % em volumes e tempos; pontos percentuais (p.p.) em percentuais
  function difTx(atual, ref, pp) {
    if (atual == null || ref == null) return '';
    if (pp) { const x = atual - ref; return `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} p.p.`; }
    if (!ref) return '';
    const x = (atual / ref - 1) * 100;
    return `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
  }

  // chave acima do primeiro gráfico: com o que comparar (vale para todos os gráficos), ou desligado.
  // Três botões da mesma largura: "7 dias" (corridos) · "7 dom" (mesmo dia da semana) · "Desligado"
  function chaveCmp(ctx) {
    const w = Hs.diaSemana(ctx.iso);
    const porDia = evo.vista === 'dia' && pagina === 'evo';
    const ops = porDia
      ? [['dias', 'Corridos', 'dias seguidos no eixo; linha = mediana dos dias no gráfico'], ['sem', DS_CURTO[w] + ' a ' + DS_CURTO[w], 'só os ' + DS_PLURAL[w] + ' no eixo; linha = mediana deles'], ['off', 'Desligado', 'dias seguidos, sem a linha']]
      : [['dias', '7 dias', 'mediana dos 7 dias corridos anteriores'], ['sem', '7 ' + DS_CURTO[w], 'mediana dos 7 ' + DS_PLURAL[w] + ' anteriores'], ['off', 'Desligado', 'sem previsto: gráficos limpos']];
    return `<div class="cmpk" role="group" aria-label="Previsto: mediana do histórico"><span class="cmpk-l">Previsto</span>
      <div class="seg sm">${ops.map(([v, t, ti]) => `<button data-cmp="${v}" class="${evo.cmp === v ? 'on' : ''}" aria-pressed="${evo.cmp === v}" title="${ti}" aria-label="${ti}">${t}</button>`).join('')}</div></div>`;
  }

  // barra de data da Evolução: ‹ dia ›, seletor de data e "Hoje"/"Último"
  // opt.semVis: sem o botão Horas/Dia (aba Skills) · opt.idData: id do seletor de data (um por aba)
  function navDia(ctx, opt) {
    opt = opt || {};
    const { lista, i } = ctx, ult = lista[lista.length - 1];
    const w = Hs ? Hs.diaSemana(ctx.iso) : 0;
    // a origem dos dados (Pulse / histórico) não fica na barra: aparece no rodapé quando muda (avisoFonte).
    // Embaixo da data só aparece algum problema com o histórico (carregando, ou não foi possível ler).
    const st = !hist && histCarregando ? 'carregando histórico…' : !hist && histErro ? 'sem histórico: ' + histErro : '';
    const seta = dz => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dz}"/></svg>`;
    return `<div class="dnav${ctx.vivo ? '' : ' hist'}">
      <button class="dn-b" data-navdia="-1"${i > 0 ? '' : ' disabled'} aria-label="Dia anterior">${seta('M15 6l-6 6 6 6')}</button>
      <label class="dn-d"><span class="dn-t"><b class="${w === 0 ? 'dom' : ''}">${DS_CURTO[w]}, ${ddmmaaaa(ctx.iso)}</b>${st ? `<small>${esc(st)}</small>` : ''}</span>
        <input type="date" id="${opt.idData || 'dnData'}" class="dn-data" min="${lista[0]}" max="${ult}" value="${ctx.iso}" aria-label="Escolher o dia"></label>
      <button class="dn-b" data-navdia="1"${i < lista.length - 1 ? '' : ' disabled'} aria-label="Próximo dia">${seta('M9 6l6 6-6 6')}</button>
      ${i < lista.length - 1 ? `<button class="dn-hoje${ult === hojeISO() ? ' hoje' : ''}" data-navdia="fim">${ult === hojeISO() ? 'Hoje' : 'Último'}</button>` : ''}
      ${opt.semVis ? '' : `<button class="dn-vis" data-vis="${evo.vista === 'dia' ? 'hora' : 'dia'}" aria-label="Eixo: ${evo.vista === 'dia' ? 'dias' : 'horas'} — tocar para ver por ${evo.vista === 'dia' ? 'horas' : 'dia'}" title="Alternar o eixo entre horas e dias">${evo.vista === 'dia' ? 'Dia' : 'Horas'}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg></button>`}
    </div>`;
  }

  // Vista por dia: o eixo X recebe dias. Com a chave Previsto em "dias corridos" (ou desligada), os dias seguidos até o
  // dia escolhido; em "mesmo dia da semana", só os dias da mesma semana (dom com dom…). Cada coluna é o dia inteiro
  // (o dia do Pulse vai até a última coleta) e o previsto de cada coluna é a mediana dos 7 dias de referência DELA.
  function vistaDias(ctx, el) {
    const lista = diasDisp(), A = ctx.iso, N = evo.ndias;
    let dias;
    if (evo.cmp === 'sem') { dias = []; for (let x = A; x >= lista[0] && dias.length < N; x = Hs.somaDias(x, -7)) if (lista.includes(x)) dias.push(x); dias.reverse(); }
    else dias = lista.filter(x => x <= A).slice(-N);
    const ivC = [], ivT = [], somaC = [], somaT = [];
    let maior = null;
    const comRef = evo.cmp !== 'off';
    dias.forEach(iso => {
      const dD = usaPulse(iso) ? dados : Hs.diaComoDados(hist, iso, dados.trad);
      const Ld = dD.leituras[dD.leituras.length - 1], coD = filtroEvo(dD, 'CO'), telD = filtroEvo(dD, 'TEL');
      const aC = D.agregar(Ld, coD), aT = D.agregar(Ld, telD);
      const fila = usaPulse(iso) || dD.temFila;
      const esp = fila ? D.espera(dD.leituras, -1, Ld.m, coD) : null;
      const andamento = usaPulse(iso) && iso === hojeISO();
      const w = Hs.diaSemana(iso), dm = ddmmaaaa(iso);
      const base = { ini: iso, acum: true, andamento, perTx: `${DS_CURTO[w]}, ${dm}${andamento ? ' · até ' + Ld.horario : ''}`, rotTab: `${DS_CURTO[w]} ${dm.slice(0, 5)}`, dom: w === 0 };
      ivC.push(Object.assign({}, base, { v: aC, esp }));
      ivT.push(Object.assign({}, base, { v: aT }));
      somaC.push(aC); somaT.push(aT);
      if (esp && (!maior || esp.pico > maior.pico)) maior = { pico: esp.pico, picoTx: esp.pico ? `maior em ${DS_CURTO[w]}, ${dm.slice(0, 5)}` : '' };
    });
    const soma = arr => { const r = { ofer: 0, atend: 0, aband: 0, a300: 0, a60: 0, tmaS: 0, tmeS: 0, espTot: 0, temA60: true, temEsp: false, fila: 0, espMax: 0, agMax: 0, dispMax: 0 };
      arr.forEach(a => ['ofer', 'atend', 'aband', 'a300', 'a60', 'tmaS', 'tmeS', 'espTot'].forEach(k => { r[k] += a[k] || 0; })); return D.derivar(r); };
    const iSel = evo.sel == null ? -1 : ivC.findIndex(c => c.ini === evo.sel);
    if (iSel < 0) evo.sel = null;
    // previsto da vista por dia: uma LINHA RETA na mediana dos dias visíveis (cada gráfico com os seus valores).
    // A mediana não se deixa puxar por dias extremos (feriado, pico); o dia ainda em andamento fica de fora da conta.
    const fechados = ivC.map((c, i) => ({ c, t: ivT[i] })).filter(x => !x.c.andamento);
    const cmp = comRef ? { porDia: true, porRef: fechados.length ? [1] : [], nome: `dos ${fechados.length} dias`, curto: 'por dia',
      linha: f => Hs.mediana(fechados.map(x => f(x.c.v, x.t.v))), linhaEsp: () => Hs.mediana(fechados.map(x => x.c.esp ? x.c.esp.pico : null)),
      notaTx: `<span><i class="ref"></i>linha: mediana dos ${fechados.length} dias ${evo.cmp === 'sem' ? 'da semana ' : ''}no gráfico${ivC.some(c => c.andamento) ? ' (sem o dia em andamento)' : ''} — dias extremos não puxam a linha</span>` } : null;
    return {
      ivC, ivT, iSel, cmp, acum: true, porDia: true, suf: ' <small>· por dia</small>',
      rot: c => c.rotTab.slice(4), tit: c => c.perTx,
      per: { aC: soma(somaC), aT: soma(somaT), esp: maior, parcial: false, onde: '', soMed: true, med: cmp ? cmp.linha : null, medEsp: cmp ? cmp.linhaEsp : null },
      dica: `<div class="cap">Cada coluna é um dia inteiro${dias.some(usaPulse) ? ' (o dia do Pulse vai até a última coleta)' : ''}: ${evo.cmp === 'sem' ? `os ${DS_PLURAL[Hs.diaSemana(A)]} até ${ddmmaaaa(A).slice(0, 5)}` : `os dias seguidos até ${ddmmaaaa(A).slice(0, 5)}`}. Embaixo do título, o total desses dias; no rodapé, a mediana por dia. Toque numa coluna para ver o dia.</div>`
    };
  }

  // Controles da Evolução: três botões sempre à vista (atendimento · modo · eixo); cada um abre um menu suspenso com as
  // opções; escolher fecha o menu e aplica. Tocar fora (ou Esc) fecha sem mudar nada.
  function menuCtl(k, rotulo, opcoes, atual, nome, off) {
    const ab = !off && evo.menu === k;
    return `<div class="ctl-m"><button class="ctl-p" data-menu="${k}" aria-haspopup="listbox" aria-expanded="${ab}" aria-label="${nome}: ${esc(rotulo)}"${off ? ' disabled title="Na vista por dia, cada coluna é um dia inteiro"' : ''}>` +
      `<span>${esc(rotulo)}</span><svg class="ctl-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button>` +
      (ab ? `<div class="ctl-menu" role="listbox" aria-label="${nome}">${opcoes.map(([v, t]) => { const on = String(atual) === String(v);
        return `<button role="option" data-${k}="${v}" aria-selected="${on}" class="${on ? 'on' : ''}"><span>${esc(t)}</span>${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</button>`; }).join('')}</div>` : '') + '</div>';
  }
  function fecharMenu() {
    if (!evo.menu) return;
    evo.menu = null;
    document.querySelectorAll('#pgEvo .ctl-menu').forEach(m => m.remove());
    document.querySelectorAll('#pgEvo [data-menu]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  // Origem dos dados do dia em exibição: avisa no rodapé (some sozinho) ao entrar na Evolução e sempre que mudar.
  function avisoFonte(ctx) {
    const f = ctx.vivo ? (ctx.iso === hojeISO() ? 'Ao vivo · Pulse' : 'Pulse') : 'Histórico · Genesys';
    if (evo.fonteVista !== f) { evo.fonteVista = f; toast(f); }
  }
  function renderEvo() {
    const ctx = diaEvo(), d = ctx.d, L = d.leituras[d.leituras.length - 1];
    avisoFonte(ctx);
    const filtroDir = dir => filtroEvo(d, dir);
    // grupos do atendimento escolhido, com as oferecidas do dia (prévia do volume): maior volume primeiro, zerados no fim
    const volGrp = new Map();
    D.filtro(d, { dir: evo.dir }).forEach(s => { const g = d.trad[s].SKILL_GRUPO; volGrp.set(g, (volGrp.get(g) || 0) + ((L.v[s] && L.v[s].Distinct_Entered) || 0)); });
    const grpsDisp = [...volGrp.keys()].sort((a, b) => volGrp.get(b) - volGrp.get(a) || a.localeCompare(b));
    const volTodos = [...volGrp.values()].reduce((a, b) => a + b, 0);
    if (evo.grupo && !grpsDisp.includes(evo.grupo)) { evo.grupo = null; evo.skill = null; }
    if (evo.skill && !D.filtro(d, { dir: evo.dir, grupo: evo.grupo }).some(s => d.trad[s].SKILL_SIMPLIFICADO === evo.skill)) evo.skill = null;
    const co = filtroDir('CO'), tel = filtroDir('TEL');
    const el = $('#pgEvo');
    const passo = evo.passo === 'auto' ? D.passoAuto(d, maxColunas(el)) : +evo.passo;
    const acum = evo.modo === 'acum';
    const vistaDia = evo.vista === 'dia';
    let ivC = D.intervalos(d, passo, co), ivT = D.intervalos(d, passo, tel);
    if (acum) { ivC = D.acumulados(d, ivC, co); ivT = D.acumulados(d, ivT, tel); }
    const n = ivC.length;
    const fimDe = c => c.andamento ? c.ateM : c.fim;
    const suf = acum ? ' <small>· acumulado</small>' : '';
    if (!vistaDia && evo.sel != null && !ivC.some(i => i.ini === evo.sel)) evo.sel = null;
    const iSel = vistaDia || evo.sel == null ? -1 : ivC.findIndex(i => i.ini === evo.sel);
    const dir = evo.dir;
    const temCO = dir !== 'TEL', temTEL = dir !== 'CO';

    // no acumulado, a coluna leva o horário do FIM (total do dia até ali)
    const rot = i => acum ? (i.andamento ? D.hhmm(i.ateM) : rotPasso(i.fim, passo)) : rotPasso(i.ini, passo);
    const tit = i => acum ? `Acumulado até ${D.hhmm(fimDe(i))}${i.andamento ? ' (em andamento)' : ''}` : `${D.hhmm(i.ini)}–${D.hhmm(fimDe(i))}${i.andamento ? ' (em andamento)' : ''}`;
    // Números dos botões de grupo: sem seleção = oferecidas do dia; com coluna selecionada = oferecidas DAQUELA coluna
    // (no intervalo, ou acumuladas até ela no modo Acumulado). A ordem dos botões continua pelo volume do dia.
    const chipVol = new Map();
    let chipTodos = 0, ondeChip = 'no dia';
    if (iSel >= 0) {
      const c = ivC[iSel];
      ondeChip = acum ? 'até ' + D.hhmm(fimDe(c)) : D.hhmm(c.ini) + '–' + D.hhmm(fimDe(c));
      const lFim = c.semColeta ? null : d.leituras.find(x => x.m === c.ateM);
      const lIni = !acum && c.baseM != null ? d.leituras.find(x => x.m === c.baseM) : null;
      const de = (l, sk) => l && l.v[sk] ? (l.v[sk].Distinct_Entered || 0) : 0;
      if (!lFim) { chipTodos = null; grpsDisp.forEach(g => chipVol.set(g, null)); }
      else {
        D.filtro(d, { dir: evo.dir }).forEach(sk => { const g = d.trad[sk].SKILL_GRUPO; chipVol.set(g, (chipVol.get(g) || 0) + Math.max(0, de(lFim, sk) - de(lIni, sk))); });
        chipTodos = [...chipVol.values()].reduce((a, b) => a + b, 0);
      }
    } else { grpsDisp.forEach(g => chipVol.set(g, volGrp.get(g))); chipTodos = volTodos; }
    const cmp = comparacao(ctx.iso, passo, acum, L.m);
    const temCmp = !!(cmp && cmp.porRef.length);
    const temFilaDia = ctx.vivo || !!d.temFila;      // o dia tem a fila? (Pulse sempre; histórico com o historico_fila.csv)
    // controles recolhidos: só o que está escolhido, numa linha
    const resumoCtl = [{ TODOS: 'Total URA', CO: 'CO', TEL: 'TEL' }[dir], vistaDia ? 'Por dia' : acum ? 'Acumulado' : 'Por intervalo', vistaDia ? 'Dias' : evo.passo === 'auto' ? 'Auto · ' + PASSO_NOME[passo] : PASSO_NOME[passo]];
    // sem cards: os totais e a comparação com a mediana ficam nos próprios gráficos (embaixo do título e no rodapé)
    const kBan = iSel >= 0 && ivC[iSel].semColeta ? `<div class="banner warn">${rot(ivC[iSel])}: sem coleta neste horário${acum ? '.' : ' — o volume entra no intervalo seguinte.'}</div>` : '';
    const per = { aC: D.agregar(L, co), aT: D.agregar(L, tel), esp: D.espera(d.leituras, -1, L.m, co), parcial: false, onde: '',
      med: f => medDia(cmp, f), medEsp: () => medEspDia(cmp, L.m) };

    let nGraf = 0;
    // filtro aplicado, mostrado no rodapé de cada gráfico:
    //   CO ou TEL → "CO"; com grupo → "CO – GRUPO"; Total URA → nada; Total URA com grupo → "GRUPO",
    //   ou "CO – GRUPO"/"TEL – GRUPO" quando o grupo só existe num dos dois atendimentos
    let filtroTx = '';
    if (dir !== 'TODOS') filtroTx = dir + (evo.grupo ? ' – ' + evo.grupo : '') + (evo.skill ? ' › ' + evo.skill : '');
    else if (evo.grupo) {
      const ds = [...new Set(D.filtro(d, { dir: 'TODOS', grupo: evo.grupo }).map(s => d.trad[s].DIRECIONAMENTO))];
      filtroTx = (ds.length === 1 ? ds[0] + ' – ' : '') + evo.grupo + (evo.skill ? ' › ' + evo.skill : '');
    }
    // vista por hora (o dia em horários) ou por dia (o eixo recebe dias): os mesmos gráficos
    const gr = vistaDia ? vistaDias(ctx, el) : { ivC, ivT, iSel, rot, tit, cmp, per, acum, suf };
    evoCols = gr.ivC;
    let html = '';
    html += graficos({ ivC: gr.ivC, ivT: gr.ivT, dir, acum: gr.acum, passo, iSel: gr.iSel, rot: gr.rot, tit: gr.tit, cmp: gr.cmp, temFilaDia: vistaDia || temFilaDia, vivo: ctx.vivo,
      filtroTx, pre: 'evo', suf: gr.suf, cmpTipo: evo.cmp, per: gr.per, porDia: gr.porDia, dica: gr.dica, gopt: vistaDia ? { maxRot: 12 } : undefined });
    html += painelGrupos(d, L, ivC, iSel, acum);
    html += vistaDia ? tabelaIntervalos(gr.ivC, gr.ivT, dir, passo, gr.iSel, true, { rot: c => c.rotTab + (c.andamento ? '*' : ''), titulo: 'Dias', h1: 'Dia' })
      : tabelaIntervalos(ivC, ivT, dir, passo, iSel, acum);

    el.innerHTML = `
      <div class="evo-ctl fixo">
      ${navDia(ctx)}
      <div class="card topbar">
        <div class="ctl-l">${menuCtl('dir', resumoCtl[0], [['TODOS', 'Total URA'], ['CO', 'CO'], ['TEL', 'TEL']], dir, 'Atendimento')}${vistaDia
          ? menuCtl('ndias', evo.ndias + ' dias', [7, 8, 9, 10, 11, 12, 13].map(n => [n, n + ' dias']), evo.ndias, 'Quantidade de dias')
          : menuCtl('modo', resumoCtl[1], [['int', 'Por intervalo'], ['acum', 'Acumulado']], evo.modo, 'Modo') + menuCtl('passo', resumoCtl[2], ['auto', 15, 30, 60, 120].map(v => [v, v === 'auto' ? 'Auto · ' + PASSO_NOME[D.passoAuto(d, maxColunas(el))] : PASSO_NOME[v]]), evo.passo, 'Intervalo do eixo')}</div>
        ${gr.iSel >= 0 ? `<button class="selchip" data-act="limpar"><span>Selecionado: <b>${gr.tit(gr.ivC[gr.iSel])}</b> · toque para limpar</span><span aria-hidden="true">✕</span></button>` : ''}
      </div>
      <div class="chips${iSel >= 0 ? ' per' : ''}" role="group" aria-label="Grupo (oferecidas ${esc(ondeChip)})">${[null, ...grpsDisp].map(g => {
        const v = g == null ? chipTodos : chipVol.get(g);
        return `<button class="chip${v ? '' : ' zero'}" data-grp="${esc(g || '')}" aria-pressed="${evo.grupo === g}" title="${v == null ? 'sem coleta' : fI(v) + ' oferecidas ' + esc(ondeChip)}">${esc(g || 'Todos os grupos')}<span class="qt num">${v == null ? '—' : fI(v)}</span></button>`;
      }).join('')}</div>
      </div>
      ${kBan}
      ${hist ? chaveCmp(ctx) : ''}
      ${html}
      ${cartaoAlarmesEvo(ctx)}`;    ajustarData();
  }
  // a data da barra começa em 18 px e só diminui se não couber (tela estreita com "Último" e o botão Horas/Dia)
  function ajustarData() {
    const b = $(pgAtual() + ' .dn-t b'); if (!b) return;
    const caixa = b.closest('.dn-d'); let fs = 18;
    b.style.fontSize = '';
    while (fs > 12 && b.scrollWidth > caixa.clientWidth - 6) { fs -= 0.5; b.style.fontSize = fs + 'px'; }
  }
  // cor da fila pela espera mais longa (mesma régua da lista "Em espera agora")
  const corEspera = s => s >= 300 ? 'var(--rosa)' : s >= 120 ? 'var(--laranja)' : 'var(--p300)';
  const media = iv => { const v = iv.filter(i => i.v && !i.andamento); return v.length ? v.reduce((s, i) => s + i.v.ofer, 0) / v.length : null; };
  // rótulo curto de tempo para as colunas: "45s", "4m49", "1h02"
  const minCurto = s => { s = Math.round(s); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') : Math.floor(s / 3600) + 'h' + String(Math.floor(s % 3600 / 60)).padStart(2, '0'); };

  // skills agrupadas pelo nome simplificado da tradutora (o "nome de uso"); uma entrada pode juntar várias skills do Pulse
  function porSimpl(d, dir) {
    const m = new Map();
    D.filtro(d, { dir }).forEach(s => { const k = d.trad[s].SKILL_SIMPLIFICADO; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
    return m;
  }

  // Resumo do intervalo selecionado, centralizado: período em cima e, embaixo, só os valores do gráfico em questão.
  function capGraf(tipo, c, t, dir, extra) {
    const ac = !!c.acum, fim = D.hhmm(c.andamento ? c.ateM : c.fim);
    const per = c.perTx || (ac ? `Acumulado até ${fim}` : `${D.hhmm(c.ini)}–${fim}`) + (c.andamento ? ' · em andamento' : '');
    const ref = extra && extra.refHtml ? `<small class="cref">${extra.refHtml}</small>` : '';
    const caixa = (val, nota) => `<div class="cap capsel csel"><b>${per}</b><span>${val}</span>${nota ? `<small>${nota}</small>` : ''}${ref}</div>`;
    const pl = (n, um, varios) => fI(n) + ' ' + (n === 1 ? um : varios);
    if (tipo === 'esp') {
      const e = c.esp;
      if (!e) return caixa('sem coleta neste horário');
      if (ac) return caixa(e.pico ? `maior fila do dia até aqui: <b>${pl(e.pico, 'técnico', 'técnicos')}</b> às ${D.hhmm(e.picoM)} · espera mais longa ${fS(e.espMax)}`
        : 'nenhum técnico em espera no dia até aqui', `${e.n} coletas desde o início do dia`);
      return caixa(e.pico ? `pico de <b>${pl(e.pico, 'técnico', 'técnicos')}</b> em espera às ${D.hhmm(e.picoM)} · espera mais longa ${fS(e.espMax)}`
        : 'nenhum técnico em espera nas coletas', e.n > 1 ? `maior valor entre ${e.n} coletas do intervalo` : '');
    }
    if (c.semColeta) return caixa('sem coleta neste horário', ac ? '' : 'o volume entra no intervalo seguinte');
    const nota = c.juntaAnterior ? `inclui o volume desde ${D.hhmm(c.baseM)} (horário sem coleta)` : c.incluiAntes ? 'inclui o que entrou antes da primeira coleta do dia' : '';
    const v = c.v, tv = t && t.v ? t.v.ofer : 0;
    if (tipo === 'of') {
      if (dir === 'TEL') return caixa(`<b>${pl(tv, 'oferecida', 'oferecidas')}</b> na TEL`, nota);
      if (dir === 'TODOS') return caixa(`<b>${pl(v.ofer + tv, 'oferecida', 'oferecidas')}</b> · CO ${fI(v.ofer)} · TEL ${fI(tv)}`, nota);
      return caixa(`<b>${pl(v.ofer, 'oferecida', 'oferecidas')}</b> · ${fI(v.atend)} atendidas · ${fI(v.aband)} abandonadas`, nota);
    }
    if (tipo === 'dir') return caixa(v.dir60 == null ? 'sem chamadas atendidas' : `<b>${fP(v.dir60)}</b> atendidos direto · ${fI(v.a60)} de ${fI(v.atend)} em até 1&nbsp;min`, nota);
    if (tipo === 'ns') {
      const sit = situacao(v.ns);
      if (ac) return caixa(v.ns == null ? 'sem chamadas oferecidas' : `NS <b class="c-${sit}">${fP(v.ns)}</b> · ${fI(v.a300)} de ${fI(v.ofer)} oferecidas em até 5&nbsp;min`, nota);
      return caixa(v.ns == null ? 'sem chamadas finalizadas' : `NS <b class="c-${sit}">${fP(v.ns)}</b> · ${fI(v.a300)} de ${fI(v.fin)} finalizadas em até 5&nbsp;min`, nota);
    }
    if (tipo === 'ab') return caixa(v.abandPct == null ? (ac ? 'sem chamadas oferecidas' : 'sem chamadas finalizadas')
      : `<b>${fP(v.abandPct)}</b> abandonadas · ${fI(v.aband)} de ${fI(ac ? v.ofer : v.fin)} ${ac ? 'oferecidas' : 'finalizadas'}`, nota);
    if (tipo === 'tma') return caixa(v.tma == null ? 'sem chamadas atendidas' : `TMA <b>${fS(v.tma)}</b> · TME ${fS(v.tme)} · ${pl(v.atend, 'atendida', 'atendidas')}`, nota);
    if (tipo === 'tme') return caixa(v.tme == null ? 'sem chamadas atendidas' : `TME <b>${fS(v.tme)}</b> · TMA ${fS(v.tma)} · ${pl(v.atend, 'atendida', 'atendidas')}`, nota);
    return caixa('');
  }

  // Gráficos da Evolução (oferecidas, fila, atendidos direto, NS, abandono, TME, TMA), usados também na aba Agora.
  // o: { ivC, ivT, dir, acum, passo, iSel, rot, tit, cmp, temFilaDia, vivo, filtroTx, pre (prefixo do id), suf,
  //      gopt (opções extras do G.barras), fixoOf (resumo fixo do 1º gráfico sem seleção), notaExtra, cmpTipo }
  // Colunas com futuro: true (resto da hora, na aba Agora) ficam vazias, só com o previsto atrás.
  function graficos(o) {
    const { ivC, ivT, dir, acum, passo, iSel, rot, tit, cmp, temFilaDia, vivo, filtroTx, pre, suf, fixoOf, notaExtra, cmpTipo } = o;
    const gopt = o.gopt || {};
    // per: o período em exibição (o dia até agora na Evolução; a hora até agora na aba Agora), para o total embaixo do
    // título e a comparação com a mediana no rodapé: { aC, aT, esp, onde, med(f), medEsp() }
    const P = o.per, porDia = !!o.porDia;
    const totH = (v, sub) => `<b class="ch-v">${v}</b>${sub ? `<small>${sub}</small>` : ''}`;
    const detH = (f, fmt, atual, pp) => {
      if (!P || !temCmp || !P.med) return '';
      const r = P.med(f);
      if (P.soMed) return `mediana por dia: <b>${r == null ? '—' : fmt(r)}</b>`;
      return `med. ${esc(cmp.curto)}${P.onde ? ' ' + esc(P.onde) : ''}: <b>${r == null ? '—' : fmt(r)}</b>${r == null ? '' : ' ' + difTx(atual, r, pp)}`;
    };
    const pC = P && P.aC, pT = P && P.aT;
    const temCmp = !!(cmp && cmp.porRef.length);
    const temCO = dir !== 'TEL', temTEL = dir !== 'CO';
    const vaz = c => ({ rot: rot(c), titulo: tit(c), segs: [] });
    // 1) oferecidas
    const colsOf = ivC.map((c, i) => {
      const t = ivT[i];
      if (c.futuro) return vaz(c);
      const base = { rot: rot(c), and: c.andamento, sd: c.semColeta, titulo: tit(c) };
      if (c.semColeta) return base;
      const vc = temCO ? c.v.ofer : 0, vt = temTEL && t && t.v ? t.v.ofer : 0;
      const segs = dir === 'CO' ? [{ v: c.v.ofer - Math.min(c.v.aband, c.v.ofer), cor: 'var(--sCO)' }, { v: Math.min(c.v.aband, c.v.ofer), cor: 'var(--sAb)' }]
        : [{ v: vc, cor: 'var(--sCO)' }, { v: vt, cor: 'var(--sTEL)' }];
      return Object.assign(base, { segs, lab: fI(vc + vt) });
    });
    const legOf = dir === 'CO' ? '<span><i style="background:var(--sCO)"></i>oferecidas</span><span><i style="background:var(--sAb)"></i>parte abandonada</span>'
      : (temCO ? '<span><i style="background:var(--sCO)"></i>CO</span>' : '') + '<span><i style="background:var(--sTEL)"></i>TEL</span>';
    const notas = [];
    if (ivC.some(i => i.andamento)) notas.push('<span><i class="and"></i>* em andamento (até a última coleta)</span>');
    if (ivC.some(i => i.semColeta)) notas.push(`<span><i class="sd"></i>${acum ? 'sem coleta neste horário' : 'sem coleta (volume no intervalo seguinte)'}</span>`);
    if (notaExtra) notas.push(notaExtra);
    if (cmp && cmp.notaTx && temCmp) notas.push(cmp.notaTx);
    else if (cmp) notas.push(temCmp
      ? `<span><i class="ref"></i>área clara: mediana ${cmpTipo === 'sem' ? 'das últimas ' : 'dos últimos '}${esc(cmp.nome)} do histórico (${cmp.refs.map(r => ddmmaaaa(r).slice(0, 5)).join(', ')}) — o previsto para o horário${ivC.some(i => i.andamento) ? ' · na coluna em andamento, o previsto vai até o mesmo minuto da última coleta (proporcional dentro do bloco de 15 min do histórico)' : ''}</span>`
      : '<span>sem dias anteriores no histórico para comparar</span>');
    const capPadrao = !acum && ivC.length && ivC[0].incluiAntes ? `A 1ª coluna (${rot(ivC[0])}) inclui o que entrou antes da primeira coleta do dia.` : 'Toque numa coluna para selecionar · toque de novo para limpar.';
    // o resumo do intervalo selecionado fica sempre à vista, centralizado, só com os valores DAQUELE gráfico;
    // legenda e explicações ficam no botão (i)
    const selTx = (tipo, extra) => iSel >= 0 ? capGraf(tipo === 'oftel' || tipo === 'ofco' ? 'of' : tipo, ivC[iSel], ivT[iSel], tipo === 'oftel' ? 'TEL' : tipo === 'ofco' ? 'CO' : dir, extra) : (tipo === 'of' && fixoOf) || '';
    // mediana da coluna selecionada no resumo de cada gráfico
    const refSel = (f, fmt, atual, pp) => {
      if (!temCmp || iSel < 0) return null;
      const c = ivC[iSel], r = medCol(cmp, c, f);
      return `mediana ${esc(cmp.nome)}${c.andamento ? ' até ' + D.hhmm(c.ateM) : ''}: <b>${r == null ? '—' : fmt(r)}</b>${r == null ? '' : ' ' + difTx(atual, r, pp)}`;
    };
    const cS = iSel >= 0 ? ivC[iSel] : null, tS = iSel >= 0 ? ivT[iSel] : null, vS = cS && cS.v, vT = tS && tS.v;
    const fOf = (v, t) => dir === 'CO' ? v.ofer : dir === 'TEL' ? (t ? t.ofer : 0) : v.ofer + (t ? t.ofer : 0);
    const fAb = v => acum ? v.aband : v.abandPct;
    const refArr = f => temCmp ? ivC.map(c => medCol(cmp, c, f)) : null;
    const corOf = dir === 'TEL' ? 'var(--sTEL)' : 'var(--sCO)';
    const dica = o.dica || `<div class="cap">${acum ? 'Modo acumulado: cada coluna mostra o total do dia até o horário dela. ' : ''}${capPadrao}${!acum && ivC.length && ivC[0].incluiAntes ? ' Toque numa coluna para selecionar · toque de novo para limpar.' : ''}</div>`;
    const graf = (titulo, svg, leg, tipo, extra, tot, det) => cartaoGraf(pre + '-' + tipo, titulo, svg, `<div class="legend">${leg}${notas.join('')}</div>${dica}`, selTx(tipo, extra), filtroTx, '', tot, det);

    const totOf = P ? fOf(pC, pT) : null;
    let html = graf((acum ? 'Chamadas oferecidas' : 'Chamadas oferecidas por intervalo') + suf, G.barras({ ...gopt, cols: colsOf, sel: iSel, ref: refArr(fOf), refCor: corOf, aria: 'Chamadas oferecidas' }), legOf, 'of',
      { refHtml: vS ? refSel(fOf, fI, fOf(vS, vT)) : null },
      P ? totH(fI(totOf), dir === 'TODOS' ? `CO ${fI(pC.ofer)} · TEL ${fI(pT.ofer)}` : dir === 'CO' ? `atendidas ${fI(pC.atend)} · abandonadas ${fI(pC.aband)}` : '') : '',
      detH(fOf, fI, totOf));
    if (dir === 'TODOS') {
      // no Total URA: a TEL e o CO separados; o gráfico do CO encabeça os gráficos que só o CO tem (fila, NS, tempos)
      const fTel = (v, t) => t ? t.ofer : 0;
      const colsTel = ivC.map((c, i) => { const t = ivT[i]; if (c.futuro) return vaz(c);
        const base = { rot: rot(c), and: c.andamento, sd: c.semColeta, titulo: tit(c) }; if (c.semColeta || !t || !t.v) return Object.assign(base, { sd: true });
        return Object.assign(base, { segs: [{ v: t.v.ofer, cor: 'var(--sTEL)' }], lab: fI(t.v.ofer) }); });
      html += graf((acum ? 'Oferecidas TEL' : 'Oferecidas TEL por intervalo') + suf, G.barras({ ...gopt, cols: colsTel, sel: iSel, ref: refArr(fTel), refCor: 'var(--sTEL)', aria: 'Oferecidas TEL' }),
        '<span><i style="background:var(--sTEL)"></i>TEL: chamadas encaminhadas à parceira (só volume)</span>', 'oftel',
        { refHtml: vS ? refSel(fTel, fI, vT ? vT.ofer : 0) : null },
        P ? totH(fI(pT.ofer), (pC.ofer + pT.ofer) ? fP(pT.ofer / (pC.ofer + pT.ofer) * 100) + ' da URA' : '') : '', detH(fTel, fI, P ? pT.ofer : 0));
      const colsCo = ivC.map(c => { if (c.futuro) return vaz(c);
        const base = { rot: rot(c), and: c.andamento, sd: c.semColeta, titulo: tit(c) }; if (c.semColeta) return base;
        return Object.assign(base, { segs: [{ v: c.v.ofer - Math.min(c.v.aband, c.v.ofer), cor: 'var(--sCO)' }, { v: Math.min(c.v.aband, c.v.ofer), cor: 'var(--sAb)' }], lab: fI(c.v.ofer) }); });
      html += graf((acum ? 'Oferecidas CO' : 'Oferecidas CO por intervalo') + suf, G.barras({ ...gopt, cols: colsCo, sel: iSel, ref: refArr(v => v.ofer), refCor: 'var(--sCO)', aria: 'Oferecidas CO' }),
        '<span><i style="background:var(--sCO)"></i>oferecidas CO</span><span><i style="background:var(--sAb)"></i>parte abandonada</span>', 'ofco',
        { refHtml: vS ? refSel(v => v.ofer, fI, vS.ofer) : null },
        P ? totH(fI(pC.ofer), `atendidas ${fI(pC.atend)} · abandonadas ${fI(pC.aband)}`) : '', detH(v => v.ofer, fI, P ? pC.ofer : 0));
    }
    if (temCO) {
      // técnicos em espera: pico do intervalo (retrato das coletas), cor pela espera mais longa
      if (temFilaDia) {
      const colsEsp = ivC.map(c => {
        if (c.futuro) return vaz(c);
        const base = { rot: rot(c), and: c.andamento, titulo: tit(c) };
        if (!c.esp) return Object.assign(base, { sd: true });
        // rótulo: % das oferecidas do CO que enfrentaram fila (atendidas depois de 1 min) em cima; o pico embaixo
        const pf = c.v && c.v.ofer ? Math.max(0, c.v.atend - c.v.a60) / c.v.ofer * 100 : null;
        return Object.assign(base, { segs: [{ v: c.esp.pico, cor: corEspera(c.esp.espMax) }], ok: c.esp.pico === 0,
          lab: !c.esp.pico ? '' : pf == null ? fI(c.esp.pico) : Math.round(pf) + '%', lab2: !c.esp.pico || pf == null ? '' : fI(c.esp.pico) });
      });
      // total: maior fila do período e quantos ENFRENTARAM fila: atendidas depois de 1 min ÷ oferecidas do CO
      const pE = P && P.esp, pctFila = P && pC.ofer ? Math.max(0, pC.atend - pC.a60) / pC.ofer * 100 : null;
      const rEsp = P && temCmp && P.medEsp ? P.medEsp() : null;
      const totEsp = P ? totH(pE ? fI(pE.pico) : '—', `${pE && pE.pico ? (pE.picoTx || 'pico às ' + D.hhmm(pE.picoM)) + ' · ' : ''}${pctFila == null ? '' : `<b>${fP(pctFila)}</b> das oferecidas enfrentaram fila`}`) : '';
      const detEsp = P && temCmp && P.medEsp && P.soMed ? `maior fila, mediana por dia: <b>${rEsp == null ? '—' : fI(rEsp)}</b>` : P && temCmp && P.medEsp ? `med. ${esc(cmp.curto)}${P.onde ? ' ' + esc(P.onde) : ''}: <b>${rEsp == null ? '—' : fI(rEsp)}</b>${rEsp == null || !pE ? '' : ' ' + difTx(pE.pico, rEsp)}` : '';
      html += graf('Em espera' + (dir === 'TODOS' ? ' · CO' : '') + (porDia ? ' <small>· maior fila de cada dia</small>' : acum ? ' <small>· maior fila do dia até o horário</small>' : ''),
        G.barras({ ...gopt, cols: colsEsp, sel: iSel, ref: temCmp ? ivC.map(c => medEsp(cmp, c)) : null, refCor: 'var(--p500)', aria: 'Em espera por intervalo' }),
        `<span><i style="background:var(--okc);border-radius:50%"></i>sem fila</span><span><i style="background:var(--p300)"></i>espera mais longa até 2 min</span><span><i style="background:var(--laranja)"></i>2 a 5 min</span><span><i style="background:var(--rosa)"></i>acima de 5 min</span>` +
        (acum ? '<span>maior número de técnicos esperando ao mesmo tempo, do início do dia até o horário da coluna (a fila é um retrato: não se soma ao longo do tempo)</span>'
          : `<span>maior número de técnicos esperando ao mesmo tempo nas coletas do intervalo (${passo < 15 ? 'de 5 em 5 min' : 'horas fechadas: uma coleta a cada 15 min'})</span>`) +
        '<span>rótulo: % das oferecidas do CO que enfrentaram fila — atendidas depois de 1&nbsp;min (em cima) e o maior número de técnicos esperando ao mesmo tempo (embaixo)</span>' +
        '<span>embaixo do título: a maior fila do período e quantos enfrentaram fila no período</span>' +
        (vivo ? '' : '<span>dia do histórico: fila refeita chamada a chamada pelo Genesys (quem passou dos 120 s de URA e ainda não tinha sido atendido nem desistido), no mesmo retrato de 15 em 15 min do Pulse</span>'), 'esp',
        { refHtml: temCmp && iSel >= 0 && ivC[iSel].esp ? (() => { const r = medEsp(cmp, ivC[iSel]); return `mediana ${esc(cmp.nome)}${ivC[iSel].andamento ? ' até ' + D.hhmm(ivC[iSel].ateM) : ''}: <b>${r == null ? '—' : fI(r)}</b>${r == null ? '' : ' ' + difTx(ivC[iSel].esp.pico, r)}`; })() : null },
        totEsp, detEsp);
      } else {
        // dia do histórico fora do arquivo da fila (ou sem ele): o cartão fica no lugar, explicando e levando ao dia do Pulse.
        const diaP = dados ? ddmmaaaa(dados.dia).slice(0, 5) : '';
        html += `<div class="card chart semfila" data-ch="${pre}-esp"><h2>Em espera${dir === 'TODOS' ? ' · CO' : ''}</h2>
          <p class="nota">${hist && hist.colsFila ? 'O histórico deste dia veio sem a coluna FILA.'
            : hist && hist.fila ? `Sem a fila deste dia: o arquivo da fila do histórico vai de ${ddmmaaaa(hist.fila.inicio).slice(0, 5)} a ${ddmmaaaa(hist.fila.fim).slice(0, 5)}.`
            : `A fila é um retrato tirado a cada coleta do Pulse. O histórico em uso não traz a fila (colunas FILA e ESPERA_MAX_S), por isso este gráfico só existe no dia do Pulse${diaP ? ' (' + diaP + ')' : ''}.`}</p>
          <button class="bt sm" data-navdia="fim">Ver o dia do Pulse${diaP ? ' · ' + diaP : ''}</button></div>`;
      }
      // atendidos direto (em até 1 min)
      // altura = QUANTIDADE de técnicos atendidos em até 1 min (no intervalo, ou somada no dia no Acumulado);
      // rótulo: % das atendidas em cima (maior) e a quantidade embaixo (menor)
      const colsDir = ivC.map(c => c.futuro ? vaz(c) : c.semColeta ? { rot: rot(c), sd: true, titulo: tit(c) } : {
        rot: rot(c), and: c.andamento, titulo: tit(c), segs: [{ v: c.v.a60 || 0, cor: 'var(--sCO)' }],
        lab: c.v.dir60 == null ? '' : Math.round(c.v.dir60) + '%', lab2: c.v.dir60 == null ? '' : fI(c.v.a60) });
      html += graf('Atendidos direto' + (dir === 'TODOS' ? ' · CO' : '') + suf, G.barras({ ...gopt, cols: colsDir, sel: iSel, ref: refArr(v => v.a60), refCor: 'var(--sCO)', aria: 'Atendidos em até 1 minuto' }),
        (acum ? '<span><i style="background:var(--sCO)"></i>altura: técnicos atendidos em até 1&nbsp;min, somados do início do dia até o horário</span>'
          : '<span><i style="background:var(--sCO)"></i>altura: técnicos atendidos em até 1&nbsp;min no intervalo</span>') +
        `<span>rótulo: % das atendidas ${acum ? 'no dia até o horário' : 'no intervalo'} (em cima) e quantidade de técnicos atendidos direto (embaixo)</span>`, 'dir',
        { refHtml: vS ? refSel(v => v.a60, fI, vS.a60) : null },
        P ? totH(fI(pC.a60), pC.dir60 == null ? '' : fP(pC.dir60) + ' das atendidas, em até 1&nbsp;min') : '', detH(v => v.a60, fI, P ? pC.a60 : 0));
      // 2) NS do intervalo (sem a linha do NS acumulado do dia: o card do topo já mostra o NS do dia)
      const colsNS = ivC.map(c => c.futuro ? vaz(c) : c.semColeta ? { rot: rot(c), sd: true, titulo: tit(c) } : {
        rot: rot(c), and: c.andamento, titulo: tit(c),
        segs: [{ v: c.v.ns == null ? 0 : c.v.ns, cor: corSit(situacao(c.v.ns)) }],
        lab: c.v.ns == null ? '' : Math.round(c.v.ns) + '%' });
      html += graf((acum ? 'NS (<span class="un">5 min</span>)' : 'NS (<span class="un">5 min</span>) por intervalo') + (dir === 'TODOS' ? ' · CO' : '') + suf,
        // a mediana fica como área clara atrás das barras
        G.barras({ ...gopt, cols: colsNS, max: 100, meta: META_NS, metaTx: META_NS + '%', ref: refArr(v => v.ns), refCor: 'var(--p500)', sel: iSel, aria: 'Nível de serviço' }),
        `<span><i style="background:var(--verdeS)"></i>Meta atingida</span><span><i style="background:var(--amareloS)"></i>Em atenção</span><span><i style="background:var(--vermelhoS)"></i>Crítico</span><span><i class="dash"></i>meta ${META_NS}%</span>` +
        (acum ? '<span>colunas: NS do dia até o horário — atendidas em até 5&nbsp;min ÷ oferecidas, como no Pulse</span>' : '<span>colunas: atendidas em até 5&nbsp;min ÷ chamadas finalizadas no intervalo (atendidas + abandonadas)</span>'),
        'ns', { refHtml: vS ? refSel(v => v.ns, x => fP(x), vS.ns, true) : null },
        P ? totH(nsTx(pC.ns), `meta ${META_NS}% · ${fI(pC.a300)} de ${fI(P.parcial ? pC.fin : pC.ofer)} ${P.parcial ? 'finalizadas' : 'oferecidas'} em até 5&nbsp;min`) : '', detH(v => v.ns, x => fP(x), P ? pC.ns : null, true));
      // 3) abandono
      const colsAb = ivC.map(c => c.futuro ? vaz(c) : c.semColeta ? { rot: rot(c), sd: true, titulo: tit(c) } : {
        rot: rot(c), and: c.andamento, titulo: tit(c), segs: [{ v: acum ? c.v.aband : (c.v.abandPct || 0), cor: 'var(--sAb)' }],
        // nenhum técnico abandonou: o mesmo visto verde da fila zerada
        ok: !c.v.aband, lab: !c.v.aband || c.v.abandPct == null ? '' : Math.round(c.v.abandPct) + '%', lab2: !c.v.aband || c.v.abandPct == null ? '' : fI(c.v.aband) });
      html += graf((acum ? 'Abandonadas' : 'Abandonadas por intervalo') + (dir === 'TODOS' ? ' · CO' : '') + suf, G.barras({ ...gopt, cols: colsAb, sel: iSel, ref: refArr(fAb), refCor: 'var(--sAb)', aria: 'Abandonadas' }),
        (acum ? '<span><i style="background:var(--sAb)"></i>altura: chamadas abandonadas, somadas do início do dia até o horário</span><span>rótulo: abandonadas ÷ oferecidas do dia (em cima) e quantidade (embaixo)</span>'
          : '<span><i style="background:var(--sAb)"></i>altura: abandonadas ÷ chamadas finalizadas no intervalo</span><span>rótulo: % (em cima) e quantidade de abandonadas (embaixo)</span>') +
        '<span><i style="background:var(--okc);border-radius:50%"></i>nenhum técnico abandonou</span>', 'ab',
        { refHtml: vS ? (acum ? refSel(v => v.aband, fI, vS.aband) : refSel(v => v.abandPct, x => fP(x), vS.abandPct, true)) : null },
        P ? totH(fI(pC.aband), pC.abandPct == null ? '' : fP(pC.abandPct) + (P.parcial ? ' das finalizadas' : ' das oferecidas')) : '', detH(v => v.aband, fI, P ? pC.aband : 0));
      // 4) TME
      const colsT = ivC.map(c => c.futuro ? vaz(c) : c.semColeta ? { rot: rot(c), sd: true, titulo: tit(c) } : {
        rot: rot(c), and: c.andamento, titulo: tit(c), segs: [{ v: c.v.tme || 0, cor: 'var(--sTme)' }], lab: c.v.tme == null ? '' : minCurto(c.v.tme) });
      html += graf((acum ? 'TME' : 'TME por intervalo') + (dir === 'TODOS' ? ' · CO' : '') + suf, G.barras({ ...gopt, cols: colsT, sel: iSel, ref: refArr(v => v.tme), refCor: 'var(--sTme)', aria: 'TME' }),
        `<span><i style="background:var(--sTme)"></i>TME (tempo médio de espera) das chamadas atendidas ${acum ? 'no dia até o horário' : 'no intervalo'}: tempo que o técnico esperou até ser atendido</span>`, 'tme',
        { refHtml: vS ? refSel(v => v.tme, fS, vS.tme) : null },
        P ? totH(fS(pC.tme), `${fI(pC.atend)} atendidas`) : '', detH(v => v.tme, fS, P ? pC.tme : null));
      // 5) TMA (média: no acumulado é a média do dia até ali, não soma)
      const colsTma = ivC.map(c => c.futuro ? vaz(c) : c.semColeta ? { rot: rot(c), sd: true, titulo: tit(c) } : {
        rot: rot(c), and: c.andamento, titulo: tit(c), segs: [{ v: c.v.tma || 0, cor: 'var(--sTma)' }], lab: c.v.tma == null ? '' : minCurto(c.v.tma) });
      html += graf((acum ? 'TMA' : 'TMA por intervalo') + (dir === 'TODOS' ? ' · CO' : '') + suf, G.barras({ ...gopt, cols: colsTma, sel: iSel, ref: refArr(v => v.tma), refCor: 'var(--sTma)', aria: 'TMA' }),
        `<span><i style="background:var(--sTma)"></i>TMA (tempo médio de atendimento) das chamadas atendidas ${acum ? 'no dia até o horário' : 'no intervalo'}: duração do atendimento (média ponderada pelas atendidas)</span>`, 'tma',
        { refHtml: vS ? refSel(v => v.tma, fS, vS.tma) : null },
        P ? totH(fS(pC.tma), `${fI(pC.atend)} atendidas`) : '', detH(v => v.tma, fS, P ? pC.tma : null));
    } else {
      html += `<div class="card"><p class="nota">A TEL é atendida em outro sistema: a URA registra só o volume encaminhado. Por isso não há NS, abandono nem tempos para a TEL.</p></div>`;
    }
    // vista por dia: os textos do modo acumulado falam "do dia até o horário"; aqui cada coluna é o dia inteiro
    if (porDia) html = html.replace(/do início do dia até o horário/g, 'no dia').replace(/no dia até o horário/g, 'no dia').replace(/do dia até o horário/g, 'do dia').replace(/do dia até aqui/g, 'do dia');
    return html;
  }

  // ---------------------------------------------------------------- painel "Grupos e skills" (Evolução)
  // Grupos do atendimento escolhido, do maior para o menor volume DO DIA (a ordem não muda ao filtrar nem ao
  // selecionar coluna). Números: do dia, ou da coluna selecionada (como os botões de grupo). O painel não se filtra:
  // tocar no nome do grupo/skill filtra o RESTO da tela e só marca a linha. "N skills" abre as skills do grupo.
  function painelGrupos(d, L, ivC, iSel, acum, st, opt) {
    st = st || evo; opt = opt || {};
    const dirP = opt.dir || evo.dir, desde = opt.desde;
    const c = iSel >= 0 ? ivC[iSel] : null;
    const lFim = c ? (c.semColeta ? null : d.leituras.find(x => x.m === c.ateM)) : L;
    const lIni = c ? (!acum && c.baseM != null ? d.leituras.find(x => x.m === c.baseM) : null) : desde != null ? [...d.leituras].reverse().find(x => x.m <= desde) || null : null;
    const parcial = c ? !acum : desde != null;   // trecho (coluna ou hora atual) ou acumulado (dia)
    const per = ss => !lFim ? null : (parcial ? D.delta(D.agregar(lFim, ss), D.agregar(lIni, ss)) : D.agregar(lFim, ss));
    const ehCO = s => d.trad[s].DIRECIONAMENTO === 'CO';
    const todas = D.filtro(d, { dir: dirP });
    const grupos = new Map();
    todas.forEach(s => { const g = d.trad[s].SKILL_GRUPO; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(s); });
    const info = ss => {
      const co = ss.filter(ehCO), tel = ss.filter(s => !ehCO(s));
      const aC = co.length ? per(co) : null, aT = tel.length ? per(tel) : null;
      return { co, tel, aC, aT, q: lFim ? (aC ? aC.ofer : 0) + (aT ? aT.ofer : 0) : null, dia: (co.length ? D.agregar(L, co).ofer : 0) + (tel.length ? D.agregar(L, tel).ofer : 0) };
    };
    const lista = [...grupos.entries()].map(([g, ss]) => Object.assign({ g, ss }, info(ss)))
      // do maior para o menor número de oferecidas MOSTRADO (da hora na Agora; do dia ou da coluna selecionada na Evolução)
      .sort((a, b) => (b.q == null ? -1 : b.q) - (a.q == null ? -1 : a.q) || b.dia - a.dia || a.g.localeCompare(b.g));
    const total = lista.reduce((t, x) => t + (x.q || 0), 0);
    const met = x => {
      const vT = x.aT ? x.aT.ofer : 0;
      if (!x.aC || !x.aC.ofer) return x.q == null ? '<i>sem coleta neste horário</i>' : vT ? `<i>só volume (TEL)</i>` : '<i>sem chamadas</i>';
      const a = x.aC;
      const p = [`NS ${a.ns == null ? '—' : `<span class="c-${situacao(a.ns)}">${fP(a.ns)}</span>`}`,
        `${fI(a.aband)} aband.${a.abandPct == null ? '' : ' (' + fP(a.abandPct) + ')'}`, `TME ${a.tme == null ? '—' : minCurto(a.tme)}`, `TMA ${a.tma == null ? '—' : minCurto(a.tma)}`];
      if (x.aT && x.aT.ofer && x.co.length) p.push(`TEL ${fI(x.aT.ofer)}`);
      return p.map(t => `<i>${t}</i>`).join('<span class="gk-s">·</span>');
    };
    const barra = (x, ref) => {
      const pc = v => ref ? Math.max(0, Math.min(100, v / ref * 100)) : 0;
      const vc = x.aC ? x.aC.ofer : 0, vt = x.aT ? x.aT.ofer : 0;
      return `<span class="gk-bar" aria-hidden="true"><i style="width:${pc(vc).toFixed(2)}%;background:var(--sCO)"></i><i style="width:${pc(vt).toFixed(2)}%;background:var(--sTEL)"></i></span>`;
    };
    const linha = (x, sub, g) => {
      const on = sub ? st.skill === x.nome : st.grupo === x.g && !st.skill;
      const nome = sub ? x.nome : x.g, chave = sub ? 's:' + g + '|' + x.nome : 'g:' + x.g;
      // a faixa de cima inteira (nome, valor e barra) é um botão só: tocar em qualquer parte dela filtra
      const atrib = sub ? `data-gsk="${esc(x.nome)}" data-gg="${esc(g)}" title="Filtrar a tela por esta skill"` : `data-gk="${esc(x.g)}" title="Filtrar a tela por este grupo"`;
      const nSk = sub ? '' : (() => { const n = new Set(x.ss.map(s => d.trad[s].SKILL_SIMPLIFICADO)).size, ab = st.abertos.has(x.g);
        return `<button class="gk-x" data-gab="${esc(x.g)}" aria-expanded="${ab}" title="${ab ? 'Esconder' : 'Mostrar'} as skills do grupo"><b><i>${n} ${n === 1 ? 'skill' : 'skills'}</i></b><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ab ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg></button><span class="gk-s">·</span>`; })();
      return `<div class="gk${sub ? ' sub' : ''}${on ? ' on' : ''}${x.q ? '' : ' zero'}" data-anc="${esc(chave)}">
        <button class="gk-top" ${atrib} aria-pressed="${on}"><span class="gk-l"><span class="gk-n">${esc(nome)}</span><b class="gk-q num">${x.q == null ? '—' : fI(x.q)}</b></span>${barra(x, sub ? x.ref : total)}</button>
        <div class="gk-m">${nSk}${met(x)}</div></div>`;
    };
    const corpo = lista.map(x => {
      let h = linha(x, false);
      if (st.abertos.has(x.g)) {
        const m = new Map();
        x.ss.forEach(s => { const k = d.trad[s].SKILL_SIMPLIFICADO; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
        const sk = [...m.entries()].map(([nome, ss]) => Object.assign({ nome, ss, ref: x.q }, info(ss))).sort((a, b) => (b.q == null ? -1 : b.q) - (a.q == null ? -1 : a.q) || b.dia - a.dia || a.nome.localeCompare(b.nome));
        h += `<div class="gk-sub">${sk.map(y => linha(y, true, x.g)).join('')}</div>`;
      }
      return h;
    }).join('');
    const onde = !c ? (desde != null ? D.hhmm(desde) + '–' + L.horario : 'no dia') : acum ? 'até ' + D.hhmm(c.andamento ? c.ateM : c.fim) : D.hhmm(c.ini) + '–' + D.hhmm(c.andamento ? c.ateM : c.fim);
    const titulo = `Grupos e skills <small>· oferecidas ${esc(onde)}</small>`;
    const leg = `<div class="legend"><span><i style="background:var(--sCO)"></i>CO</span><span><i style="background:var(--sTEL)"></i>TEL</span></div>
      <div class="cap">Grupos e skills do maior para o menor número de oferecidas ${esc(onde)} (filtrar não muda a ordem). Barra do grupo: parte das oferecidas ${esc(onde)}; barra da skill: parte do grupo.
      Embaixo: NS (5 min), abandonadas, TME e TMA do CO ${parcial ? esc(onde) + ' (÷ finalizadas)' : esc(onde)}. Toque no nome para filtrar a tela (de novo para limpar); em “skills” para abrir as skills do grupo.</div>`;
    return cartaoGraf(opt.id || 'evo-grupos', titulo, `<div class="gks">${corpo}</div>`, leg, '', '', 'painel');
  }

  function tabelaIntervalos(ivC, ivT, dir, passo, iSel, acum, opt) {
    opt = opt || {};
    const linhas = ivC.map((c, i) => {
      const t = ivT[i], r = opt.rot ? opt.rot(c) : `${D.hhmm(acum ? (c.andamento ? c.ateM : c.fim) : c.ini)}${c.andamento ? '*' : ''}`;
      // opt.marcaAberto: a linha mais recente ganha um listrado bem claro no fundo enquanto a HORA dela não fechou
      // (ex.: coleta das 19:15 → a linha das 19:00 faz parte da hora 19h, que só fecha às 20:00) ou enquanto o próprio
      // intervalo está em andamento
      const aberto = opt.marcaAberto && i === ivC.length - 1 && !c.semColeta && (c.andamento || Math.floor(c.ini / 60) * 60 + 60 > opt.ateM);
      const cl = [i === iSel ? 'sel' : '', aberto ? 'aberto' : ''].filter(Boolean).join(' ');
      const cls = cl ? ` class="${cl}"` : '';
      if (c.semColeta) return `<tr data-i="${i}"${cls}><td>${r}</td><td class="nd" colspan="${dir === 'TEL' ? 1 : dir === 'CO' ? 6 : 4}">sem coleta</td></tr>`;
      if (dir === 'TEL') return `<tr data-i="${i}"${cls}><td>${r}</td><td>${fI(t && t.v ? t.v.ofer : 0)}</td></tr>`;
      if (dir === 'CO') return `<tr data-i="${i}"${cls}><td>${r}</td><td>${fI(c.v.ofer)}</td><td>${fI(c.v.atend)}</td><td>${fI(c.v.aband)}</td><td>${nsTx(c.v.ns)}</td><td>${c.esp ? fI(c.esp.pico) : '—'}</td><td>${c.v.tme == null ? '—' : minCurto(c.v.tme)}</td></tr>`;
      return `<tr data-i="${i}"${cls}><td>${r}</td><td>${fI(c.v.ofer)}</td><td>${fI(t && t.v ? t.v.ofer : 0)}</td><td>${nsTx(c.v.ns)}</td><td>${fI(c.v.aband)}</td></tr>`;
    }).reverse();
    // opt.limite: só as N linhas mais recentes, com um botão para ver o dia todo (opt.tudo = aberto)
    const corta = opt.limite && linhas.length > opt.limite;
    const linhasH = (corta && !opt.tudo ? linhas.slice(0, opt.limite) : linhas).join('');
    const btn = corta ? `<button class="tab-mais" data-act="${opt.acao}" aria-expanded="${!!opt.tudo}">${opt.tudo ? `Mostrar só os ${opt.limite} mais recentes` : `Ver o dia todo · mais ${linhas.length - opt.limite} intervalos`}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${opt.tudo ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg></button>` : '';
    const h1 = opt.h1 || (acum ? 'Até' : 'Início');
    const head = dir === 'TEL' ? `<th>${h1}</th><th>Oferecidas</th>` : dir === 'CO' ? `<th>${h1}</th><th>Ofer.</th><th>Atend.</th><th>Aband.</th><th>NS</th><th title="${acum ? 'maior fila do dia até o horário' : 'pico de técnicos em espera'}">Em esp.</th><th>TME</th>`
      : `<th>${h1}</th><th>CO</th><th>TEL</th><th>NS CO</th><th>Aband. CO</th>`;
    return `<div class="card"${opt.anc ? ` data-anc="${opt.anc}"` : ''}><h2>${opt.titulo || (acum ? 'Acumulado do dia' : 'Intervalos de ' + PASSO_NOME[passo])} <small>· mais recente primeiro</small></h2>${opt.filtro ? `<p class="tfil">${esc(opt.filtro)}</p>` : ''}<div class="tw"><table class="conf${opt.id ? '' : ' tsel'}" id="${opt.id || 'tIv'}"><thead><tr>${head}</tr></thead><tbody>${linhasH}</tbody></table></div>${btn}</div>`;
  }

  // ---------------------------------------------------------------- SKILLS
  function renderSkills() {
    const S = skCtx(), d = S.d, L = S.L, quando = S.vivo ? 'hoje' : 'no dia';
    const q = sk.q.trim().toLowerCase();
    const lista = [...porSimpl(d, sk.dir).entries()].filter(([nome, ss]) => {
      if (!q) return true;
      return ss.some(s => { const t = d.trad[s]; return [s, nome, t.SKILL_GRUPO, t.SKILL_SUBGRUPO, t.SKILL_TIPO_ATENDIMENTO, t.SKILL_PRODUTO].some(x => String(x || '').toLowerCase().includes(q)); });
    }).map(([nome, ss]) => {
      // atendimento do item: o das suas skills (no Total URA, um nome pode juntar CO e TEL: "MISTO")
      const ds = [...new Set(ss.map(s => d.trad[s].DIRECIONAMENTO))];
      return { nome, ss, a: D.agregar(L, ss), t: d.trad[ss[0]], dir: ds.length === 1 ? ds[0] : 'TODOS' };
    });
    const totDir = D.agregar(L, D.filtro(d, { dir: sk.dir })).ofer;
    const nomeTot = { CO: 'do CO', TEL: 'da TEL', TODOS: 'da URA' }[sk.dir];
    lista.sort((x, y) => y.a.ofer - x.a.ofer || x.nome.localeCompare(y.nome));
    const com = lista.filter(x => x.a.ofer > 0 || x.a.fila > 0), sem = lista.filter(x => !(x.a.ofer > 0 || x.a.fila > 0));
    const item = x => {
      const sit = situacao(x.a.ns);
      // padrão único: oferecidas em destaque; embaixo, menor, o NS colorido (CO) ou a participação no volume (TEL)
      const eCO = x.dir === 'CO';
      const cor = eCO ? corSit(sit) : 'var(--sTEL)';
      const dir = eCO
        ? `<b>${fI(x.a.ofer)}</b><small>NS <span class="nsc c-${sit || 'x'}">${x.a.ns == null ? '—' : fP(x.a.ns)}</span>${x.a.fila ? ' · ' + fI(x.a.fila) + ' na fila' : ''}</small>`
        : `<b>${fI(x.a.ofer)}</b><small>${totDir ? fP(x.a.ofer / totDir * 100) : '—'} ${nomeTot}</small>`;
      const tag = sk.dir === 'TODOS' ? `<span class="dtag d-${x.dir}">${x.dir === 'TODOS' ? 'CO+TEL' : x.dir}</span>` : '';
      return `<button class="fi" data-sk="${esc(x.nome)}" data-skd="${x.dir}"><span class="bar" style="background:${x.a.ofer ? cor : 'var(--line)'}"></span>
        <span class="tx"><div class="nm">${esc(x.nome)}</div><div class="sb">${tag}${esc(x.t.SKILL_GRUPO)}${x.t.SKILL_TIPO_ATENDIMENTO ? ' · ' + esc(x.t.SKILL_TIPO_ATENDIMENTO) : ''}${x.ss.length > 1 ? ' · ' + x.ss.length + ' skills' : ''}</div></span>
        <span class="nv">${dir}</span></button>`;
    };
    $('#pgSkills').innerHTML = `
      ${navDia(S.ctx, { semVis: true, idData: 'dnDataSk' })}
      <div class="tools">
        <div class="seg" role="tablist" aria-label="Atendimento">${[['TODOS', 'Total URA'], ['CO', 'CO'], ['TEL', 'TEL']].map(([v, t]) => `<button data-skdir="${v}" class="${sk.dir === v ? 'on' : ''}">${t}</button>`).join('')}</div>
        <label class="srch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input class="search" id="skQ" type="search" placeholder="Buscar skill, grupo, rede…" autocomplete="off" value="${esc(sk.q)}" aria-label="Buscar skill"></label>
      </div>
      <h2 class="sec">Com chamadas ${quando} <span class="ct num">${com.length}</span><span class="sp"></span><span class="rt">oferecidas</span></h2>
      <div class="fl">${com.length ? com.map(item).join('') : '<p class="nota" style="padding:4px">Nenhuma skill com chamadas.</p>'}</div>
      ${sem.length ? (sk.zeros ? `<h2 class="sec">Sem chamadas ${quando} <span class="ct num">${sem.length}</span></h2><div class="fl">${sem.map(item).join('')}</div>`
        : `<button class="zeros" data-act="zeros">Mostrar ${sem.length} skill(s) sem chamadas ${quando}</button>`) : ''}`;
    ajustarData();
  }

  // Dia da aba Skills = a data escolhida na Evolução (as duas andam juntas). O detalhe aberto de outra aba (a lista
  // "Em espera agora" da Agora) é sempre o dia ao vivo.
  function skCtx() {
    if (pagina !== 'skills') return { d: dados, L: ultima(), vivo: true, iso: dados.dia };
    const c = diaEvo(), L = c.d.leituras[c.d.leituras.length - 1];
    return { d: c.d, L, vivo: c.vivo, iso: c.iso, ctx: c };
  }
  // Peso da skill no dia: representatividade (% das oferecidas da URA, CO + TEL) e rank entre as mais acionadas.
  // O rank usa a mesma lista da aba Skills em "Total URA" (nomes simplificados); empate divide a posição (1º, 2º, 2º, 4º).
  function rankEntre(mapa, nome) {
    const L = skCtx().L, vol = [...mapa.entries()].map(([n, ss]) => ({ n, v: D.agregar(L, ss).ofer }));
    const meu = vol.find(x => x.n === nome);
    if (!meu) return null;
    return { pos: 1 + vol.filter(x => x.v > meu.v).length, de: vol.length, empate: vol.filter(x => x.v === meu.v).length > 1 };
  }
  function cartaoPeso(nome, ss, a, dirSk) {
    const { d, L, vivo } = skCtx();
    const tot = D.agregar(L, D.filtro(d, { dir: 'TODOS' })).ofer;
    const rep = tot ? a.ofer / tot * 100 : null;
    const rk = rankEntre(porSimpl(d, 'TODOS'), nome);
    const nDir = dirSk === 'CO' || dirSk === 'TEL' ? dirSk : null;
    const totDir = nDir ? D.agregar(L, D.filtro(d, { dir: nDir })).ofer : null;
    const rkDir = nDir ? rankEntre(porSimpl(d, nDir), nome) : null;
    const pos = r => r ? `${r.pos}º` : '—';
    return `<div class="card peso"><h2>No volume da URA <small>· ${ddmmaaaa(d.dia).slice(0, 5)}</small></h2><div class="peso-g">
      <div><div class="l">Representatividade</div><div class="v num">${rep == null ? '—' : fP(rep)}</div>
        <div class="s">${fI(a.ofer)} de ${fI(tot)} oferecidas${nDir && totDir ? ` · ${fP(a.ofer / totDir * 100)} ${nDir === 'CO' ? 'do CO' : 'da TEL'}` : ''}</div></div>
      <div><div class="l">Rank</div><div class="v num">${pos(rk)}<small> de ${rk ? rk.de : '—'}</small></div>
        <div class="s">${a.ofer ? 'mais acionadas da URA' : vivo ? 'sem chamadas hoje' : 'sem chamadas no dia'}${rk && rk.empate ? ' (empate)' : ''}${rkDir && a.ofer ? ` · ${pos(rkDir)} ${nDir === 'CO' ? 'no CO' : 'na TEL'}` : ''}</div></div>
    </div></div>`;
  }

  // detalhe de uma skill simplificada (janela de baixo): soma das skills do Pulse que têm esse nome na tradutora
  function abrirSkill(nome, dirSk) {
    const S = skCtx(), d = S.d, L = S.L;
    const ss = porSimpl(d, dirSk).get(nome);
    if (!ss) return;
    const t = d.trad[ss[0]];
    const a = D.agregar(L, ss);
    const isCO = dirSk === 'CO';
    const sh = $('#sheet');
    const largura = Math.min(760, window.innerWidth) - 60;
    const passo = D.passoAuto(d, Math.max(8, Math.min(24, Math.floor(largura / 27))));
    const iv = D.intervalos(d, passo, ss);
    const ewt = ss.map(s => L.v[s] && L.v[s].EWT).filter(x => x != null);
    const cols = iv.map(c => c.semColeta ? { rot: rotPasso(c.ini, passo), sd: true } : {
      rot: rotPasso(c.ini, passo), and: c.andamento, segs: isCO ? [{ v: c.v.ofer - Math.min(c.v.aband, c.v.ofer), cor: 'var(--sCO)' }, { v: Math.min(c.v.aband, c.v.ofer), cor: 'var(--sAb)' }] : [{ v: c.v.ofer, cor: 'var(--sTEL)' }],
      lab: fI(c.v.ofer) });
    const kp = isCO
      ? kpi('Oferecidas', fI(a.ofer), 'atendidas ' + fI(a.atend)) + kpi('NS 5 min', nsTx(a.ns), `meta ${META_NS}%`) +
        kpi('Abandonadas', fI(a.aband), a.abandPct == null ? '' : fP(a.abandPct)) + kpi('TME', fS(a.tme), 'TMA ' + fS(a.tma)) +
        // retratos do momento (em espera agora, agentes, EWT): só no dia ao vivo; o histórico não tem
        (S.vivo ? kpi('Em espera agora', fI(a.fila), a.fila ? 'mais antiga ' + fS(a.espMax) : 'nenhuma') + kpi('Agentes logados', fI(a.agMax), fI(a.dispMax) + ' disponíveis') : '')
      : kpi('Oferecidas', fI(a.ofer), 'no dia') + (S.vivo ? kpi('EWT', ewtTx(ewt.length ? Math.min(...ewt) : null), 'espera estimada') : '');
    // campos da tradutora: os comuns a todas as skills do grupo (os que variam aparecem na tabela de skills)
    const ign = new Set(['SKILL_SIMPLIFICADO']);
    const kv = Object.keys(t).filter(k => !ign.has(k)).map(k => {
      const vals = [...new Set(ss.map(s => d.trad[s][k]))];
      return `<dt>${esc(k.replace(/^SKILL_/, '').replace(/_/g, ' ').toLowerCase())}</dt><dd>${vals.map(esc).join(' / ')}</dd>`;
    }).join('');
    const linhas = ss.map(s => ({ s, a: D.agregar(L, [s]) })).sort((x, y) => y.a.ofer - x.a.ofer).map(x =>
      `<tr><td style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;font-weight:600;word-break:break-all">${esc(D.curto(x.s))}</td><td>${fI(x.a.ofer)}</td>${isCO ? `<td>${nsTx(x.a.ns)}</td>${S.vivo ? `<td>${fI(x.a.fila)}</td>` : ''}` : ''}</tr>`).join('');
    const tabSk = `<div class="card"><h2>Skills no Pulse <small>· ${ss.length}</small></h2><div class="tw"><table class="conf"><thead><tr><th>Skill</th><th>Ofer.</th>${isCO ? '<th>NS</th>' + (S.vivo ? '<th>Em esp.</th>' : '') : ''}</tr></thead><tbody>${linhas}</tbody></table></div></div>`;
    sh.innerHTML = `<button class="fechar" data-act="fechar" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
      <h3>${esc(nome)}</h3><div class="sub">${esc(dirSk)} · ${esc(t.SKILL_GRUPO)}${ss.length > 1 ? ' · ' + ss.length + ' skills do Pulse' : ' · ' + esc(ss[0])}</div>
      ${cartaoPeso(nome, ss, a, dirSk)}
      <div class="kpis2">${kp}</div>
      ${cartaoGraf('sk-of', `Oferecidas por intervalo <small>· ${PASSO_NOME[passo]}</small>`, G.barras({ cols, aria: 'Oferecidas por intervalo da skill' }),
        `<div class="legend">${isCO ? '<span><i style="background:var(--sCO)"></i>oferecidas</span><span><i style="background:var(--sAb)"></i>parte abandonada</span>' : '<span><i style="background:var(--sTEL)"></i>oferecidas</span>'}</div>` +
        `<div class="cap">${S.vivo ? `Coleta das ${esc(L.horario)}.` : `Dia ${ddmmaaaa(S.iso)} (histórico Genesys).`}</div>`)}
      ${ss.length > 1 ? tabSk : ''}
      <div class="card"><h2>Tradutora</h2><dl class="kv">${kv}</dl></div>`;
    sh.scrollTop = 0;
    sh.classList.add('show'); $('#sheetBg').classList.add('show');
  }
  function fecharSheet() { $('#sheet').classList.remove('show'); $('#sheetBg').classList.remove('show'); if (infoAberto && infoAberto.startsWith('sk-')) infoAberto = null; }

  // ---------------------------------------------------------------- eventos
  // Total URA · CO · TEL é um filtro só para as três telas (Agora, Evolução e Skills): escolher numa vale nas outras.
  // Trocar de atendimento limpa o filtro de grupo/skill e a coluna selecionada (o grupo pode não existir no outro).
  function mudarDir(v) {
    if (evo.dir !== v) { evo.grupo = null; evo.skill = null; evo.sel = null; }
    if (ag.dir !== v) { ag.grupo = null; ag.skill = null; }
    if (sk.dir !== v) sk.zeros = false;
    evo.dir = ag.dir = sk.dir = v;
  }
  function irPara(p) { pagina = p; infoAberto = null; evo.menu = null; if (p === 'evo') evo.fonteVista = null; fecharSheet(); render(); window.scrollTo(0, 0); }

  // ---------------------------------------------------------------- arrastar para o lado troca de aba
  // Agora ⇄ Evolução ⇄ Skills. A tela acompanha o dedo; soltando depois de ~70 px (ou num arrasto rápido) entra a aba
  // vizinha deslizando do lado certo; antes disso, volta para o lugar. Não vale quando o gesto começa em algo que já
  // rola para o lado (faixa de grupos, tabelas largas), num menu aberto ou com o detalhe da skill aberto.
  const ORDEM_ABAS = ['alarmes', 'agora', 'evo', 'skills'];
  const elAba = p => $('#pg' + p[0].toUpperCase() + p.slice(1));
  const semMovimento = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let arr = null;
  function irParaDeslizando(p, lado) {
    irPara(p);
    if (semMovimento()) return;
    const el = elAba(p);
    el.classList.remove('entra-d', 'entra-e'); void el.offsetWidth;
    el.classList.add(lado > 0 ? 'entra-d' : 'entra-e');
    setTimeout(() => el.classList.remove('entra-d', 'entra-e'), 320);
  }
  const mainEl = document.querySelector('main');
  mainEl.addEventListener('touchstart', e => {
    arr = null;
    if (e.touches.length !== 1 || $('#sheet').classList.contains('show') || evo.menu) return;
    if (e.target.closest('.chips, .tw, .ctl-menu, input, select, textarea')) return;
    const t = e.touches[0];
    arr = { x: t.clientX, y: t.clientY, t: Date.now(), dir: null, dx: 0, el: elAba(pagina) };
  }, { passive: true });
  mainEl.addEventListener('touchmove', e => {
    if (!arr) return;
    const t = e.touches[0], dx = t.clientX - arr.x, dy = t.clientY - arr.y;
    if (!arr.dir && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) arr.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
    if (arr.dir !== 'h') return;
    const i = ORDEM_ABAS.indexOf(pagina), tem = dx < 0 ? i < ORDEM_ABAS.length - 1 : i > 0;
    arr.dx = dx;
    if (!semMovimento()) { arr.el.style.transition = 'none'; arr.el.style.transform = `translateX(${(tem ? dx * 0.45 : dx * 0.12).toFixed(1)}px)`; arr.el.style.opacity = String(Math.max(0.55, 1 - Math.abs(dx) / 700)); }
  }, { passive: true });
  mainEl.addEventListener('touchend', () => {
    if (!arr) return;
    const a = arr; arr = null;
    const volta = () => { a.el.style.transition = 'transform .18s ease, opacity .18s ease'; a.el.style.transform = ''; a.el.style.opacity = ''; setTimeout(() => { a.el.style.transition = ''; }, 200); };
    if (a.dir !== 'h') return volta();
    const i = ORDEM_ABAS.indexOf(pagina), rapido = Math.abs(a.dx) > 35 && Date.now() - a.t < 250;
    const j = (Math.abs(a.dx) > 70 || rapido) ? i + (a.dx < 0 ? 1 : -1) : i;
    if (j === i || j < 0 || j >= ORDEM_ABAS.length) return volta();
    a.el.style.transition = ''; a.el.style.transform = ''; a.el.style.opacity = '';
    irParaDeslizando(ORDEM_ABAS[j], a.dx < 0 ? 1 : -1);
  });
  mainEl.addEventListener('touchcancel', () => { if (arr) { arr.el.style.transform = ''; arr.el.style.opacity = ''; arr = null; } });
  document.addEventListener('click', e => {
    if (evo.menu && !e.target.closest('.ctl-m')) fecharMenu();   // tocar fora fecha o menu (o toque continua valendo)
    const b = e.target.closest('button, tr[data-i], rect.hit');
    if (!b) { if (e.target.id === 'sheetBg') fecharSheet(); return; }
    if (b.closest('nav.tabs')) return irPara(b.dataset.v);
    if (b.id === 'btRefresh') { if (origem === 'arquivo') { origem = 'site'; } return carregar(true); }
    if (b.id === 'btArq' || b.dataset.act === 'arq') return $('#arq').click();
    if (b.dataset.fechaAviso != null) { avisosFechados.add(b.dataset.fechaAviso); return renderBanners(); }
    if (b.dataset.info) return alternarInfo(b.dataset.info);
    if (b.dataset.act === 'fechar') return fecharSheet();
    if (b.dataset.ndias) { evo.menu = null; evo.ndias = +b.dataset.ndias; gravarPref('ndias', evo.ndias); evo.sel = null; return redesenhar(); }
    if (b.dataset.vis) { evo.vista = b.dataset.vis; evo.sel = null; evo.menu = null; toast(evo.vista === 'dia' ? 'Eixo por dia' : 'Eixo por horas'); return redesenhar(); }
    if (b.dataset.menu) { evo.menu = evo.menu === b.dataset.menu ? null : b.dataset.menu; return redesenhar(); }
    if (b.dataset.alvista) { al.vista = b.dataset.alvista; al.aberto = null; renderBadge(avaliarAlarmes()); return redesenhar(); }
    if (b.dataset.al != null) { al.aberto = al.aberto === b.dataset.al ? null : b.dataset.al; return redesenhar(b); }
    if (b.dataset.alcfg != null) return abrirCfgAlarmes();
    if (b.dataset.alfil) { al.filEvo.clear(); return redesenhar(b); }
    if (b.dataset.alk) { const k = b.dataset.alk; if (al.filEvo.has(k)) al.filEvo.delete(k); else al.filEvo.add(k); return redesenhar(b); }
    if (b.dataset.alver != null) return verAlarme(b.dataset.alver);
    if (b.dataset.alsil != null) {
      const k = 'alarmes:' + al.vista, h = lerPref(k, null); if (!h) return;
      h.sil = h.sil || {}; h.sil[b.dataset.alsil] = Date.now() + 3600000; gravarPref(k, h); al.aberto = null;
      toast('Alarme silenciado por 1 h.'); return redesenhar();
    }
    if (b.dataset.alreat != null) { const k = 'alarmes:' + al.vista, h = lerPref(k, null); if (h) { h.sil = {}; gravarPref(k, h); } toast('Alarmes reativados.'); return redesenhar(); }
    if (b.dataset.act === 'tabtudo') { ag.tabTudo = !ag.tabTudo; return redesenhar(b); }
    if (b.dataset.act === 'limpar') { evo.sel = null; return redesenhar(); }
    if (b.dataset.act === 'zeros') { sk.zeros = true; return render(); }
    if (b.dataset.sk) return abrirSkill(b.dataset.sk, b.dataset.skd);
    // painel de grupos e skills: na Evolução filtra a Evolução; na Agora, só a aba Agora
    const stP = b.closest('#pgAgora') ? ag : evo;
    if (b.dataset.gk != null) { const g = b.dataset.gk; stP.grupo = stP.grupo === g && !stP.skill ? null : g; stP.skill = null; return redesenhar(b); }
    if (b.dataset.gsk != null) { const k = b.dataset.gsk; if (stP.skill === k) stP.skill = null; else { stP.skill = k; stP.grupo = b.dataset.gg; } return redesenhar(b); }
    if (b.dataset.gab != null) { const g = b.dataset.gab; if (stP.abertos.has(g)) stP.abertos.delete(g); else stP.abertos.add(g); return redesenhar(b); }
    if (b.matches('rect.hit') && b.closest('#pgAgora')) {
      const c = agCols[+b.dataset.i];
      if (c && !c.futuro) { ag.sel = ag.sel === c.ini ? null : c.ini; redesenhar(b); }
      return;
    }
    if (b.dataset.dir && b.closest('#pgEvo')) { evo.menu = null; mudarDir(b.dataset.dir); return redesenhar(); }
    if (b.dataset.modo) { evo.menu = null; evo.modo = b.dataset.modo; return redesenhar(); }
    if (b.dataset.cmp) { evo.cmp = b.dataset.cmp; gravarPref('cmp', evo.cmp); return redesenhar(); }
    if (b.dataset.navdia) {
      // navegar entre os dias: a coluna selecionada continua (mesmo horário em outro dia)
      const lista = diasDisp(), atual = evo.dia || lista[lista.length - 1];
      let i = lista.indexOf(atual);
      if (b.dataset.navdia === 'fim') i = lista.length - 1; else i = Math.max(0, Math.min(lista.length - 1, i + +b.dataset.navdia));
      evo.dia = i === lista.length - 1 ? null : lista[i];
      return redesenhar();
    }
    if (b.dataset.passo) { evo.menu = null; evo.passo = b.dataset.passo === 'auto' ? 'auto' : +b.dataset.passo; evo.sel = null; return redesenhar(); }
    if (b.dataset.grp != null && b.classList.contains('chip')) {
      // tocar no grupo já selecionado desmarca e volta para "Todos os grupos"
      const g = b.dataset.grp || null;
      // a coluna selecionada continua selecionada: os gráficos trocam de grupo mantendo o mesmo horário
      evo.grupo = g && g === evo.grupo ? null : g; evo.skill = null; chipAnimar = true;
      return redesenhar();
    }
    if (b.dataset.skdir) { mudarDir(b.dataset.skdir); return render(); }
    if (b.dataset.agdir) { mudarDir(b.dataset.agdir); return redesenhar(); }
    if (b.matches('rect.hit') && b.closest('#pgEvo') || b.matches('#tIv tr[data-i]')) {
      const iv = ivAtuais(); const i = +b.dataset.i; const c = iv[i];
      if (c) { evo.sel = evo.sel === c.ini ? null : c.ini; redesenhar(b); }
    }
  });
  function ivAtuais() { return evoCols; }

  // Redesenhar sem mexer na rolagem. Na Evolução, a tela "ancora" no primeiro bloco visível (card, gráfico…):
  // depois de redesenhar, esse mesmo bloco volta exatamente para a mesma altura da tela, mesmo que algo acima
  // tenha mudado de tamanho (ex.: trocar de data some/volta o gráfico de técnicos em espera, os cards mudam).
  // Se o bloco não existir no novo dia, ancora no seguinte.
  const chaveBloco = el => el.dataset.ch ? 'ch:' + el.dataset.ch : el.classList.contains('kpis2') ? 'kpis' : el.classList.contains('cmpk') ? 'cmpk'
    : el.classList.contains('evo-ctl') ? 'ctl' : el.querySelector('#tIv') ? 'tab' : null;
  const pgAtual = () => '#pg' + pagina[0].toUpperCase() + pagina.slice(1);
  function ancora(toque) {
    if (pagina === 'skills' || window.scrollY < 1) return null;
    // tocou numa linha do painel de grupos: é ELA que fica parada (abrir/fechar skills ou filtrar não mexe nela)
    const linha = toque && toque.closest ? toque.closest('[data-anc]') : null;
    if (linha) return { anc: linha.dataset.anc, y: linha.getBoundingClientRect().top };
    const ctl = $('#pgEvo .evo-ctl.fixo'), topo = Math.max($('header.top') ? $('header.top').getBoundingClientRect().bottom : 0, ctl ? ctl.getBoundingClientRect().bottom : 0);
    const blocos = [...document.querySelectorAll(pgAtual() + ' > *')].filter(el => !el.classList.contains('fixo'));
    const ordem = blocos.map(chaveBloco).filter(Boolean);
    // o primeiro bloco que COMEÇA na área visível; se nenhum começar nela (gráfico alto), o que está cortado no topo
    const cand = blocos.filter(el => chaveBloco(el));
    // tocou num gráfico (selecionar coluna): ele é que fica parado
    const tocado = toque && toque.closest ? cand.find(el => el.contains(toque)) : null;
    const alvo = tocado || cand.find(el => { const r = el.getBoundingClientRect(); return r.top >= topo - 2 && r.top < innerHeight; }) || cand.find(el => el.getBoundingClientRect().bottom > topo + 4);
    return alvo ? { ordem, k: chaveBloco(alvo), y: alvo.getBoundingClientRect().top } : null;
  }
  function redesenhar(toque) {
    const y = window.scrollY, a = ancora(toque);
    render();
    window.scrollTo(0, y);
    if (!a) return;
    if (a.anc) {
      const el = [...document.querySelectorAll(pgAtual() + ' [data-anc]')].find(x => x.dataset.anc === a.anc);
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.y);
      return;
    }
    const novo = new Map([...document.querySelectorAll(pgAtual() + ' > *')].map(el => [chaveBloco(el), el]));
    const k = a.ordem.slice(a.ordem.indexOf(a.k)).find(x => novo.has(x));
    if (k) window.scrollBy(0, novo.get(k).getBoundingClientRect().top - a.y);
  }
  // seletor de data: escolher um dia sem dados avisa e não muda
  document.addEventListener('change', e => {
    const cx = e.target;
    if (cx.dataset && (cx.dataset.cfg || cx.dataset.cfgtodos)) {
      const c = alDesligados(), v = cx.dataset.cfg || cx.dataset.cfgtodos;
      const tipos = cx.dataset.cfgtodos ? window.Alarmes.TIPOS.map(t => t.id) : [cx.dataset.tipo];
      tipos.forEach(t => { if (cx.checked) c[v].delete(t); else c[v].add(t); });
      gravarDesligados(c); desenharCfg(); render();
      return;
    }
    if (!e.target.classList || !e.target.classList.contains('dn-data')) return;
    const v = e.target.value, lista = diasDisp();
    if (!v) return;
    if (!lista.includes(v)) { toast(`Sem dados de ${ddmmaaaa(v)}.`); return redesenhar(); }
    evo.dia = v === lista[lista.length - 1] ? null : v;
    redesenhar();
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'skQ') {
      sk.q = e.target.value;
      const pos = e.target.selectionStart;
      renderSkills();
      const q = $('#skQ'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) { /* type=search em alguns navegadores */ }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { fecharSheet(); fecharMenu(); }
  });
  $('#arq').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) abrirArquivo(f); e.target.value = ''; });
  let largAnt = window.innerWidth;
  window.addEventListener('resize', () => {
    medirTopo(); alinharListras(); if (Math.abs(window.innerWidth - largAnt) > 40 && dados && pagina === 'evo') { largAnt = window.innerWidth; redesenhar(); } });

  // atualização automática: a cada 1 min (a coleta é de 5 em 5) e ao voltar para o app
  setInterval(() => { if (origem !== 'arquivo' && !document.hidden) carregar(false); }, 60000);
  setInterval(renderSync, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && origem !== 'arquivo') carregar(false); });

  $('#ver').textContent = APP_VERSION;
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sem offline: o app funciona igual */ });
  }
  usarCopia();
  render();
  carregar(false).then(() => carregarHist(true));
  setInterval(() => { if (!document.hidden) carregarHist(false); }, 5 * 60000);

  // para testes
  window.__ura = { versao: APP_VERSION, estado: () => ({ dados, origem, erroFonte, erroDados, pagina, evo, ag, sk, al, hist, histErro, histOrigem }) };
})();
