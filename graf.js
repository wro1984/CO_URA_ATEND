/* URA · Suporte B2C — gráfico de colunas em SVG feito à mão (sem biblioteca), no estilo do Problemas Sistêmicos.
 *
 * barras({cols, max, meta, linha, sel, rotulos})
 *   cols[i] = { rot:"08:15", and:bool (intervalo em andamento), sd:bool (sem coleta), ant:bool (inclui volume anterior),
 *               segs:[{v, cor}] empilhados de baixo para cima, lab:"texto acima" , labCor }
 *   meta    = valor da linha tracejada (opcional)
 *   linha   = [v|null, …] linha por cima das colunas (opcional)
 *   sel     = índice selecionado ou -1
 * Devolve o texto do <svg>. Cada coluna tem um retângulo invisível .hit com data-i para o toque.
 */
(function (root) {
  'use strict';
  // área das colunas: 142 de altura; embaixo só o espaço dos rótulos do eixo (20), ou 32 quando há 2ª linha de rótulo
  const W = 360, T = 26, L = 4, R = 4, AREA = 142;
  const halo = 'paint-order:stroke;stroke:var(--card);stroke-width:3px;stroke-linejoin:round';
  let uid = 0;

  // topo "redondo" da escala
  function topo(max) {
    if (!(max > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= max) return f * p;
    return 10 * p;
  }
  // retângulo com raio só no topo (rt) e/ou só na base (rb); raio 0 = canto reto
  const RAIO = 3;
  function barra(x, y, w, h, rt, rb) {
    rt = Math.max(0, Math.min(rt, w / 2, h / 2)); rb = Math.max(0, Math.min(rb, w / 2, h / 2));
    const f = v => +v.toFixed(2);
    return `M${f(x)} ${f(y + rt)}` + (rt ? `A${rt} ${rt} 0 0 1 ${f(x + rt)} ${f(y)}` : '') + `H${f(x + w - rt)}` +
      (rt ? `A${rt} ${rt} 0 0 1 ${f(x + w)} ${f(y + rt)}` : '') + `V${f(y + h - rb)}` +
      (rb ? `A${rb} ${rb} 0 0 1 ${f(x + w - rb)} ${f(y + h)}` : '') + `H${f(x + rb)}` +
      (rb ? `A${rb} ${rb} 0 0 1 ${f(x)} ${f(y + h - rb)}` : '') + 'Z';
  }
  // caminho suave por pontos [x,y] (cúbica monotônica de Fritsch–Carlson)
  function curva(p) {
    const f = v => +v.toFixed(2), n = p.length;
    if (n === 1) return `M${f(p[0][0])} ${f(p[0][1])}`;
    if (n === 2) return `M${f(p[0][0])} ${f(p[0][1])}L${f(p[1][0])} ${f(p[1][1])}`;
    const dx = [], dl = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; dl[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
    m[0] = dl[0]; m[n - 1] = dl[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (dl[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / dl[i], b = m[i + 1] / dl[i], h = a * a + b * b;
      if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * dl[i]; m[i + 1] = t * b * dl[i]; }
    }
    let d = `M${f(p[0][0])} ${f(p[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${f(p[i][0] + h)} ${f(p[i][1] + m[i] * h)} ${f(p[i + 1][0] - h)} ${f(p[i + 1][1] - m[i + 1] * h)} ${f(p[i + 1][0])} ${f(p[i + 1][1])}`;
    }
    return d;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function barras(cfg) {
    const cols = cfg.cols || [];
    const n = cols.length;
    if (!n) return '<p class="nota">Sem intervalos para mostrar ainda.</p>';
    const id = 'g' + (++uid);
    const B = cols.some(c => c.sub) ? 32 : 20, H = T + AREA + B;
    const bw = (W - L - R) / n, hh = AREA;
    let mx = 0;
    cols.forEach(c => { const s = (c.segs || []).reduce((a, g) => a + (g.v > 0 ? g.v : 0), 0); if (s > mx) mx = s; });
    (cfg.linha || []).forEach(v => { if (v != null && v > mx) mx = v; });
    (cfg.ref || []).forEach(v => { if (v != null && v > mx) mx = v; });
    if (cfg.meta != null && cfg.meta > mx) mx = cfg.meta;
    const max = cfg.max || topo(mx * 1.08);
    const Y = v => H - B - Math.max(0, Math.min(v, max)) / max * hh;
    const sel = cfg.sel == null ? -1 : cfg.sel;
    const mostra = cfg.rotulos != null ? cfg.rotulos : bw >= 22;
    const defs = `<defs>
      <pattern id="${id}sd" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="8" height="8" style="fill:var(--sdA)"/><rect width="4" height="8" style="fill:var(--sdB)"/></pattern>
      <pattern id="${id}an" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" style="fill:var(--card);opacity:.55"/></pattern></defs>`;
    let band = '', corpo = '', labs = '', xs = '', hit = '';
    const passoRot = Math.max(1, Math.ceil(n / (cfg.maxRot || 8)));
    cols.forEach((c, i) => {
      const x = L + i * bw, cx = x + bw / 2, w = Math.max(3, Math.min(30, bw * 0.62));
      if (i === sel) band += `<rect x="${x + 0.5}" y="2" width="${bw - 1}" height="${H - 4}" rx="7" style="fill:var(--selbg);stroke:var(--selln)"/>`;
      let topoY = H - B;
      if (c.sd) {
        corpo += `<rect x="${cx - w / 2}" y="${T}" width="${w}" height="${hh}" rx="4" style="fill:url(#${id}sd)"/>`;
      } else {
        // coluna empilhada como UMA barra: só a base e o topo da coluna são arredondados;
        // a emenda entre os grupos é reta (cada parte começa exatamente onde a anterior termina)
        const vis = (c.segs || []).filter(g => g.v > 0);
        let acc = 0, base = H - B;
        vis.forEach((g, k) => {
          const h = Math.max(1.5, Y(acc) - Y(acc + g.v));
          const y = base - h;
          const ultimo = k === vis.length - 1, primeiro = k === 0;
          // sobe 0,6 px por baixo da parte seguinte para não aparecer fresta entre as cores
          const ext = ultimo ? 0 : 0.6;
          corpo += `<path d="${barra(cx - w / 2, y - ext, w, h + ext, ultimo ? RAIO : 0, primeiro ? RAIO : 0)}" style="fill:${g.cor}"/>`;
          acc += g.v; base = y; topoY = y;
        });
        if (c.and && acc > 0) corpo += `<path d="${barra(cx - w / 2, topoY, w, H - B - topoY, RAIO, RAIO)}" style="fill:url(#${id}an)"/>`;
        // coluna "sem fila": bolinha verde com check, como no Problemas Sistêmicos
        if (c.ok && acc === 0) {
          const r = Math.max(4, Math.min(8.5, bw * 0.36)), cy = H - B - r - 3;
          corpo += `<g aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="${r}" style="fill:var(--okc)"/><path d="M${cx - r * 0.47} ${cy + r * 0.02}l${r * 0.32} ${r * 0.32} ${r * 0.62}-${r * 0.66}" style="fill:none;stroke:#fff;stroke-width:${r > 6 ? 2.2 : 1.6};stroke-linecap:round;stroke-linejoin:round"/></g>`;
          topoY = cy - r;
        }
      }
      if (c.lab != null && c.lab !== '' && (mostra || i === sel)) {
        // rótulo cabe na largura da coluna: texto comprido ("9m59", "1.441") diminui para não encostar no vizinho
        const fs = Math.max(7, Math.min(n > 16 ? 8.5 : 10, bw * 0.82 / (String(c.lab).length * 0.72)));
        // 2ª linha (lab2): a quantidade, em fonte menor, logo abaixo do percentual
        const tem2 = c.lab2 != null && c.lab2 !== '';
        const fs2 = tem2 ? Math.max(6.5, Math.min(fs * 0.8, bw * 0.86 / (String(c.lab2).length * 0.66))) : 0;
        const y2 = Math.max(11 + fs2 + 2, topoY - 4), y1 = tem2 ? y2 - fs2 - 2 : Math.max(11, topoY - 5);
        labs += `<text x="${cx}" y="${y1}" text-anchor="middle" style="fill:${c.labCor || 'var(--ink)'};font-size:${Math.floor(fs * 10) / 10}px;font-weight:800;${halo}">${esc(c.lab)}</text>`;
        if (tem2) labs += `<text x="${cx}" y="${y2}" text-anchor="middle" style="fill:var(--ink2);font-size:${Math.floor(fs2 * 10) / 10}px;font-weight:650;${halo}">${esc(c.lab2)}</text>`;
      }
      if (i % passoRot === 0 || i === sel || i === n - 1 && n - 1 - (Math.floor((n - 1) / passoRot) * passoRot) >= passoRot * 0.6) {
        const on = i === sel;
        xs += `<text x="${cx}" y="${H - B + 14}" text-anchor="middle" style="fill:${on ? 'var(--selink)' : c.sd ? 'var(--ink3)' : 'var(--ink2)'};font-size:10.5px;font-weight:${on ? 800 : 650}">${esc(c.rot)}${c.and ? '*' : ''}</text>`;
        if (c.sub) xs += `<text x="${cx}" y="${H - B + 26}" text-anchor="middle" style="fill:var(--ink3);font-size:9px">${esc(c.sub)}</text>`;
      }
      hit += `<rect class="hit" data-i="${i}" x="${x}" y="0" width="${bw}" height="${H}" style="fill:transparent"><title>${esc(c.titulo || c.rot)}</title></rect>`;
    });
    let meta = '';
    if (cfg.meta != null) {
      const y = Y(cfg.meta);
      // só a linha: o valor da meta fica na legenda (um texto aqui encavalaria com os rótulos das colunas)
      meta = `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--sMeta);stroke-width:1.5;stroke-dasharray:5 4"/>`;
    }
    let linha = '';
    if (cfg.linha) {
      // linha suave (curva monotônica: passa por todos os pontos sem "inventar" picos ou vales entre eles);
      // um valor vazio interrompe a linha
      const trechos = [[]], todos = [];
      cfg.linha.forEach((v, i) => {
        if (v == null) { if (trechos[trechos.length - 1].length) trechos.push([]); return; }
        const pt = [L + i * bw + bw / 2, Y(v)]; trechos[trechos.length - 1].push(pt); todos.push(pt);
      });
      const d = trechos.filter(t => t.length).map(curva).join('');
      if (d) {
        linha = `<path d="${d}" style="fill:none;stroke:var(--sAcum);stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round"/>` +
          todos.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${n > 20 ? 1.5 : 2.2}" style="fill:var(--sAcum);stroke:var(--card);stroke-width:1"/>`).join('');
      }
    }
    // previsto (mediana do histórico): área com linha suave ATRÁS das barras, na cor do gráfico bem clarinha.
    // Começa meia coluna antes da primeira e termina meia coluna depois da última, para cobrir as colunas das pontas.
    let ref = '';
    if (cfg.ref) {
      const cor = cfg.refCor || 'var(--p500)';
      const trechos = [[]];
      cfg.ref.forEach((v, i) => {
        if (v == null) { if (trechos[trechos.length - 1].length) trechos.push([]); return; }
        trechos[trechos.length - 1].push([L + i * bw + bw / 2, Y(v)]);
      });
      const base = (H - B).toFixed(1), f = v => v.toFixed(1);
      trechos.filter(t => t.length).forEach(t => {
        const pts = [[t[0][0] - bw / 2, t[0][1]]].concat(t, [[t[t.length - 1][0] + bw / 2, t[t.length - 1][1]]]);
        const topo = curva(pts);
        ref += `<path class="ref" d="${topo}L${f(pts[pts.length - 1][0])} ${base}L${f(pts[0][0])} ${base}Z" style="fill:color-mix(in srgb,${cor} 13%,var(--card));stroke:none"/>` +
          `<path class="ref-l" d="${topo}" style="fill:none;stroke:color-mix(in srgb,${cor} 55%,var(--card));stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round"/>`;
      });
    }
    const base = `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" style="stroke:var(--line);stroke-width:1"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.aria || 'gráfico')}">${defs}${band}${ref}${base}${corpo}${meta}${linha}${labs}${xs}${hit}</svg>`;
  }

  const api = { barras, topo, curva, W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Graf = api;
})(typeof self !== 'undefined' ? self : this);
