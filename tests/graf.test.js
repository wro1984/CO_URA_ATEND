// Testes do desenho das colunas (node tests/graf.test.js)
const assert = require('assert');
const G = require('../graf.js');
let ok = 0;
const t = (nome, fn) => { try { fn(); ok++; console.log('ok  ', nome); } catch (e) { console.log('FALHOU', nome, '\n  ', e.message); process.exitCode = 1; } };
const paths = svg => [...svg.matchAll(/<path d="([^"]+)" style="fill:(var\(--[a-zA-Z]+\)|url[^"]+)"/g)].map(m => ({ d: m[1], fill: m[2] }));
const arcos = d => (d.match(/A/g) || []).length;
// os 2 arcos de um caminho ficam no topo (logo após o 1º ponto) ou na base (depois do V)
const topoArredondado = d => /^M[^A]*A/.test(d) && d.indexOf('A') < d.indexOf('H');
const baseArredondada = d => /V[\d.]+A/.test(d);

t('coluna empilhada: base arredondada só embaixo, topo só em cima, emenda reta', () => {
  const svg = G.barras({ cols: [{ rot: 'a', segs: [{ v: 60, cor: 'var(--sCO)' }, { v: 40, cor: 'var(--sAb)' }] }], max: 100 });
  const p = paths(svg);
  assert.strictEqual(p.length, 2);
  const [baixo, cima] = p;
  assert.strictEqual(baixo.fill, 'var(--sCO)');
  assert.ok(baseArredondada(baixo.d) && !topoArredondado(baixo.d), 'parte de baixo: só a base arredondada');
  assert.ok(topoArredondado(cima.d) && !baseArredondada(cima.d), 'parte de cima: só o topo arredondado');
  assert.strictEqual(arcos(baixo.d) + arcos(cima.d), 4);
});

t('três partes: a do meio é reta nos quatro cantos', () => {
  const svg = G.barras({ cols: [{ rot: 'a', segs: [{ v: 30, cor: 'var(--sCO)' }, { v: 30, cor: 'var(--sTEL)' }, { v: 30, cor: 'var(--sAb)' }] }], max: 100 });
  const p = paths(svg);
  assert.strictEqual(p.length, 3);
  assert.strictEqual(arcos(p[1].d), 0);
});

t('coluna de uma parte só: arredondada em cima e embaixo', () => {
  const p = paths(G.barras({ cols: [{ rot: 'a', segs: [{ v: 50, cor: 'var(--sCO)' }] }], max: 100 }));
  assert.strictEqual(p.length, 1);
  assert.ok(topoArredondado(p[0].d) && baseArredondada(p[0].d));
});

t('parte com valor zero é ignorada (a outra vira a coluna inteira)', () => {
  const p = paths(G.barras({ cols: [{ rot: 'a', segs: [{ v: 50, cor: 'var(--sCO)' }, { v: 0, cor: 'var(--sAb)' }] }], max: 100 }));
  assert.strictEqual(p.length, 1);
  assert.ok(topoArredondado(p[0].d) && baseArredondada(p[0].d));
});

t('as partes se encostam: o topo de uma é a base da outra (sem fresta)', () => {
  const p = paths(G.barras({ cols: [{ rot: 'a', segs: [{ v: 60, cor: 'var(--sCO)' }, { v: 40, cor: 'var(--sAb)' }] }], max: 100 }));
  const topoBaixo = +/^M[\d.]+ ([\d.]+)/.exec(p[0].d)[1];
  const baseCima = +/V([\d.]+)/.exec(p[1].d)[1];
  assert.ok(topoBaixo <= baseCima, `parte de baixo (${topoBaixo}) deve subir até a de cima (${baseCima})`);
});
t('linha do NS: curva suave (C) que não passa do maior nem do menor ponto de cada trecho', () => {
  const pts = [[10, 100], [40, 20], [70, 30], [100, 30], [130, 90]];
  const d = G.curva(pts);
  assert.ok(/^M10 100C/.test(d) && (d.match(/C/g) || []).length === 4, 'quatro trechos curvos');
  const nums = d.slice(1).split(/[MC ]/).filter(Boolean).map(Number);
  const ctl = []; for (let i = 2; i < nums.length; i += 6) ctl.push([nums[i + 1], nums[i + 3]]);
  ctl.forEach(([y1, y2], i) => {
    const lo = Math.min(pts[i][1], pts[i + 1][1]), hi = Math.max(pts[i][1], pts[i + 1][1]);
    assert.ok(y1 >= lo - 1e-9 && y1 <= hi + 1e-9 && y2 >= lo - 1e-9 && y2 <= hi + 1e-9, 'trecho ' + i + ' sem pico inventado');
  });
  // trecho plano continua plano
  assert.ok(ctl[2][0] === 30 && ctl[2][1] === 30);
});

t('linha no gráfico: caminho suave, sem polyline; valor vazio interrompe', () => {
  const cols = [1, 2, 3, 4].map(i => ({ rot: String(i), segs: [{ v: 50, cor: 'var(--sCO)' }] }));
  const svg = G.barras({ cols, max: 100, linha: [80, 60, null, 70] });
  assert.ok(!/polyline/.test(svg));
  const d = /<path d="(M[^"]+)" style="fill:none;stroke:var\(--sAcum\)/.exec(svg)[1];
  assert.strictEqual((d.match(/M/g) || []).length, 2, 'dois trechos (antes e depois do vazio)');
});

t('altura menor embaixo do eixo (sem 2ª linha de rótulo)', () => {
  const svg = G.barras({ cols: [{ rot: 'a', segs: [{ v: 1, cor: 'x' }] }] });
  assert.ok(/viewBox="0 0 360 188"/.test(svg), svg.slice(0, 60));
  const svg2 = G.barras({ cols: [{ rot: 'a', sub: 'seg', segs: [{ v: 1, cor: 'x' }] }] });
  assert.ok(/viewBox="0 0 360 200"/.test(svg2));
});

t('rótulo comprido diminui para caber na coluna (sem encostar no vizinho)', () => {
  const cols = Array.from({ length: 12 }, (_, i) => ({ rot: String(i), segs: [{ v: 50, cor: 'x' }], lab: i % 2 ? '9m59' : '1.441' }));
  const svg = G.barras({ cols, max: 100 });
  const bw = (360 - 8) / 12;
  [...svg.matchAll(/font-size:([\d.]+)px;font-weight:800;[^>]*>([^<]+)</g)].forEach(m => {
    const larg = +m[1] * 0.72 * m[2].length;
    assert.ok(larg <= bw * 0.82 + 0.01 || +m[1] === 7, `${m[2]} com ${m[1]}px ocupa ${larg.toFixed(1)} de ${bw.toFixed(1)}`);
  });
});

t('rótulo em duas linhas: % em cima (maior) e quantidade embaixo (menor), acima da coluna', () => {
  const svg = G.barras({ cols: [{ rot: 'a', segs: [{ v: 50, cor: 'x' }], lab: '41%', lab2: '1.234' }], max: 100 });
  const tx = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*font-size:([\d.]+)px;font-weight:(\d+)[^>]*>([^<]+)</g)].map(m => ({ y: +m[1], fs: +m[2], w: m[3], t: m[4] }));
  const p = tx.find(x => x.t === '41%'), q = tx.find(x => x.t === '1.234');
  assert.ok(p && q, 'dois textos');
  assert.ok(p.y < q.y, '% acima da quantidade');
  assert.ok(q.fs < p.fs, 'quantidade com fonte menor');
  const topo = 26 + 142 * 0.5;   // topo da coluna de 50%
  assert.ok(q.y < topo, 'quantidade acima da coluna');
});

console.log(`\n${ok} teste(s) ok${process.exitCode ? ' — HÁ FALHAS' : ''}`);
