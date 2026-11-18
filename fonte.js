/* URA Atendimento — de onde vêm os dados em PRODUÇÃO (login do HUB e arquivos cifrados do MAPI).
 *
 * O app de homologação lia dois arquivos ABERTOS: o pulse.json (dia de hoje, leituras do Pulse) e o historico.csv
 * (139 dias do IPTBM). Aqui o MAPI publica os mesmos dados cifrados (ura_atend.py) e este arquivo os devolve no
 * MESMO formato, para o app (app.js, dados.js, historico.js) seguir igual:
 *   pulse()     -> o objeto do pulse.json: a hora aberta (dados.json) + as horas fechadas (hoje/…, guardadas no aparelho);
 *   historico() -> o texto do historico.csv, remontado dos dias (hist/…, guardados no aparelho, baixados só os novos).
 * Nada aberto é guardado no aparelho: só os arquivos cifrados, no cache do service worker.
 * DE ONDE: `URAA_CONFIG.dados` (config.js) = endereço dos arquivos (o Worker da Cloudflare). Vazio = o próprio site
 * (GitHub Pages), como antes. Em outro endereço o service worker não atende: os arquivos de dia e de hora (que nunca
 * mudam) e a última cópia do dados.json (cifrada, para abrir sem rede) são guardados aqui mesmo, nos caches do app.
 * MODO MAPI (`?mapi`, dentro de um quadro do "HUB de Apps" do MAPI): sem login do HUB, sem arquivos, sem cache. O app pede ao MAPI
 * (`ura-atend:pronto` com `parte`: 'pulse' ou 'historico') e o MAPI responde `ura-atend:dados` com a mesma `parte`: o dia de hoje inteiro
 * (`pulse`) ou os dias compactos em gzip+base64 (`historico`). Só vale a mensagem da janela pai. Nada disso vai para o aparelho.
 * Erros com `code`: sem_cred (sem login do HUB neste aparelho), sem_acesso, sem_dados, rede, formato, corrompido.
 */
(function (root) {
  'use strict';

  const K = root.URAACripto;
  const CACHE_HIST = 'co-ura-atend-hist';
  const CACHE_DADOS = 'co-ura-atend-dados';      // última cópia do dados.json vindo de outro endereço (cifrada)
  const BASE = (function () {
    const b = String((root.URAA_CONFIG && root.URAA_CONFIG.dados) || '').trim();
    if (!b) return '';
    if (!/^https:\/\/[^/?#]+\/[^?#]*$/.test(b)) throw new Error('config.js: endereço dos dados inválido');
    return b.endsWith('/') ? b : b + '/';
  })();
  const url = caminho => BASE + caminho;          // com BASE vazio, o caminho relativo de sempre
  const comCache = BASE && typeof root.caches !== 'undefined';
  const COLS_CSV = ['DIA', 'HORARIO', 'SKILL', 'OFERECIDAS', 'ATENDIDAS', 'ABANDONADAS', 'ATEND_60S', 'ATEND_300S',
    'SOMA_ESPERA_S', 'SOMA_TMA_S', 'FILA', 'ESPERA_MAX_S'];
  const erro = (code, msg) => { const e = new Error(msg); e.code = code; return e; };

  // ---------- modo MAPI ----------
  const modoMapi = () => !!(root.location && root.parent && root.parent !== root && new URLSearchParams(root.location.search || '').has('mapi'));
  const ESPERA_MAPI_MS = 30000;
  const pedidos = new Map();      // parte -> {promessa, res, rej, t}
  let ouvindo = false;
  function receberDoMapi(e) {
    if (e.source !== root.parent || !e.data || e.data.tipo !== 'ura-atend:dados') return;
    const p = pedidos.get(e.data.parte);
    if (!p) return;
    clearTimeout(p.t); pedidos.delete(e.data.parte);
    if (e.data.erro) return p.rej(erro('rede', String(e.data.erro)));
    p.res(e.data);
  }
  function pedirAoMapi(parte) {
    if (pedidos.has(parte)) return pedidos.get(parte).promessa;
    if (!ouvindo) { root.addEventListener('message', receberDoMapi); ouvindo = true; }
    const p = {};
    p.promessa = new Promise((res, rej) => { p.res = res; p.rej = rej; });
    p.t = setTimeout(() => { pedidos.delete(parte); p.rej(erro('rede', 'O MAPI não respondeu: volte e abra o app de novo pelo HUB de Apps do MAPI.')); }, ESPERA_MAPI_MS);
    pedidos.set(parte, p);
    root.parent.postMessage({ tipo: 'ura-atend:pronto', parte }, '*');      // só o aviso e a parte pedida: nenhum dado
    return p.promessa;
  }
  async function gunzipBase64(b64) {
    if (typeof DecompressionStream === 'undefined') throw erro('formato', 'Este navegador não abre o histórico (precisa do Chrome 80+ ou Safari 16.4+).');
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(s).text());
  }
  // os dias compactos {dia, h, s, l} -> o texto do historico.csv, com as colunas do SELECT (com a fila)
  function csvDeDias(dias) {
    const linhas = [COLS_CSV.join(';')];
    for (const d of dias) {
      if (!d || !d.l) continue;
      for (const l of d.l) linhas.push([d.dia, d.h[l[0]], d.s[l[1]]].concat(l.slice(2, 11).map(v => v == null ? '' : v)).join(';'));
    }
    return linhas.join('\n') + '\n';
  }

  let cred = null, chaveHist = null, conteudo = null, gerado = null, idHist = null;
  const abertos = new Map();      // caminho -> conteúdo aberto (só na memória)

  async function baixarJSON(caminho, semCache) {
    const u = url(caminho);
    let r, c = null;
    if (comCache) {
      try { c = await caches.open(semCache ? CACHE_DADOS : CACHE_HIST); } catch (e) { c = null; }
      // dia ou hora fechada: nunca muda, então o que já está no aparelho vale
      if (c && !semCache) { try { r = await c.match(u); } catch (e) { r = null; } }
    }
    if (!r) {
      try { r = await fetch(u, semCache ? { cache: 'no-store' } : undefined); }
      catch (e) {
        r = c && semCache ? await c.match(u).catch(() => null) : null;     // sem rede: a última cópia (cifrada)
        if (!r) throw erro('rede', 'sem conexão com o site');
      }
      if (c && r.ok && r.clone) { try { await c.put(u, r.clone()); } catch (e) { /* sem espaço: segue sem guardar */ } }
    }
    if (r.status === 404) throw erro('sem_dados', 'Ainda não há dados publicados.');
    if (!r.ok) throw erro('rede', 'o site respondeu ' + r.status);
    try { return await r.json(); } catch (e) { throw erro('formato', 'arquivo publicado em formato desconhecido'); }
  }

  // acesso perdido: tira do aparelho as cópias cifradas (dados.json, horas e dias)
  async function apagarCopias() {
    abertos.clear(); conteudo = null; chaveHist = null; gerado = null;
    if (!('caches' in root)) return;
    try {
      await caches.delete(CACHE_HIST);
      await caches.delete(CACHE_DADOS);
      for (const k of await caches.keys()) {
        if (!k.startsWith('co-ura-atend-v')) continue;
        const c = await caches.open(k);
        for (const req of await c.keys()) if (new URL(req.url).pathname.endsWith('/dados.json')) await c.delete(req);
      }
    } catch (e) { /* sem cache: nada a apagar */ }
  }

  // arquivos que saíram da publicação (dia fora dos 139, hora de ontem, chave trocada): fora do cache
  async function podar() {
    if (!('caches' in root) || !conteudo) return;
    try {
      const quer = new Set(Object.values(conteudo.hist.dias || {}).concat(Object.values(conteudo.partes || {}))
        .map(p => new URL(url(p), location.href).href));
      const c = await caches.open(CACHE_HIST);
      for (const req of await c.keys()) if (!quer.has(req.url)) await c.delete(req);
      for (const k of abertos.keys()) if (!quer.has(new URL(url(k), location.href).href)) abertos.delete(k);
    } catch (e) { /* segue */ }
  }

  async function abrirCaminho(caminho) {
    if (abertos.has(caminho)) return abertos.get(caminho);
    const d = await K.abrirArquivo(await baixarJSON(caminho, false), chaveHist);
    abertos.set(caminho, d);
    return d;
  }

  // vários de uma vez, sem abrir 139 conexões juntas
  async function abrirVarios(caminhos, simultaneos) {
    const out = new Array(caminhos.length);
    let i = 0;
    const trab = async () => { while (i < caminhos.length) { const j = i++; out[j] = await abrirCaminho(caminhos[j]); } };
    await Promise.all(Array.from({ length: Math.min(simultaneos || 6, caminhos.length) }, trab));
    return out;
  }

  // baixa e abre o dados.json (devolve true se é uma publicação nova)
  async function atualizar() {
    cred = await K.lerCredHub();
    if (!cred) { await apagarCopias(); throw erro('sem_cred', 'Entre pelo HUB dos apps neste aparelho.'); }
    const pacote = await baixarJSON('dados.json', true);
    if (pacote.gerado_em && pacote.gerado_em === gerado && conteudo) return false;
    let r;
    try { r = await K.abrir(pacote, cred); }
    catch (e) { if (e.code === 'sem_acesso') await apagarCopias(); throw e; }
    if (idHist && r.conteudo.hist && r.conteudo.hist.id !== idHist) abertos.clear();
    conteudo = r.conteudo; chaveHist = r.chaveHist; gerado = pacote.gerado_em || null;
    idHist = conteudo.hist && conteudo.hist.id;
    podar();
    return true;
  }

  // o pulse.json do dia: horas fechadas (arquivos) + a hora aberta (dados.json), em ordem de horário
  async function pulse() {
    if (modoMapi()) {
      const r = await pedirAoMapi('pulse');
      if (!r.pulse || !Array.isArray(r.pulse.leituras)) throw erro('sem_dados', r.aviso ? String(r.aviso) : 'O MAPI ainda não tem leitura do Pulse para hoje.');
      return r.pulse;
    }
    await atualizar();
    const p = conteudo.pulse;
    if (!p) throw erro('sem_dados', conteudo.aviso || 'O MAPI ainda não tem leitura do Pulse para hoje.');
    const partes = Object.keys(conteudo.partes || {}).sort();
    const horas = await abrirVarios(partes.map(h => conteudo.partes[h]), 4);
    const leituras = [];
    horas.forEach(h => { if (h && h.dia === p.dia) leituras.push(...(h.leituras || [])); });
    leituras.push(...(p.leituras || []));
    return Object.assign({}, p, { leituras });
  }

  // o historico.csv: um dia por arquivo, remontado com as colunas do SELECT (com a fila)
  async function historico() {
    if (modoMapi()) {
      const r = await pedirAoMapi('historico');
      if (!r.b64) throw erro('sem_dados', 'O histórico ainda não foi carregado no MAPI.');
      const dias = (await gunzipBase64(r.b64)).dias;
      if (!Array.isArray(dias) || !dias.length) throw erro('sem_dados', 'O histórico ainda não foi carregado no MAPI.');
      return csvDeDias(dias);
    }
    if (!conteudo) await atualizar();
    const dias = Object.keys((conteudo.hist && conteudo.hist.dias) || {}).sort();
    if (!dias.length) throw erro('sem_dados', 'O histórico ainda não foi publicado.');
    const abertos_ = await abrirVarios(dias.map(d => conteudo.hist.dias[d]), 6);
    return csvDeDias(abertos_);
  }

  const api = { pulse, historico, modoMapi, csvDeDias, atualizar, apagarCopias, credencial: () => cred, gerado: () => gerado, CACHE_HIST, BASE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.URAFonte = api;
})(typeof self !== 'undefined' ? self : globalThis);
