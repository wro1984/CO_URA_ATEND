/* URA Atendimento — abertura dos arquivos publicados pelo MAPI, só pelo login do HUB.
 *
 * O site é público (GitHub Pages), então tudo vem cifrado. Este app NÃO tem chave própria: abre com a credencial que
 * o HUB dos apps (https://wro1984.github.io/) guardou no IndexedDB "co-hub-acesso" deste endereço, e só a LÊ.
 *
 * FORMATO (gerado pelo MAPI em ura_atend.py; mudar os dois juntos). Todo conteúdo vem compactado (gzip, `z: 1`):
 *   dados.json = {app:"co-ura-atend", v:1, gerado_em,
 *                 hub:{acessos:{<id do HUB>:{salt, iv, ct}}},   id = SHA-256("hub:" + MATRÍCULA); salt = o do HUB
 *                 dados:{z, iv, ct}}             JSON {pulse, partes:{HH: caminho}, hist:{hk, id, dias, colunas}}
 *   hoje/<id>/<dia>.<HH>.<hash>.json = {app, v, dia, hora, z, iv, ct}: uma hora fechada de hoje (leituras do Pulse);
 *   hist/<id>/<AAAA-MM-DD>.<hash>.json = {app, v, dia, z, iv, ct}: um dia do histórico. Os dois com a chave `hk`.
 * A chave dos dados muda a cada publicação; a do histórico muda quando alguém sai do app (pasta nova).
 */
(function (root) {
  'use strict';

  const VERSAO = '2.0.0';
  const APP = 'co-ura-atend';
  const C = (root.crypto && root.crypto.subtle) ? root.crypto : null;
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const erro = (code, msg) => { const e = new Error(msg); e.code = code; return e; };

  function conferePacote(p) {
    if (!p || p.app !== APP || p.v !== 1 || !p.dados || typeof p.dados.iv !== 'string' || typeof p.dados.ct !== 'string')
      throw erro('formato', 'dados.json em formato desconhecido.');
  }

  // credencial do HUB neste aparelho (ou null). Não cria o banco se o HUB nunca foi aberto aqui.
  const lerCredHub = () => new Promise(res => {
    if (typeof indexedDB === 'undefined') { res(null); return; }
    let rq;
    try { rq = indexedDB.open('co-hub-acesso', 1); } catch (e) { res(null); return; }
    rq.onupgradeneeded = () => { try { rq.transaction.abort(); } catch (e) { /* segue */ } };
    rq.onerror = () => res(null);
    rq.onsuccess = () => {
      const d = rq.result;
      try {
        const g = d.transaction('cred', 'readonly').objectStore('cred').get('atual');
        g.onsuccess = () => {
          d.close();
          const c = g.result;
          res(c && c.id && c.chave && c.salt ? { id: c.id, matricula: c.matricula, chave: c.chave, salt: c.salt } : null);
        };
        g.onerror = () => { d.close(); res(null); };
      } catch (e) { d.close(); res(null); }
    };
  });

  // gzip -> texto (DecompressionStream: Chrome 80+, Safari 16.4+, Node 18+)
  async function descompactar(bytes) {
    if (typeof DecompressionStream === 'undefined')
      throw erro('formato', 'Este navegador é antigo demais para o app (atualize o sistema ou o navegador).');
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(s).text();
  }

  async function decifrarJSON(k, campo, msg) {
    let bytes;
    try { bytes = await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(campo.iv) }, k, b64(campo.ct)); }
    catch (e) { throw erro('corrompido', msg); }
    let txt;
    try { txt = campo.z ? await descompactar(bytes) : new TextDecoder().decode(bytes); }
    catch (e) { if (e.code) throw e; throw erro('corrompido', msg); }
    try { return JSON.parse(txt); }
    catch (e) { throw erro('corrompido', 'Os dados publicados estão em formato desconhecido.'); }
  }

  // abre o dados.json: devolve {conteudo, chaveHist}. Erros com `code`: sem_acesso, formato, corrompido.
  async function abrir(pacote, cred) {
    if (!C) throw erro('formato', 'Este navegador não tem criptografia (abra pelo endereço https do app).');
    conferePacote(pacote);
    const a = pacote.hub && pacote.hub.acessos && pacote.hub.acessos[cred.id];
    if (!a) throw erro('sem_acesso', 'Seu perfil no HUB não inclui o app URA Atendimento. Fale com o administrador.');
    if (a.salt !== cred.salt) throw erro('sem_acesso', 'Sua chave do HUB foi trocada. Abra o HUB e entre de novo.');
    let rawK;
    try { rawK = await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(a.iv) }, cred.chave, b64(a.ct)); }
    catch (e) { throw erro('sem_acesso', 'Sua chave do HUB não abre este app. Abra o HUB e entre de novo.'); }
    const k = await C.subtle.importKey('raw', rawK, 'AES-GCM', false, ['decrypt']);
    const conteudo = await decifrarJSON(k, pacote.dados, 'Os dados publicados estão corrompidos.');
    const hist = conteudo.hist || {};
    const chaveHist = hist.hk ? await C.subtle.importKey('raw', b64(hist.hk), 'AES-GCM', false, ['decrypt']) : null;
    delete hist.hk;                                   // a chave crua não fica no objeto da tela
    return { conteudo, chaveHist };
  }

  // abre um arquivo de dia (hist/...) ou de hora de hoje (hoje/...) com a chave do histórico
  async function abrirArquivo(arq, chaveHist) {
    if (!C) throw erro('formato', 'Este navegador não tem criptografia.');
    if (!arq || arq.app !== APP || arq.v !== 1 || typeof arq.iv !== 'string' || typeof arq.ct !== 'string')
      throw erro('formato', 'Arquivo do histórico em formato desconhecido.');
    if (!chaveHist) throw erro('sem_acesso', 'Sem a chave do histórico.');
    return decifrarJSON(chaveHist, arq, 'Um arquivo do histórico está corrompido.');
  }

  const api = { VERSAO, abrir, abrirDia: abrirArquivo, abrirArquivo, lerCredHub, conferePacote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.URAACripto = api;
})(typeof self !== 'undefined' ? self : globalThis);
