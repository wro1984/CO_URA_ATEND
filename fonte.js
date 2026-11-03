/* URA Atendimento — de onde vêm os dados em PRODUÇÃO (login do HUB e arquivos cifrados do MAPI).
 *
 * O app de homologação lia dois arquivos ABERTOS: o pulse.json (dia de hoje, leituras do Pulse) e o historico.csv
 * (139 dias do IPTBM). Aqui o MAPI publica os mesmos dados cifrados (ura_atend.py) e este arquivo os devolve no
 * MESMO formato, para o app (app.js, dados.js, historico.js) seguir igual:
 *   pulse()     -> o objeto do pulse.json: a hora aberta (dados.json) + as horas fechadas (hoje/…, guardadas no aparelho);
 *   historico() -> o texto do historico.csv, remontado dos dias (hist/…, guardados no aparelho, baixados só os novos).
 * Nada aberto é guardado no aparelho: só os arquivos cifrados, no cache do service worker.
 * Erros com `code`: sem_cred (sem login do HUB neste aparelho), sem_acesso, sem_dados, rede, formato, corrompido.
 */
(function (root) {
  'use strict';

  const K = root.URAACripto;
  const CACHE_HIST = 'co-ura-atend-hist';
  const COLS_CSV = ['DIA', 'HORARIO', 'SKILL', 'OFERECIDAS', 'ATENDIDAS', 'ABANDONADAS', 'ATEND_60S', 'ATEND_300S',
    'SOMA_ESPERA_S', 'SOMA_TMA_S', 'FILA', 'ESPERA_MAX_S'];
  const erro = (code, msg) => { const e = new Error(msg); e.code = code; return e; };

  let cred = null, chaveHist = null, conteudo = null, gerado = null, idHist = null;
  const abertos = new Map();      // caminho -> conteúdo aberto (só na memória)

  async function baixarJSON(caminho, semCache) {
    let r;
    try { r = await fetch(caminho, semCache ? { cache: 'no-store' } : undefined); }
    catch (e) { throw erro('rede', 'sem conexão com o site'); }
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
        .map(p => new URL(p, location.href).href));
      const c = await caches.open(CACHE_HIST);
      for (const req of await c.keys()) if (!quer.has(req.url)) await c.delete(req);
      for (const k of abertos.keys()) if (!quer.has(new URL(k, location.href).href)) abertos.delete(k);
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
    if (!conteudo) await atualizar();
    const dias = Object.keys((conteudo.hist && conteudo.hist.dias) || {}).sort();
    if (!dias.length) throw erro('sem_dados', 'O histórico ainda não foi publicado.');
    const abertos_ = await abrirVarios(dias.map(d => conteudo.hist.dias[d]), 6);
    const linhas = [COLS_CSV.join(';')];
    for (const d of abertos_) {
      if (!d || !d.l) continue;
      for (const l of d.l) linhas.push([d.dia, d.h[l[0]], d.s[l[1]]].concat(l.slice(2, 11).map(v => v == null ? '' : v)).join(';'));
    }
    return linhas.join('\n') + '\n';
  }

  const api = { pulse, historico, atualizar, apagarCopias, credencial: () => cred, gerado: () => gerado, CACHE_HIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.URAFonte = api;
})(typeof self !== 'undefined' ? self : globalThis);
