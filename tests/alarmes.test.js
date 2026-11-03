// Regras do painel de alarmes (node tests/alarmes.test.js): só as contas, sem tela. Duas visões: 'agora' (hora aberta) e 'dia'.
const assert = require('assert');
const A = require('../alarmes.js');
let ok = 0;
const t = (nome, fn) => { try { fn(); ok++; console.log('ok  ', nome); } catch (e) { console.log('FALHOU', nome, '\n  ', e.message); process.exitCode = 1; } };
const per = (dia) => ({ ini: dia ? null : 1140, ate: 1155, fecha: false, ofer: dia ? 1500 : 30, oferPrev: dia ? 1500 : 30, oferPrevHora: dia ? null : 70,
  co: { ofer: dia ? 1000 : 25, fin: dia ? 1000 : 25, a300: dia ? 950 : 24, ns: 95, aband: dia ? 30 : 1, abandPct: 3, tme: 40, tma: 600, dir60: 80 },
  prev: { ns: 94, aband: dia ? 30 : 1, tme: 40, tma: 600, dir60: 80 }, telPct: 30, telPctPrev: 30,
  filaPico: 0, filaPicoPrev: 0, filaDiasRef: 0, filaRefs: 7, grupos: [{ g: 'SUPORTE TV', dir: 'CO', v: dia ? 100 : 10, prev: dia ? 100 : 10 }], onde: {} });
const base = () => ({ horario: '19:15', cmpNome: '7 sex', vivo: true, atrasoMin: 2, agora: per(false), dia: per(true),
  fila: { total: 0, espMax: 0, skillMax: '', semAgente: [] }, paradas: [] });
const por = (l, id) => l.find(x => x.id === id);
const nv = (m, v, id, lim) => por(A.avaliar(m, v, lim), id).nivel;
t('tipos: 12, com nome e descrição', () => { assert.strictEqual(A.TIPOS.length, 12); assert(A.TIPOS.every(x => x.id && x.nome && x.desc)); });
t('tudo normal nas duas visões: 12 verificações ok, todas com número e referência', () => {
  ['agora', 'dia'].forEach(v => { const l = A.avaliar(base(), v); assert.strictEqual(l.length, 12); assert(l.every(x => x.atual && x.ref), v + ' sem número: ' + l.filter(x => !x.atual || !x.ref).map(x => x.id).join()); assert(l.every(x => x.nivel === 'ok'), v + ': ' + l.filter(x => x.nivel !== 'ok').map(x => x.id).join()); });
});
t('as duas visões olham trechos diferentes (NS do dia ruim, NS da hora bom)', () => {
  const m = base(); m.dia.co.ns = 61;
  assert.strictEqual(nv(m, 'dia', 'ns'), 'crit'); assert.strictEqual(nv(m, 'agora', 'ns'), 'ok');
  assert.strictEqual(por(A.avaliar(m, 'dia'), 'ns').titulo, 'NS · abaixo de 70% no dia');
});
t('NS: 85% atenção; da hora só a partir de 15 finalizadas', () => {
  const m = base(); m.agora.co.ns = 85; assert.strictEqual(nv(m, 'agora', 'ns'), 'aten');
  m.agora.co.fin = 14; assert.strictEqual(nv(m, 'agora', 'ns'), 'na');
});
t('volume: hora +25%/+50%, dia +15%/+30%; previsto pequeno não avalia', () => {
  const m = base(); m.agora.oferPrev = 40; m.agora.ofer = 50; assert.strictEqual(nv(m, 'agora', 'vol'), 'aten');
  m.agora.ofer = 60; assert.strictEqual(nv(m, 'agora', 'vol'), 'crit');
  m.agora.ofer = 28; const x = por(A.avaliar(m, 'agora'), 'vol'); assert.strictEqual(x.titulo, 'Oferecidas · abaixo do previsto na hora'); assert.strictEqual(x.valor, '−30%');
  m.agora.oferPrev = 19; assert.strictEqual(nv(m, 'agora', 'vol'), 'na');
  m.dia.ofer = 1725; assert.strictEqual(nv(m, 'dia', 'vol'), 'aten'); m.dia.ofer = 1950; assert.strictEqual(nv(m, 'dia', 'vol'), 'crit');
});
t('abandono da hora: conta os abandonos A MAIS (previsto 0 → 3 atenção, 6 crítico)', () => {
  const m = base(); m.agora.prev.aband = 0; m.agora.co.aband = 2; assert.strictEqual(nv(m, 'agora', 'aband'), 'ok');
  m.agora.co.aband = 3; const x = por(A.avaliar(m, 'agora'), 'aband'); assert.strictEqual(x.nivel, 'aten'); assert.strictEqual(x.valor, '+3');
  m.agora.co.aband = 6; assert.strictEqual(nv(m, 'agora', 'aband'), 'crit');
  m.agora.prev.aband = 30; m.agora.co.aband = 36; assert.strictEqual(nv(m, 'agora', 'aband'), 'aten', '6 a mais sobre 30 = +20%: atenção, não crítico (precisa +40%)');
  m.agora.co.aband = 34; assert.strictEqual(nv(m, 'agora', 'aband'), 'ok', '4 a mais sobre 30 = +13%: normal');
});
t('abandono do dia: +20% atenção, +40% crítico, 10% das oferecidas crítico', () => {
  const m = base(); m.dia.prev.aband = 100; m.dia.co.aband = 125; assert.strictEqual(nv(m, 'dia', 'aband'), 'aten');
  m.dia.co.aband = 140; assert.strictEqual(nv(m, 'dia', 'aband'), 'crit');
  m.dia.co.aband = 100; m.dia.co.abandPct = 10; const x = por(A.avaliar(m, 'dia'), 'aband'); assert.strictEqual(x.nivel, 'crit'); assert.strictEqual(x.titulo, 'Abandonadas · 10% ou mais das oferecidas');
});
t('fila agora: espera 2 min atenção, 5 min crítico, 15 esperando "Fila grande"', () => {
  const m = base(); m.fila = { total: 2, espMax: 120, skillMax: 'X', semAgente: [] }; m.agora.filaPico = 2; m.agora.filaPicoPrev = 2; m.agora.filaDiasRef = 5;
  assert.strictEqual(nv(m, 'agora', 'fila'), 'aten');
  m.fila.espMax = 300; assert.strictEqual(nv(m, 'agora', 'fila'), 'crit');
  m.fila = { total: 15, espMax: 30, semAgente: [] }; const x = por(A.avaliar(m, 'agora'), 'fila'); assert.strictEqual(x.nivel, 'crit'); assert.strictEqual(x.titulo, 'Em espera · fila grande');
});
t('fila fora do comum: alguém esperando num horário em que quase nunca há fila', () => {
  const m = base(); m.fila = { total: 1, espMax: 30, semAgente: [] }; m.agora.filaPico = 1; m.agora.filaPicoPrev = 0; m.agora.filaDiasRef = 1;
  let x = por(A.avaliar(m, 'agora'), 'fila'); assert.strictEqual(x.nivel, 'aten'); assert.strictEqual(x.titulo, 'Em espera · fora do comum para o horário'); assert.strictEqual(x.status, 'fora do comum para o horário'); assert(/fila em 1 de 7 dias/.test(x.det));
  m.agora.filaDiasRef = 3; assert.strictEqual(nv(m, 'agora', 'fila'), 'ok', 'fila em 3 de 7 dias: comum');
  m.agora.filaPicoPrev = 2; m.agora.filaPico = 5; m.fila.total = 0; assert.strictEqual(nv(m, 'agora', 'fila'), 'aten', 'maior fila 3 acima da mediana');
});
t('fila do dia: maior fila contra a mediana das maiores filas', () => {
  const m = base(); m.dia.filaPicoPrev = 40; m.dia.filaPico = 50; assert.strictEqual(nv(m, 'dia', 'fila'), 'ok');
  m.dia.filaPico = 60; assert.strictEqual(nv(m, 'dia', 'fila'), 'aten'); m.dia.filaPico = 80; assert.strictEqual(nv(m, 'dia', 'fila'), 'crit');
});
t('fila sem agente, skills paradas e coleta valem igual nas duas visões', () => {
  const m = base(); m.fila = { total: 1, espMax: 10, semAgente: ['HB_SUP'] }; m.paradas = [{ nome: 'S1', prev: 4 }, { nome: 'S2', prev: 8, dir: 'TEL' }]; m.atrasoMin = 12;
  ['agora', 'dia'].forEach(v => { const l = A.avaliar(m, v); assert.deepStrictEqual(['agentes', 'parada', 'coleta'].map(id => por(l, id).nivel), ['aten', 'aten', 'aten'], v); assert(!por(l, 'parada').det.includes('S1')); });
  m.vivo = false; assert.strictEqual(nv(m, 'agora', 'coleta'), 'na');
});
t('TME/TMA: % e diferença mínima (hora: TME 60 s)', () => {
  const m = base(); m.agora.prev.tme = 13; m.agora.co.tme = 55; assert.strictEqual(nv(m, 'agora', 'tme'), 'ok', '+42 s ainda é pouco');
  m.agora.co.tme = 80; assert.strictEqual(nv(m, 'agora', 'tme'), 'crit');
  m.dia.co.tma = 760; assert.strictEqual(nv(m, 'dia', 'tma'), 'aten');
  m.agora.co.fin = 10; assert.strictEqual(nv(m, 'agora', 'tme'), 'na');
});
t('atendidos direto e CO/TEL em p.p.', () => {
  const m = base(); m.agora.co.dir60 = 60; const x = por(A.avaliar(m, 'agora'), 'direto'); assert.strictEqual(x.nivel, 'crit'); assert.strictEqual(x.valor, '−20,0');
  m.dia.telPct = 41; assert.strictEqual(nv(m, 'dia', 'tel'), 'aten'); m.dia.telPct = 9; assert.strictEqual(nv(m, 'dia', 'tel'), 'crit');
  m.agora.telPct = 50; m.agora.ofer = 10; assert.strictEqual(nv(m, 'agora', 'tel'), 'na', 'poucas oferecidas na hora');
});
t('grupos: um alarme por grupo, com destino na Evolução', () => {
  const m = base(); m.agora.grupos = [{ g: 'A', dir: 'CO', v: 16, prev: 10 }, { g: 'B', dir: 'TEL', v: 25, prev: 10 }, { g: 'C', dir: 'CO', v: 50, prev: 5 }];
  const l = A.avaliar(m, 'agora'), gs = l.filter(x => x.tipo === 'grupos');
  assert.deepStrictEqual(gs.map(x => x.id + '/' + x.nivel), ['grupo:B/crit', 'grupo:A/aten']);
  assert.deepStrictEqual(gs[0].alvo, { ch: 'of', dir: 'TEL', grupo: 'B' });
});
t('sem previsto: o que depende dele fica "sem dado"', () => {
  const m = base(); m.cmpNome = '';
  ['agora', 'dia'].forEach(v => { const P = m[v]; P.prev = { ns: null, aband: null, tme: null, tma: null, dir60: null }; P.oferPrev = null; P.telPctPrev = null; P.filaPicoPrev = null; P.grupos = null; });
  m.paradas = null;
  assert.deepStrictEqual(A.avaliar(m, 'agora').filter(x => x.nivel === 'na').map(x => x.id).sort(), ['aband', 'direto', 'grupos', 'parada', 'tel', 'tma', 'tme', 'vol']);
  assert.strictEqual(nv(m, 'dia', 'aband'), 'ok', 'no dia o abandono ainda avalia a % das oferecidas');
});
t('ordem: críticos primeiro, depois atenção, na ordem das regras', () => {
  const m = base(); m.fila = { total: 2, espMax: 130, semAgente: [] }; m.agora.co.ns = 60; m.agora.ofer = 40;
  assert.deepStrictEqual(A.avaliar(m, 'agora').slice(0, 3).map(x => x.id), ['ns', 'vol', 'fila']);
});
t('limites trocáveis por visão', () => {
  const m = base(); m.dia.co.ns = 85; const lim = JSON.parse(JSON.stringify(A.LIM)); lim.dia.ns.aten = 80;
  assert.strictEqual(nv(m, 'dia', 'ns', lim), 'ok'); assert.strictEqual(nv(m, 'dia', 'ns'), 'aten');
});
t('histórico local: "desde", último encerrado, silêncio vencido e virada do dia', () => {
  const ns = { id: 'ns', nivel: 'crit', titulo: 'NS do dia abaixo de 70%' }, ok2 = { id: 'ns', nivel: 'ok', titulo: 'x' };
  let h = A.registrar(null, '2026-10-30', '10:30', [ns], 0);
  h = A.registrar(h, '2026-10-30', '10:35', [ns], 0);
  assert.strictEqual(h.desde.ns, '10:30');
  h.sil = { ns: 1000, outro: 5000 };
  h = A.registrar(h, '2026-10-30', '11:00', [ok2], 2000);
  assert.deepStrictEqual(h.ult, { titulo: 'NS do dia abaixo de 70%', fim: '11:00', mais: 0 }); assert(!h.desde.ns);
  assert.deepStrictEqual(Object.keys(h.sil), ['outro']);
  h = A.registrar(h, '2026-10-31', '08:05', [ok2], 2000);
  assert.strictEqual(h.ult, null); assert.deepStrictEqual(h.sil, {});
});
console.log(ok + ' testes ok');
