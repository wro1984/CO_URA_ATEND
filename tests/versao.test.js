// O mesmo número de versão em app.js, cripto.js, sw.js e nos ?v= do index.html (senão o celular fica com arquivos
// de versões diferentes no cache); todo arquivo no CORE do service worker; nada carregado de fora.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('versões iguais', () => {
  const app = ler('app.js').match(/APP_VERSION = '([^']+)'/)[1];
  assert.strictEqual(ler('cripto.js').match(/VERSAO = '([^']+)'/)[1], app);
  assert.strictEqual(ler('sw.js').match(/VERSION = '([^']+)'/)[1], app);
  const vs = [...ler('index.html').matchAll(/\?v=([0-9.]+)/g)].map(m => m[1]);
  assert.ok(vs.length >= 3);
  vs.forEach(v => assert.strictEqual(v, app));
});

test('todo arquivo do app está no CORE do service worker', () => {
  const core = ler('sw.js');
  for (const f of ['index.html', 'config.js', 'app.js', 'cripto.js', 'fonte.js', 'dados.js', 'graf.js', 'historico.js', 'alarmes.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'])
    assert.ok(core.includes(`'${f}'`), f);
});

test('service worker só mexe no que é deste app', () => {
  const sw = ler('sw.js');
  assert.match(sw, /k\.startsWith\('co-ura-atend-v'\)/);
  assert.match(sw, /url\.pathname\.startsWith\(escopo\)/);
});

test('nada carregado de fora', () => {
  const html = ler('index.html');
  assert.ok(!/(src|href)="https?:/.test(html));
  assert.match(html, /default-src 'self'/);
});

test('nada aberto guardado no aparelho (sem a cópia do pulse.json no localStorage)', () => {
  assert.ok(!/localStorage\.setItem\(CK \+ 'ultimo'/.test(ler('app.js')));
  assert.ok(!/fetch\('pulse\.json|historico\.csv'/.test(ler('app.js')));
});

test('o endereço dos dados (config.js) está liberado na CSP, e o config.js vem antes do fonte.js', () => {
  const html = ler('index.html');
  const m = ler('config.js').match(/dados: '([^']*)'/);
  assert.ok(m, 'config.js com o campo dados');
  if (m[1]) {
    const origem = new URL(m[1]).origin;
    assert.ok(m[1].startsWith('https://'));
    assert.match(html.match(/connect-src ([^;]+);/)[1], new RegExp(`(^| )${origem.replace(/[.]/g, '\\.')}( |$)`));
  }
  assert.ok(html.indexOf('src="config.js') > 0 && html.indexOf('src="config.js') < html.indexOf('src="fonte.js'));
});
