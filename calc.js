/* URA Atendimento — contas (roda no navegador e no Node, para os testes).
 *
 * Um DIA (do histórico ou o de hoje) chega como {dia, h:[horários], s:[skills], l:[[i_h, i_s, of, at, ab, a60, a300,
 * se, st, fi, em]]} (formato do MAPI, ura_atend.py). Regras:
 *   - of…st SOMAM no tempo e entre skills;
 *   - fi (técnicos na fila no fim do bloco) soma entre skills; no tempo vale o ÚLTIMO bloco do período (30 min, 1 h).
 *     No dia inteiro o último bloco é sempre zero (madrugada), então no DIA vale o MAIOR retrato;
 *   - em (espera do mais antigo) é sempre o MAIOR.
 * Qualidade (atendidas, NS, abandono, TMA, TME, fila) é só do CO: na TEL toda chamada vem como abandonada e o app usa
 * só o volume. No Total, o volume é de todos e a qualidade é a do CO.
 */
(function (root) {
  'use strict';

  const SOMAS = ['of', 'at', 'ab', 'a60', 'a300', 'se', 'st'];
  const minutos = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const vazio = () => ({ v: { of: 0 }, q: { of: 0, at: 0, ab: 0, a60: 0, a300: 0, se: 0, st: 0, seNulo: false }, fi: 0, em: 0 });

  // atributos da skill: [grupo, direcionamento] da tradutora (sem tradução: grupo "SEM TRADUÇÃO")
  function attrs(trad, skill) {
    const a = trad && trad.s && trad.s[skill];
    return a ? { grupo: a[0] || '(vazio)', dir: a[1] || '' } : { grupo: 'SEM TRADUÇÃO', dir: '' };
  }
  const ehCO = (trad, a) => String(a.dir).toUpperCase() === String((trad && trad.co) || 'CO').toUpperCase();

  // a skill entra no recorte? filtro: 'total' | 'CO' | 'TEL'; grupo e skill opcionais
  function entra(trad, skill, sel) {
    const a = attrs(trad, skill);
    if (sel.filtro === 'CO' && !ehCO(trad, a)) return false;
    if (sel.filtro === 'TEL' && String(a.dir).toUpperCase() !== 'TEL') return false;
    if (sel.grupo != null && a.grupo !== sel.grupo) return false;
    if (sel.skill != null && skill !== sel.skill) return false;
    return true;
  }

  // dia -> {minuto do bloco: acumulador} no recorte, só blocos antes de `ate` (minutos; opcional)
  function blocos(dia, trad, sel, ate) {
    const out = new Map();
    if (!dia) return out;
    for (const l of dia.l || []) {
      const h = minutos(dia.h[l[0]]);
      if (ate != null && h >= ate) continue;
      const skill = dia.s[l[1]];
      if (!entra(trad, skill, sel)) continue;
      let b = out.get(h);
      if (!b) out.set(h, b = vazio());
      b.v.of += l[2] || 0;
      if (ehCO(trad, attrs(trad, skill))) {
        SOMAS.forEach((k, i) => {
          if (k === 'se' && l[7] == null) { b.q.seNulo = true; return; }
          b.q[k] += l[2 + i] || 0;
        });
        b.fi += l[9] || 0;
        b.em = Math.max(b.em, l[10] || 0);
      }
    }
    return out;
  }

  // blocos -> períodos de `gran` minutos (15, 30, 60; 1440 = o dia). Fila: último bloco do período (dia: o maior).
  // `ate` (minutos, hoje): o período ainda aberto usa o último bloco que já existe
  function periodos(mapa, gran, ate) {
    const out = new Map();
    const chaves = [...mapa.keys()].sort((a, b) => a - b);
    for (const h of chaves) {
      const b = mapa.get(h), p0 = gran >= 1440 ? 0 : Math.floor(h / gran) * gran;
      let p = out.get(p0);
      if (!p) out.set(p0, p = Object.assign(vazio(), { fimBloco: -1, fiMax: 0, ultH: -1, ultFi: 0 }));
      p.v.of += b.v.of;
      SOMAS.forEach(k => { p.q[k] += b.q[k]; });
      p.q.seNulo = p.q.seNulo || b.q.seNulo;
      p.em = Math.max(p.em, b.em);
      p.fiMax = Math.max(p.fiMax, b.fi);
      if (h > p.ultH) { p.ultH = h; p.ultFi = b.fi; }
      // último retrato: o bloco que FECHA o período (sem linha nele = ninguém esperando)
      const ultimo = p0 + gran - 15;
      if (h === ultimo) { p.fi = b.fi; p.fimBloco = h; }
    }
    for (const [p0, p] of out) {
      if (gran >= 1440) p.fi = p.fiMax;
      else if (ate != null && p0 + gran > ate) p.fi = p.ultFi;
      p.inicio = p0;
      p.rotulo = gran >= 1440 ? 'Dia' : hhmm(p0);
    }
    return [...out.values()].sort((a, b) => a.inicio - b.inicio);
  }

  const razao = (a, b) => b ? a / b : null;
  // acumulador -> indicadores
  function kpis(p) {
    if (!p) return null;
    const q = p.q;
    return {
      of: p.v.of, at: q.at, ab: q.ab, ofCO: q.of,
      ns300: razao(q.a300, q.at) == null ? null : 100 * q.a300 / q.at,
      ns60: razao(q.a60, q.at) == null ? null : 100 * q.a60 / q.at,
      pctAb: razao(q.ab, q.of) == null ? null : 100 * q.ab / q.of,
      tma: razao(q.st, q.at), tme: q.seNulo ? null : razao(q.se, q.at),
      fi: p.fi, em: p.em
    };
  }

  // dia inteiro (ou até `ate`) num acumulador só
  function total(dia, trad, sel, ate) {
    const ps = periodos(blocos(dia, trad, sel, ate), 1440);
    return ps[0] || Object.assign(vazio(), { fiMax: 0 });
  }

  // média de vários dias: soma tudo e divide os volumes pelo número de dias (as razões saem da soma)
  function media(lista) {
    if (!lista.length) return null;
    const m = Object.assign(vazio(), { fiMax: 0 });
    for (const p of lista) {
      m.v.of += p.v.of;
      SOMAS.forEach(k => { m.q[k] += p.q[k]; });
      m.q.seNulo = m.q.seNulo || p.q.seNulo;
      m.fi += p.fi;
      m.em += p.em;
    }
    const n = lista.length;
    m.v.of /= n;
    SOMAS.forEach(k => { m.q[k] /= n; });
    m.fi /= n;
    m.em /= n;
    return m;
  }

  // série de períodos de vários dias -> média por período (mesmo rótulo)
  function mediaPorPeriodo(listas) {
    const por = new Map();
    for (const ps of listas) for (const p of ps) {
      if (!por.has(p.inicio)) por.set(p.inicio, []);
      por.get(p.inicio).push(p);
    }
    const out = new Map();
    for (const [k, ps] of por) {
      // dias sem nenhuma linha naquele período contam como zero
      const comZero = ps.concat(Array(Math.max(0, listas.length - ps.length)).fill(Object.assign(vazio(), { fiMax: 0 })));
      out.set(k, media(comZero));
    }
    return out;
  }

  // grupos do recorte (dia inteiro ou até `ate`), com as skills de cada um
  function grupos(dia, trad, sel, ate) {
    const por = new Map();
    for (const l of (dia && dia.l) || []) {
      const skill = dia.s[l[1]];
      if (!entra(trad, skill, sel)) continue;
      const g = attrs(trad, skill).grupo;
      if (!por.has(g)) por.set(g, new Set());
      por.get(g).add(skill);
    }
    const out = [];
    for (const [g, skills] of por) {
      const k = kpis(total(dia, trad, Object.assign({}, sel, { grupo: g }), ate));
      const sk = [...skills].map(s => ({ skill: s, k: kpis(total(dia, trad, Object.assign({}, sel, { grupo: g, skill: s }), ate)) }))
        .sort((a, b) => b.k.of - a.k.of || a.skill.localeCompare(b.skill));
      out.push({ grupo: g, k, skills: sk });
    }
    return out.sort((a, b) => (a.grupo === 'SEM TRADUÇÃO') - (b.grupo === 'SEM TRADUÇÃO') || b.k.of - a.k.of || a.grupo.localeCompare(b.grupo));
  }

  // os mesmos dias da semana das 7 semanas anteriores que existem no histórico
  function diasReferencia(dia, disponiveis, semanas) {
    const out = [];
    const base = new Date(dia + 'T12:00:00');
    for (let k = 1; k <= (semanas || 7); k++) {
      const d = new Date(base.getTime() - k * 7 * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (disponiveis.includes(iso)) out.push(iso);
    }
    return out;
  }

  // variação em % (null se não dá)
  const variacao = (atual, ref) => (atual == null || ref == null || !ref) ? null : 100 * (atual - ref) / ref;

  // AGORA (última leitura do Pulse): {c:[papéis], l:[[skill, valores]]} -> indicadores do recorte (regras do Pulse)
  function agora(ag, trad, sel) {
    if (!ag || !ag.l) return null;
    const ix = {};
    (ag.c || []).forEach((c, i) => { ix[c] = i + 1; });
    const val = (l, c) => ix[c] == null ? null : l[ix[c]];
    const r = { of: 0, at: 0, ab: 0, at300: 0, ofCO: 0, espera: 0, maisAntiga: 0, logados: null, disponiveis: null,
      tmaN: 0, tmaD: 0, tmeN: 0, tmeD: 0, ewt: null, skills: 0 };
    for (const l of ag.l) {
      const skill = l[0];
      if (!entra(trad, skill, sel)) continue;
      r.skills++;
      r.of += val(l, 'oferecidas') || 0;
      if (!ehCO(trad, attrs(trad, skill))) continue;
      const at = val(l, 'atendidas') || 0, ab = val(l, 'abandono') || 0;
      r.ofCO += val(l, 'oferecidas') || 0;
      r.at += at; r.ab += ab; r.at300 += val(l, 'at300') || 0;
      r.espera += val(l, 'espera') || 0;
      r.maisAntiga = Math.max(r.maisAntiga, val(l, 'mais_antiga') || 0);
      // agentes não se somam entre filas: o maior de uma fila
      const lg = val(l, 'logados'), dp = val(l, 'disponiveis'), ew = val(l, 'ewt');
      if (lg != null) r.logados = Math.max(r.logados || 0, lg);
      if (dp != null) r.disponiveis = Math.max(r.disponiveis || 0, dp);
      if (ew != null && ew !== 10000) r.ewt = Math.max(r.ewt || 0, ew);
      const tma = val(l, 'tma'), tme = val(l, 'tme');
      if (tma != null && at) { r.tmaN += tma * at; r.tmaD += at; }
      if (tme != null && (at + ab)) { r.tmeN += tme * (at + ab); r.tmeD += at + ab; }
    }
    return { of: r.of, at: r.at, ab: r.ab, ofCO: r.ofCO, fila: r.espera, maisAntiga: r.maisAntiga, logados: r.logados,
      disponiveis: r.disponiveis, ewt: r.ewt, skills: r.skills,
      ns300: r.at ? 100 * r.at300 / r.at : null, pctAb: r.ofCO ? 100 * r.ab / r.ofCO : null,
      tma: r.tmaD ? r.tmaN / r.tmaD : null, tme: r.tmeD ? r.tmeN / r.tmeD : null };
  }

  // escala "bonita" do eixo
  function escala(max) {
    if (!(max > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
    return 10 * p;
  }

  // nome curto da skill (sem o "@switch")
  const curto = s => String(s || '').split('@')[0];

  const api = { minutos, hhmm, attrs, entra, blocos, periodos, kpis, total, media, mediaPorPeriodo, grupos,
    diasReferencia, variacao, agora, escala, curto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.URACalc = api;
})(typeof self !== 'undefined' ? self : globalThis);
