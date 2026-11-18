// Modo MAPI (?mapi): dentro do "HUB de Apps" do MAPI o fonte.js pede o pulse e o histórico por mensagem (sem login do HUB, sem baixar
// arquivos, sem cache). Só vale a mensagem da janela pai, com a mesma `parte` pedida. Dados inventados.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const Hs = require('../historico.js');

const enviados = [];
const pai = { postMessage: (m, alvo) => enviados.push([m, alvo]) };
let ouvinte = null;
globalThis.parent = pai;
globalThis.location = { href: 'https://exemplo.invalid/CO_URA_ATEND/?mapi=1', search: '?mapi=1' };
globalThis.addEventListener = (tipo, fn) => { if (tipo === 'message') ouvinte = fn; };
globalThis.fetch = async () => { throw new Error('não podia baixar nada no modo MAPI'); };
globalThis.URAACripto = { lerCredHub: async () => { throw new Error('não podia ler a credencial do HUB no modo MAPI'); } };
const F = require('../fonte.js');
const responder = (msg, source = pai) => ouvinte({ source, data: msg });

test('só é modo MAPI dentro de um quadro e com ?mapi na URL', () => {
  assert.strictEqual(F.modoMapi(), true);
  globalThis.location.search = '';
  assert.strictEqual(F.modoMapi(), false);
  globalThis.location.search = '?mapi=1';
  const guardado = globalThis.parent; globalThis.parent = globalThis;           // sem quadro: a própria janela
  assert.strictEqual(F.modoMapi(), false);
  globalThis.parent = guardado;
});

test('pulse: pede só o aviso e a parte, e usa a resposta da janela pai', async () => {
  const p = F.pulse();
  assert.deepStrictEqual(enviados.at(-1), [{ tipo: 'ura-atend:pronto', parte: 'pulse' }, '*']);
  responder({ tipo: 'ura-atend:dados', parte: 'pulse', pulse: { dia: '2026-01-02', leituras: [] } }, { outra: 'janela' });   // de outra janela: ignora
  responder({ tipo: 'ura-atend:dados', parte: 'historico', b64: 'x' });                                                          // outra parte: ignora
  responder({ tipo: 'ura-atend:dados', parte: 'pulse', pulse: { dia: '2026-01-02', leituras: [{ horario: '10:00' }] } });
  assert.deepStrictEqual(await p, { dia: '2026-01-02', leituras: [{ horario: '10:00' }] });
});

test('pulse: sem leitura vira sem_dados e erro do MAPI vira rede', async () => {
  let p = F.pulse();
  responder({ tipo: 'ura-atend:dados', parte: 'pulse', pulse: null, aviso: 'Nenhum widget do Pulse.' });
  const e1 = await p.catch(e => e);
  assert.strictEqual(e1.code, 'sem_dados');
  assert.match(e1.message, /Nenhum widget/);
  p = F.pulse();
  responder({ tipo: 'ura-atend:dados', parte: 'pulse', erro: 'Este app não está liberado para a sua matrícula.' });
  const e2 = await p.catch(e => e);
  assert.strictEqual(e2.code, 'rede');
});

test('historico: gzip + base64 dos dias vira o historico.csv e o app lê', async () => {
  const dias = ['2026-01-01', '2026-01-02'].map(dia => ({ dia, h: ['08:00', '08:15'], s: ['skill_a', 'skill_b'],
    l: [[0, 0, 10, 8, 2, 6, 7, 120, 800, 1, 30], [1, 1, 5, 5, 0, 5, 5, 40, 300, 0, 10]] }));
  const p = F.historico();
  assert.deepStrictEqual(enviados.at(-1), [{ tipo: 'ura-atend:pronto', parte: 'historico' }, '*']);
  responder({ tipo: 'ura-atend:dados', parte: 'historico', z: 1, b64: zlib.gzipSync(JSON.stringify({ dias })).toString('base64') });
  const txt = await p;
  const linhas = txt.trim().split('\n');
  assert.strictEqual(linhas[0], 'DIA;HORARIO;SKILL;OFERECIDAS;ATENDIDAS;ABANDONADAS;ATEND_60S;ATEND_300S;SOMA_ESPERA_S;SOMA_TMA_S;FILA;ESPERA_MAX_S');
  assert.strictEqual(linhas.length, 5);
  assert.strictEqual(linhas[1], '2026-01-01;08:00;skill_a;10;8;2;6;7;120;800;1;30');
  const H = Hs.parse(txt);
  assert.strictEqual(H.lista.length, 2);
});

test('mesmo pedido em andamento é compartilhado (uma mensagem só)', async () => {
  const antes = enviados.length;
  const a = F.pulse(), b = F.pulse();
  assert.strictEqual(enviados.length, antes + 1);
  responder({ tipo: 'ura-atend:dados', parte: 'pulse', pulse: { dia: '2026-01-02', leituras: [] } });
  assert.deepStrictEqual(await a, await b);
});

test('app.js: sem o botão do HUB e sem service worker no modo MAPI; a leitura vem do fonte.js', () => {
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /if \(F\.modoMapi\(\)\) \$\('#btHub'\)\.hidden = true;/);
  assert.match(app, /else if \('serviceWorker' in navigator/);
});
