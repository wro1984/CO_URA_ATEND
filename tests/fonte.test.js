// fonte.js: monta o pulse.json do dia (horas fechadas + hora aberta) e o historico.csv (os dias) a partir dos arquivos
// cifrados do MAPI (tests/fixtures/pacote.json, dados inventados), e o app lê os dois com as funções de sempre.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));
const S = crypto.subtle, enc = new TextEncoder();
const norm = c => String(c || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

globalThis.location = { href: 'https://exemplo.invalid/CO_URA_ATEND/' };
const baixados = [];
globalThis.fetch = async (caminho) => {
  baixados.push(caminho);
  const corpo = caminho === 'dados.json' ? fx.pacote : fx.arquivos[caminho];
  if (!corpo) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(corpo)) };
};
const K = require('../cripto.js');
globalThis.URAACripto = K;
const F = require('../fonte.js');
const D = require('../dados.js');
const Hs = require('../historico.js');

async function credDoHub(mat = fx.hub.matricula) {
  const base = await S.importKey('raw', enc.encode(norm(fx.hub.chave)), 'PBKDF2', false, ['deriveKey']);
  const k = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(fx.hub.salt, 'base64'), iterations: fx.hub.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const id = Buffer.from(await S.digest('SHA-256', enc.encode('hub:' + mat))).toString('hex');
  return { id, matricula: mat, chave: k, salt: fx.hub.salt };
}

test('sem login do HUB: sem_cred', async () => {
  K.lerCredHub = async () => null;
  assert.strictEqual((await F.pulse().catch(e => e)).code, 'sem_cred');
});

test('pulse.json do dia = horas fechadas + hora aberta, e o app normaliza', async () => {
  const cred = await credDoHub();
  K.lerCredHub = async () => cred;
  const p = await F.pulse();
  assert.deepStrictEqual(p.leituras.map(l => l.horario), fx.pulse.leituras.map(l => l.horario));
  assert.deepStrictEqual(p, fx.pulse);
  const d = D.normalizar(p);
  assert.strictEqual(d.leituras.length, fx.pulse.leituras.length);
});

test('historico.csv remontado dos dias, com a fila, e o app lê', async () => {
  const txt = await F.historico();
  const linhas = txt.trim().split('\n');
  assert.strictEqual(linhas[0], 'DIA;HORARIO;SKILL;OFERECIDAS;ATENDIDAS;ABANDONADAS;ATEND_60S;ATEND_300S;SOMA_ESPERA_S;SOMA_TMA_S;FILA;ESPERA_MAX_S');
  assert.strictEqual(linhas.length - 1, fx.historico_linhas);
  const H = Hs.parse(txt);
  assert.ok(H.colsFila, 'fila nas colunas');
  assert.strictEqual(H.lista.length, 8);
});

test('arquivo já aberto não é baixado de novo', async () => {
  const antes = baixados.length;
  await F.historico();
  assert.strictEqual(baixados.length, antes);
});

test('sem o app no perfil: sem_acesso', async () => {
  const outra = await credDoHub('B0002');
  K.lerCredHub = async () => outra;
  F.apagarCopias();
  assert.strictEqual((await F.pulse().catch(e => e)).code, 'sem_acesso');
});
