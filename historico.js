/* URA · Suporte B2C — histórico (base Genesys) para navegar por dia e comparar pela mediana.
 * Sem DOM; roda também no Node, para os testes.
 *
 * Arquivo historico.csv (exportado do SQL Developer pelo SELECT historico_ura_b2c):
 *   DIA;HORARIO;SKILL;OFERECIDAS;ATENDIDAS;ABANDONADAS;ATEND_60S;ATEND_300S;SOMA_ESPERA_S;SOMA_TMA_S
 *   - separador ";" ou tabulação; DIA "dd/mm/aaaa" ou "aaaa-mm-dd"; HORARIO = início do bloco de 15 min
 *   - uma linha por dia × bloco × skill, só quando houve chamada; somas e contagens (nada de média)
 *
 * Um dia do histórico é convertido para o MESMO formato dos dados do Pulse (Dados.normalizar):
 * leituras acumuladas a cada 15 min, das 08:00 às 21:00. Assim todas as contas e telas do app servem
 * para os dois.
 *
 * Fila (técnicos em espera), calibrada contra o Pulse — duas colunas a mais no MESMO arquivo (um SELECT só):
 *   ...;FILA;ESPERA_MAX_S = quantos esperavam no FIM do bloco (HORARIO + 15) e há quanto tempo o mais antigo.
 *   É o retrato de 15 em 15 min que o Pulse guarda nas horas fechadas: o dia ao vivo e o histórico comparam
 *   a mesma coisa. Coluna vazia no dia inteiro = sem fila naquele dia.
 *   Ainda aceita o formato antigo, em arquivo separado (historico_fila.csv: DIA;MARCA;SKILL;EM_ESPERA;ESPERA_MAX_S).
 *   Sem nenhum dos dois, a fila do dia vem vazia, como antes.
 */
(function (root) {
  'use strict';
  const D = root.Dados || (typeof require !== 'undefined' ? require('./dados.js') : null);
  const COLS = ['DIA', 'HORARIO', 'SKILL', 'OFERECIDAS', 'ATENDIDAS', 'ABANDONADAS', 'ATEND_60S', 'ATEND_300S', 'SOMA_ESPERA_S', 'SOMA_TMA_S'];
  const INICIO = 8 * 60, FIM = 21 * 60, PASSO = 15;
  const pad = n => String(n).padStart(2, '0');

  // "30/10/2026" ou "2026-10-30" → "2026-10-30"
  function isoDe(s) {
    s = String(s || '').trim();
    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  // soma dias a uma data ISO (meio-dia evita problema de horário de verão)
  function somaDias(iso, n) {
    const [a, m, d] = iso.split('-').map(Number);
    const t = new Date(a, m - 1, d, 12); t.setDate(t.getDate() + n);
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  const diaSemana = iso => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d, 12).getDay(); };

  // ---------------------------------------------------------------- leitura do arquivo
  // Lança Error com mensagem em português quando o arquivo não serve.
  function parse(txt) {
    txt = String(txt || '').replace(/^﻿/, '');
    const linhas = txt.split(/\r?\n/);
    while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
    if (linhas.length < 2) throw new Error('arquivo do histórico vazio');
    const sep = linhas[0].includes('\t') ? '\t' : ';';
    const cab = linhas[0].split(sep).map(c => c.trim().toUpperCase().replace(/^"|"$/g, ''));
    const pos = {};
    COLS.forEach(c => { pos[c] = cab.indexOf(c); });
    const faltam = COLS.filter(c => pos[c] < 0);
    if (faltam.length) throw new Error('colunas ausentes no histórico: ' + faltam.join(', '));
    pos.FILA = cab.indexOf('FILA'); pos.ESPERA_MAX_S = cab.indexOf('ESPERA_MAX_S');
    const colsFila = pos.FILA >= 0 && pos.ESPERA_MAX_S >= 0;
    const diasFila = new Set();          // dias com a coluna FILA preenchida
    const dias = new Map();
    let ruins = 0;
    for (let i = 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (!l.trim()) continue;
      const c = l.split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
      const iso = isoDe(c[pos.DIA]);
      const hm = /^(\d{1,2}):(\d{2})$/.exec(c[pos.HORARIO] || '');
      const nums = COLS.slice(3).map(k => Number(c[pos[k]]));
      if (!iso || !hm || !c[pos.SKILL] || nums.some(n => !isFinite(n) || n < 0)) { ruins++; continue; }
      const m = +hm[1] * 60 + +hm[2];
      let fila = null, fmx = null;
      if (colsFila && String(c[pos.FILA] || '').trim() !== '') {
        fila = Number(c[pos.FILA]); fmx = Number(c[pos.ESPERA_MAX_S] || 0);
        if (!isFinite(fila) || fila < 0 || !isFinite(fmx)) { ruins++; continue; }
        diasFila.add(iso);
      }
      if (!dias.has(iso)) dias.set(iso, []);
      dias.get(iso).push({ m, sk: c[pos.SKILL], o: nums[0], a: nums[1], b: nums[2], a60: nums[3], a300: nums[4], esp: nums[5], tma: nums[6], fila, fmx: Math.max(0, fmx || 0) });
    }
    if (!dias.size) throw new Error('nenhuma linha válida no histórico');
    const lista = [...dias.keys()].sort();
    const avisos = [];
    if (ruins) avisos.push(`${ruins} linha(s) do histórico com problema foram ignoradas.`);
    const faltando = [];
    for (let d = lista[0]; d < lista[lista.length - 1]; d = somaDias(d, 1)) if (!dias.has(d)) faltando.push(d);
    if (faltando.length) avisos.push(`${faltando.length} dia(s) sem dados no histórico.`);
    return { dias, lista, inicio: lista[0], fim: lista[lista.length - 1], avisos, cache: new Map(), tradRef: null, colsFila, diasFila };
  }

  // ---------------------------------------------------------------- fila (retratos)
  const COLS_FILA = ['DIA', 'MARCA', 'SKILL', 'EM_ESPERA', 'ESPERA_MAX_S'];
  const ehFila = txt => { const l = String(txt || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toUpperCase(); return l.includes('MARCA') && l.includes('EM_ESPERA'); };
  function parseFila(txt) {
    txt = String(txt || '').replace(/^\uFEFF/, '');
    const linhas = txt.split(/\r?\n/);
    while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
    if (linhas.length < 1) throw new Error('arquivo da fila vazio');
    const sep = linhas[0].includes('\t') ? '\t' : ';';
    const cab = linhas[0].split(sep).map(c => c.trim().toUpperCase().replace(/^"|"$/g, ''));
    const pos = {};
    COLS_FILA.forEach(c => { pos[c] = cab.indexOf(c); });
    const faltam = COLS_FILA.filter(c => pos[c] < 0);
    if (faltam.length) throw new Error('colunas ausentes no arquivo da fila: ' + faltam.join(', '));
    const dias = new Map();
    let ruins = 0, ini = null, fim = null;
    for (let i = 1; i < linhas.length; i++) {
      if (!linhas[i].trim()) continue;
      const c = linhas[i].split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
      const iso = isoDe(c[pos.DIA]), hm = /^(\d{1,2}):(\d{2})$/.exec(c[pos.MARCA] || '');
      const n = Number(c[pos.EM_ESPERA]), mx = Number(c[pos.ESPERA_MAX_S]);
      if (!iso || !hm || !c[pos.SKILL] || !isFinite(n) || n < 0 || !isFinite(mx)) { ruins++; continue; }
      if (!ini || iso < ini) ini = iso;
      if (!fim || iso > fim) fim = iso;
      const m = +hm[1] * 60 + +hm[2];
      if (m % PASSO) continue;                         // só as marcas de 15 min (iguais às do Pulse nas horas fechadas)
      if (!dias.has(iso)) dias.set(iso, new Map());
      const dm = dias.get(iso);
      if (!dm.has(m)) dm.set(m, new Map());
      dm.get(m).set(c[pos.SKILL], [n, Math.max(0, mx)]);
    }
    if (!ini) throw new Error('nenhuma linha válida no arquivo da fila');
    return { dias, inicio: ini, fim, ruins };
  }
  // liga a fila ao histórico (dias já convertidos são refeitos)
  function anexarFila(H, F) { if (!H) return; H.fila = F || null; H.cache.clear(); }
  // o dia tem fila? Colunas no próprio histórico: dia com a coluna preenchida. Arquivo separado: dentro do
  // período dele (dia sem nenhuma linha = ninguém esperou).
  const temFila = (H, iso) => !!H && (H.colsFila ? H.diasFila.has(iso) : !!(H.fila && iso >= H.fila.inicio && iso <= H.fila.fim));

  // ---------------------------------------------------------------- um dia no formato do Pulse
  // trad: tradutora em uso (a do pulse.json). Leitura das HH:MM = tudo que entrou ANTES das HH:MM
  // (blocos que começam até HH:MM − 15). A leitura das 08:00 junta o que entrou de madrugada.
  function diaComoDados(H, iso, trad) {
    if (!H || !H.dias.has(iso)) return null;
    if (H.tradRef !== trad) { H.cache.clear(); H.tradRef = trad; }
    if (H.cache.has(iso)) return H.cache.get(iso);
    const linhas = H.dias.get(iso).slice().sort((x, y) => x.m - y.m);
    const t = {};
    Object.keys(trad || {}).forEach(k => { t[k] = trad[k]; });
    const semTrad = new Set();
    linhas.forEach(r => { if (!t[r.sk]) { semTrad.add(r.sk); t[r.sk] = { SKILL_SIMPLIFICADO: D.curto(r.sk), SKILL_GRUPO: 'SEM TRADUÇÃO', DIRECIONAMENTO: '?' }; } });
    const skills = Object.keys(t).sort();
    const acc = {};
    skills.forEach(s => { acc[s] = { o: 0, a: 0, b: 0, a60: 0, a300: 0, esp: 0, tma: 0 }; });
    const leituras = [];
    const comFila = temFila(H, iso);
    let fd = null;
    if (comFila && H.colsFila) {
      // coluna FILA da linha do bloco HH:MM = retrato da leitura HH:MM + 15
      fd = new Map();
      linhas.forEach(r => { if (r.fila == null) return; const mm = r.m + PASSO; if (!fd.has(mm)) fd.set(mm, new Map()); fd.get(mm).set(r.sk, [r.fila, r.fmx]); });
    } else if (comFila) fd = H.fila.dias.get(iso) || new Map();
    let i = 0;
    for (let m = INICIO; m <= FIM; m += PASSO) {
      while (i < linhas.length && linhas[i].m + PASSO <= m) {
        const r = linhas[i++], x = acc[r.sk];
        x.o += r.o; x.a += r.a; x.b += r.b; x.a60 += r.a60; x.a300 += r.a300; x.esp += r.esp; x.tma += r.tma;
      }
      const v = {}, fm = fd ? fd.get(m) : null;
      skills.forEach(s => {
        const x = acc[s], f = fm ? fm.get(s) : null;
        v[s] = {
          Distinct_Entered: x.o, Answered: x.a, Abandoned: x.b, Answered_less_60s: x.a60, Answered_less_300s: x.a300,
          Average_Wait_Time: x.a ? x.esp / x.a : 0, Average_Handle_Time: x.a ? x.tma / x.a : 0,
          // fila: retrato da marca (arquivo historico_fila); sem o arquivo, vazia. Agentes: o histórico não tem
          Current_Calls: comFila ? (f ? f[0] : 0) : null, Curr_Max_Wait_Time: comFila ? (f ? f[1] : 0) : null,
          Current_Logged_In: null, Current_Ready: null, EWT: null, Wait_Time: null
        };
      });
      leituras.push({ m, horario: D.hhmm(m), col: null, dist: 0, origem: 'historico', v });
    }
    const avisos = semTrad.size ? [`${semTrad.size} skill(s) do histórico sem tradução neste dia.`] : [];
    const d = { dia: iso, guid: '', trad: t, skills, leituras, avisos, descartadas: 0, metricas: [], historico: true, temFila: comFila };
    H.cache.set(iso, d);
    return d;
  }

  // ---------------------------------------------------------------- referências e mediana
  // 'sem': os 7 mesmos dias da semana anteriores (D−7, D−14 … D−49)
  // 'dias': os 7 dias corridos anteriores (D−1 … D−7)
  // Só entram as datas que existem no histórico.
  function referencias(H, iso, tipo, n) {
    n = n || 7;
    const out = [];
    for (let k = 1; k <= n; k++) {
      const r = somaDias(iso, tipo === 'sem' ? -7 * k : -k);
      if (H && H.dias.has(r)) out.push(r);
    }
    return out;
  }
  function mediana(arr) {
    const v = arr.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const h = Math.floor(v.length / 2);
    return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  }

  const api = { COLS, COLS_FILA, isoDe, somaDias, diaSemana, parse, ehFila, parseFila, anexarFila, temFila, diaComoDados, referencias, mediana };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Historico = api;
})(typeof self !== 'undefined' ? self : this);
