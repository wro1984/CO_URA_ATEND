// Contas do app (calc.js) com dias pequenos montados à mão (dados inventados).
const test = require('node:test');
const assert = require('node:assert');
const C = require('../calc.js');

const trad = { s: { A: ['G1', 'CO'], B: ['G1', 'CO'], T: ['G1', 'TEL'], X: ['G2', 'CO'] }, co: 'CO' };
// [i_h, i_s, of, at, ab, a60, a300, se, st, fi, em]
const dia = { dia: '2026-11-03', h: ['08:00', '08:15', '08:30', '08:45'], s: ['A', 'B', 'T', 'X'], l: [
  [0, 0, 10, 8, 2, 6, 8, 80, 4000, 3, 100], [0, 1, 4, 4, 0, 4, 4, 20, 2000, 1, 50], [0, 2, 7, 0, 7, 0, 0, 0, 0, 0, 0],
  [1, 0, 6, 5, 1, 5, 5, 50, 2500, 0, 0], [2, 3, 2, 2, 0, 2, 2, 10, 900, 2, 200], [3, 0, 1, 1, 0, 1, 1, 5, 500, 4, 30]] };

test('total: volume de todos, qualidade só do CO', () => {
  const k = C.kpis(C.total(dia, trad, { filtro: 'total' }));
  assert.strictEqual(k.of, 30);               // 10+4+7+6+2+1 (TEL entra no volume)
  assert.strictEqual(k.at, 20);
  assert.strictEqual(k.ab, 3);                // os 7 da TEL não entram no abandono
  assert.strictEqual(Math.round(k.pctAb * 10) / 10, Math.round(1000 * 3 / 23) / 10);
  assert.strictEqual(k.ns300, 100);
  assert.strictEqual(k.tma, 9900 / 20);
  assert.strictEqual(k.fi, 4);                // no dia: o maior retrato (08:00 = 3+1 = 4; 08:45 = 4)
  assert.strictEqual(k.em, 200);              // o maior
});

test('TEL só volume; CO sem a TEL', () => {
  assert.strictEqual(C.kpis(C.total(dia, trad, { filtro: 'TEL' })).of, 7);
  assert.strictEqual(C.kpis(C.total(dia, trad, { filtro: 'CO' })).of, 23);
});

test('fila em 30 min e 1 h = último retrato do período', () => {
  const p30 = C.periodos(C.blocos(dia, trad, { filtro: 'total' }), 30);
  assert.deepStrictEqual(p30.map(p => [p.rotulo, p.fi]), [['08:00', 0], ['08:30', 4]]);  // 08:15 sem fila; 08:45 = 4
  const p60 = C.periodos(C.blocos(dia, trad, { filtro: 'total' }), 60);
  assert.strictEqual(p60[0].fi, 4);
  assert.strictEqual(p60[0].em, 200);
});

test('período ainda aberto (hoje) usa o último bloco que já existe', () => {
  const ps = C.periodos(C.blocos(dia, trad, { filtro: 'total' }, 8 * 60 + 45), 60, 8 * 60 + 45);
  assert.strictEqual(ps[0].fi, 2);            // até 08:30: o último bloco é o das 08:30 (X com 2)
});

test('grupos e skills', () => {
  const gs = C.grupos(dia, trad, { filtro: 'total' });
  assert.deepStrictEqual(gs.map(g => g.grupo), ['G1', 'G2']);
  assert.deepStrictEqual(gs[0].skills.map(s => s.skill), ['A', 'T', 'B']);
  assert.strictEqual(gs[0].k.of, 28);
});

test('média das semanas e dias de referência', () => {
  const m = C.kpis(C.media([C.total(dia, trad, { filtro: 'CO' }), C.total({ h: [], s: [], l: [] }, trad, { filtro: 'CO' })]));
  assert.strictEqual(m.of, 11.5);
  const ref = C.diasReferencia('2026-11-03', ['2026-10-27', '2026-10-20', '2026-10-28', '2026-09-15']);
  assert.deepStrictEqual(ref, ['2026-10-27', '2026-10-20', '2026-09-15']);
});

test('agora do Pulse: agentes não se somam, EWT sem agente fica de fora', () => {
  const ag = { c: ['espera', 'mais_antiga', 'logados', 'oferecidas', 'atendidas', 'abandono', 'at300', 'tma', 'ewt'], l: [
    ['A', 2, 90, 10, 50, 40, 5, 38, 500, 60], ['B', 1, 30, 8, 20, 18, 1, 18, 300, 10000], ['T', 4, 99, 3, 30, 0, 30, 0, 0, 5]] };
  const a = C.agora(ag, trad, { filtro: 'total' });
  assert.strictEqual(a.of, 100);
  assert.strictEqual(a.fila, 3);              // TEL fora da fila
  assert.strictEqual(a.logados, 10);
  assert.strictEqual(a.ewt, 60);
  assert.strictEqual(a.ns300, 100 * 56 / 58);
  assert.strictEqual(a.tma, (500 * 40 + 300 * 18) / 58);
});
