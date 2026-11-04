// fonte.js com os arquivos em outro endereço (Worker da Cloudflare, config.js): baixa de lá, guarda os dias e as horas
// (que nunca mudam) no cache do app e não baixa de novo; sem rede, abre a última cópia (cifrada) do dados.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));
const S = crypto.subtle, enc = new TextEncoder();
const norm = c => String(c || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const BASE = 'https://dados.exemplo.invalid/ura-atendimento/';
globalThis.location = { href: 'https://exemplo.invalid/CO_URA_ATEND/' };
globalThis.URAA_CONFIG = { dados: BASE };

// Cache API de mentira (só o que o fonte.js usa)
const lojas = new Map();
globalThis.caches = {
  async open(n) {
    if (!lojas.has(n)) lojas.set(n, new Map());
    const m = lojas.get(n);
    return { async match(u) { const r = m.get(u); return r ? r.clone() : undefined; },
      async put(u, r) { m.set(u, r); }, async keys() { return [...m.keys()].map(url => ({ url })); },
      async delete(u) { return m.delete(u && u.url ? u.url : u); } };
  },
  async delete(n) { return lojas.delete(n); },
  async keys() { return [...lojas.keys()]; },
};
const resp = corpo => ({ ok: true, status: 200, json: async () => JSON.parse(corpo), clone() { return resp(corpo); } });

const baixados = [];
let semRede = false;
globalThis.fetch = async (u) => {
  if (semRede) throw new TypeError('Failed to fetch');
  baixados.push(u);
  assert.ok(u.startsWith(BASE), 'tudo vem do endereço configurado: ' + u);
  const c = u.slice(BASE.length);
  const corpo = c === 'dados.json' ? fx.pacote : fx.arquivos[c];
  if (!corpo) return { ok: false, status: 404 };
  return resp(JSON.stringify(corpo));
};
const K = require('../cripto.js');
globalThis.URAACripto = K;
const F = require('../fonte.js');

async function credDoHub(mat = fx.hub.matricula) {
  const base = await S.importKey('raw', enc.encode(norm(fx.hub.chave)), 'PBKDF2', false, ['deriveKey']);
  const k = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(fx.hub.salt, 'base64'), iterations: fx.hub.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const id = Buffer.from(await S.digest('SHA-256', enc.encode('hub:' + mat))).toString('hex');
  return { id, matricula: mat, chave: k, salt: fx.hub.salt };
}

test('lê do endereço configurado e monta o mesmo pulse.json e historico.csv', async () => {
  assert.strictEqual(F.BASE, BASE);
  K.lerCredHub = async () => credDoHub();
  assert.deepStrictEqual(await F.pulse(), fx.pulse);
  const linhas = (await F.historico()).trim().split('\n');
  assert.strictEqual(linhas.length - 1, fx.historico_linhas);
  const hist = lojas.get(F.CACHE_HIST);
  assert.strictEqual(hist.size, Object.keys(fx.arquivos).length, 'dias e horas guardados no aparelho (cifrados)');
});

test('arquivo de dia/hora já guardado não é baixado de novo (nem depois de reabrir o app)', async () => {
  // a memória some ao reabrir o app: simula com um módulo novo; o cache fica
  delete require.cache[require.resolve('../fonte.js')];
  const F2 = require('../fonte.js');
  const antes = baixados.length;
  await F2.pulse(); await F2.historico();
  assert.deepStrictEqual(baixados.slice(antes), [BASE + 'dados.json'], 'só o dados.json veio da rede');
});

test('sem rede: abre com a última cópia do dados.json', async () => {
  delete require.cache[require.resolve('../fonte.js')];
  const F3 = require('../fonte.js');
  semRede = true;
  try { assert.deepStrictEqual(await F3.pulse(), fx.pulse); } finally { semRede = false; }
});

test('sem acesso: apaga as cópias (dias, horas e dados.json)', async () => {
  const outra = await credDoHub('B0002');
  K.lerCredHub = async () => outra;
  delete require.cache[require.resolve('../fonte.js')];
  const F4 = require('../fonte.js');
  assert.strictEqual((await F4.pulse().catch(e => e)).code, 'sem_acesso');
  assert.ok(!lojas.has(F4.CACHE_HIST) && !lojas.has('co-ura-atend-dados'));
});

test('endereço que não é https é recusado', () => {
  globalThis.URAA_CONFIG = { dados: 'http://inseguro.invalid/x/' };
  delete require.cache[require.resolve('../fonte.js')];
  assert.throws(() => require('../fonte.js'), /inválido/);
  globalThis.URAA_CONFIG = { dados: BASE };
});
