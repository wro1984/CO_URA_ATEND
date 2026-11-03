// Abre o pacote e os dias cifrados pelo MAPI (ura_atend.py, tests/fixtures/pacote.json, dados inventados) com a
// credencial como o HUB guarda no aparelho (CryptoKey não extraível derivada da chave com o salt do HUB).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.atob) globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
const K = require('../cripto.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));
const S = crypto.subtle, enc = new TextEncoder();
const norm = c => String(c || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();   // normCodigo do HUB

async function credDoHub(chave = fx.hub.chave, salt = fx.hub.salt, mat = fx.hub.matricula) {
  const base = await S.importKey('raw', enc.encode(norm(chave)), 'PBKDF2', false, ['deriveKey']);
  const k = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(fx.hub.salt, 'base64'), iterations: fx.hub.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const id = Buffer.from(await S.digest('SHA-256', enc.encode('hub:' + mat))).toString('hex');
  return { id, matricula: mat, chave: k, salt };
}

test('abre o dados.json com a credencial do HUB e os dias com a chave do histórico', async () => {
  const r = await K.abrir(fx.pacote, await credDoHub());
  assert.deepStrictEqual(r.conteudo, fx.esperado);
  assert.ok(!('hk' in r.conteudo.hist), 'a chave crua não fica no objeto');
  const dias = Object.keys(r.conteudo.hist.dias);
  assert.strictEqual(dias.length, 8);
  const d = await K.abrirDia(fx.arquivos[r.conteudo.hist.dias[dias[0]]], r.chaveHist);
  assert.strictEqual(d.dia, dias[0]);
  assert.ok(d.l.length > 0 && d.l[0].length === 11);
});

test('sem o app no perfil, chave trocada ou errada: sem_acesso', async () => {
  const outra = await K.abrir(fx.pacote, await credDoHub(fx.hub.chave, fx.hub.salt, 'B0002')).catch(e => e);
  assert.strictEqual(outra.code, 'sem_acesso');
  const salt = await K.abrir(fx.pacote, await credDoHub(fx.hub.chave, 'b3V0cm8tc2FsdC0xNmJ5dA==')).catch(e => e);
  assert.strictEqual(salt.code, 'sem_acesso');
  const errada = await K.abrir(fx.pacote, await credDoHub('outra-chave')).catch(e => e);
  assert.strictEqual(errada.code, 'sem_acesso');
});

test('formato desconhecido e dados adulterados são recusados', async () => {
  const outroApp = Object.assign({}, fx.pacote, { app: 'co-ura' });
  assert.strictEqual((await K.abrir(outroApp, await credDoHub()).catch(e => e)).code, 'formato');
  const r = await K.abrir(fx.pacote, await credDoHub());
  const arq = JSON.parse(JSON.stringify(Object.values(fx.arquivos)[0]));
  arq.ct = Buffer.from('x'.repeat(40)).toString('base64');
  assert.strictEqual((await K.abrirDia(arq, r.chaveHist).catch(e => e)).code, 'corrompido');
});

test('nada aberto nos arquivos públicos', () => {
  const pub = JSON.stringify(fx.pacote) + JSON.stringify(fx.arquivos);
  for (const t of ['VQ_EXEMPLO', 'FIBRA', fx.hub.matricula, fx.hk]) assert.ok(!pub.includes(t), t);
});
