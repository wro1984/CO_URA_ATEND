// Prévia do link (WhatsApp, Teams): etiquetas Open Graph no index.html e a imagem de 1200×630 (node tests/compartilhar.test.js)
const assert = require('assert'), fs = require('fs'), path = require('path');
let ok = 0;
const t = (nome, fn) => { try { fn(); ok++; console.log('ok  ', nome); } catch (e) { console.log('FALHOU', nome, '\n  ', e.message); process.exitCode = 1; } };
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const meta = k => { const m = html.match(new RegExp(`<meta (?:property|name)="${k.replace(/[.:]/g, '\\$&')}" content="([^"]*)">`)); return m ? m[1] : null; };
const BASE = 'https://wro1984.github.io/CO_URA_ATEND/';
t('og:title, og:description, og:url e og:type', () => {
  assert.strictEqual(meta('og:title'), 'URA · Suporte B2C'); assert(meta('og:description').length > 30);
  assert.strictEqual(meta('og:url'), BASE); assert.strictEqual(meta('og:type'), 'website');
});
t('og:image com endereço completo (https), apontando para icons/compartilhar.png', () => {
  for (const k of ['og:image', 'og:image:secure_url', 'twitter:image']) assert.strictEqual(meta(k), BASE + 'icons/compartilhar.png', k);
  assert.strictEqual(meta('og:image:width'), '1200'); assert.strictEqual(meta('og:image:height'), '630');
  assert.strictEqual(meta('twitter:card'), 'summary_large_image');
});
t('as etiquetas estão no <head>, antes do <style>', () => { assert(html.indexOf('og:image') < html.indexOf('<style>')); });
t('a imagem existe, é PNG 1200×630 e tem menos de 300 KB (limite do WhatsApp)', () => {
  const f = path.join(__dirname, '..', 'icons', 'compartilhar.png'), b = fs.readFileSync(f);
  assert.strictEqual(b.slice(1, 4).toString(), 'PNG');
  assert.strictEqual(b.readUInt32BE(16), 1200); assert.strictEqual(b.readUInt32BE(20), 630);
  assert(b.length < 300 * 1024, b.length + ' bytes');
});
console.log(ok + ' testes ok');
