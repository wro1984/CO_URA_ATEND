/* URA · Suporte B2C — leitura e contas dos dados do Pulse (sem DOM; roda também no Node, para os testes).
 *
 * Formato do JSON (gerado pela coleta do MAPI, um arquivo por dia):
 *   { dia:"2026-10-30",
 *     metricas:[{id:"Current_Calls",label,formato}, …],          ← a ORDEM dos valores de cada skill
 *     skills:{ "VQ_…@SW_SIPS_VQ": {SKILL_GRUPO, DIRECIONAMENTO, …} },  ← tradutora embutida
 *     leituras:[{horario:"08:15", coletado_em:"2026-10-30 08:13:05", origem, valores:{ "VQ_…": [n, n, …] }}] }
 *
 * Regras:
 *  - `horario` é o slot agendado e o eixo dos gráficos; `coletado_em` só desempata quando um slot vem repetido
 *    (fica a coleta mais perto do horário do slot).
 *  - Os contadores (oferecidas, atendidas, abandono, atendidas < 300s, tempo de espera) são ACUMULADOS do dia:
 *    o volume de um intervalo é o valor do fim menos o do início.
 *  - Os valores são lidos pelo id da métrica (nunca pela posição fixa): se a coleta mudar a ordem, nada quebra.
 *  - NS = atendidas < 300s ÷ oferecidas (regra do Pulse). TMA/TME de um grupo = média ponderada pelas atendidas.
 *  - Agentes são compartilhados entre skills: nunca somar; usar o maior valor de uma skill.
 */
(function (root) {
  'use strict';

  const OBRIGATORIAS = ['Current_Calls', 'Curr_Max_Wait_Time', 'Current_Logged_In', 'Current_Ready', 'Distinct_Entered',
    'Answered', 'Average_Handle_Time', 'Average_Wait_Time', 'Answered_less_300s', 'Abandoned'];
  const OPCIONAIS = ['EWT', 'Answered_less_60s', 'Wait_Time'];
  const EWT_SEM_AGENTE = 10000;
  const INICIO = 8 * 60, FIM = 21 * 60;          // expediente 08:00–21:00
  const PASSOS = [15, 30, 60, 120];

  const pad = n => String(n).padStart(2, '0');
  const minDe = h => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
  const hhmm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  // "2026-10-30 08:13:05" (ou com T) → ms no horário local
  function msDe(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() : null;
  }
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;

  // ---------------------------------------------------------------- leitura e validação
  // Lança Error com mensagem em português quando o arquivo não serve. O app mantém os últimos dados válidos.
  function normalizar(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('arquivo vazio ou não é JSON');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.dia || ''))) throw new Error('campo "dia" ausente ou inválido');
    if (!Array.isArray(raw.metricas) || !raw.metricas.length) throw new Error('lista "metricas" ausente');
    if (!Array.isArray(raw.leituras)) throw new Error('lista "leituras" ausente');
    const ids = raw.metricas.map(m => m && m.id);
    const pos = {};
    ids.forEach((id, i) => { if (id && pos[id] == null) pos[id] = i; });
    const faltam = OBRIGATORIAS.filter(id => pos[id] == null);
    if (faltam.length) throw new Error('métricas obrigatórias ausentes: ' + faltam.join(', '));
    const avisos = [];
    const faltamOpc = OPCIONAIS.filter(id => pos[id] == null);
    if (faltamOpc.length) avisos.push('Métricas não enviadas (ficam em branco): ' + faltamOpc.join(', ') + '.');

    const trad = {};
    const skillsRaw = raw.skills && typeof raw.skills === 'object' ? raw.skills : {};
    Object.keys(skillsRaw).forEach(k => { trad[k] = Object.assign({}, skillsRaw[k]); });

    // slots: um por horário; repetido → a coleta mais perto do horário do slot
    const [ano, mes, dia] = raw.dia.split('-').map(Number);
    const porSlot = new Map();
    let descartadas = 0, invalidas = 0;
    raw.leituras.forEach(l => {
      const m = minDe(l && l.horario);
      if (m == null || !l.valores || typeof l.valores !== 'object') { invalidas++; return; }
      const slotMs = new Date(ano, mes - 1, dia, Math.floor(m / 60), m % 60).getTime();
      const col = msDe(l.coletado_em);
      const dist = col == null ? Infinity : Math.abs(col - slotMs);
      const atual = porSlot.get(m);
      if (atual) { descartadas++; if (dist >= atual.dist) return; }
      porSlot.set(m, { m, horario: hhmm(m), col, dist, origem: l.origem || '', valores: l.valores });
    });
    if (invalidas) avisos.push(`${invalidas} leitura(s) sem horário ou sem valores foram ignoradas.`);
    const leituras = [...porSlot.values()].sort((a, b) => a.m - b.m);
    if (!leituras.length) throw new Error('nenhuma leitura válida no arquivo');

    // todas as skills que aparecem; sem tradução → grupo "SEM TRADUÇÃO" e aviso
    const nomes = new Set(Object.keys(trad));
    leituras.forEach(l => Object.keys(l.valores).forEach(k => nomes.add(k)));
    const semTrad = [];
    nomes.forEach(k => {
      if (!trad[k] || !trad[k].DIRECIONAMENTO) {
        semTrad.push(k);
        trad[k] = Object.assign({ SKILL_SIMPLIFICADO: curto(k), SKILL_GRUPO: 'SEM TRADUÇÃO', DIRECIONAMENTO: '?' }, trad[k] || {});
      }
      if (!trad[k].SKILL_SIMPLIFICADO) trad[k].SKILL_SIMPLIFICADO = curto(k);
      if (!trad[k].SKILL_GRUPO) trad[k].SKILL_GRUPO = 'SEM GRUPO';
    });
    if (semTrad.length) avisos.push(`${semTrad.length} skill(s) sem tradução (aparecem como "SEM TRADUÇÃO"): ${semTrad.map(curto).join(', ')}.`);

    // valores numéricos por skill; skill ausente numa leitura repete a anterior (contador não pode "voltar")
    const lista = [...nomes].sort();
    let repetidas = 0, ruins = 0;
    const ultimo = {};
    leituras.forEach(l => {
      const v = {};
      lista.forEach(k => {
        const arr = l.valores[k];
        if (!Array.isArray(arr)) { if (ultimo[k]) { v[k] = ultimo[k]; repetidas++; } return; }
        const o = {};
        Object.keys(pos).forEach(id => { const x = num(arr[pos[id]]); if (x == null && arr[pos[id]] != null) ruins++; o[id] = x; });
        v[k] = o; ultimo[k] = o;
      });
      l.v = v;
      delete l.valores;
    });
    if (repetidas) avisos.push(`${repetidas} valor(es) de skill ausentes numa leitura foram repetidos da leitura anterior.`);
    if (ruins) avisos.push(`${ruins} valor(es) não numéricos foram tratados como vazios.`);

    return { dia: raw.dia, guid: raw.guid || '', trad, skills: lista, leituras, avisos, descartadas,
      metricas: raw.metricas.map(m => ({ id: m.id, label: m.label || m.id, formato: m.formato || '' })) };
  }
  // "VQ_COE_EXEMPLO_SUP_V1@SW_TESTE" → "EXEMPLO_SUP_V1"
  const curto = k => String(k).replace(/@.*$/, '').replace(/^VQ_COE_/, '');

  // ---------------------------------------------------------------- filtros
  // f: {dir:'CO'|'TEL'|'TODOS', grupo:null|'…', skill:null|'nome'}
  function filtro(d, f) {
    f = f || {};
    return d.skills.filter(k => {
      const t = d.trad[k];
      if (f.skill) return k === f.skill;
      if (f.dir && f.dir !== 'TODOS' && t.DIRECIONAMENTO !== f.dir) return false;
      if (f.grupo && t.SKILL_GRUPO !== f.grupo) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------- agregação de uma leitura
  function agregar(l, skills) {
    const a = { m: l ? l.m : null, ofer: 0, atend: 0, aband: 0, a300: 0, a60: 0, tmaS: 0, tmeS: 0, espTot: 0,
      fila: 0, espMax: 0, agMax: 0, dispMax: 0, nSkills: 0, temA60: false, temEsp: false };
    if (!l) return a;
    skills.forEach(k => {
      const v = l.v[k]; if (!v) return;
      a.nSkills++;
      const at = v.Answered || 0;
      a.ofer += v.Distinct_Entered || 0;
      a.atend += at;
      a.aband += v.Abandoned || 0;
      a.a300 += v.Answered_less_300s || 0;
      if (v.Answered_less_60s != null) { a.a60 += v.Answered_less_60s; a.temA60 = true; }
      a.tmaS += (v.Average_Handle_Time || 0) * at;
      a.tmeS += (v.Average_Wait_Time || 0) * at;
      if (v.Wait_Time != null) { a.espTot += v.Wait_Time; a.temEsp = true; }
      a.fila += v.Current_Calls || 0;
      a.espMax = Math.max(a.espMax, v.Curr_Max_Wait_Time || 0);
      a.agMax = Math.max(a.agMax, v.Current_Logged_In || 0);
      a.dispMax = Math.max(a.dispMax, v.Current_Ready || 0);
    });
    return derivar(a);
  }
  function derivar(a) {
    a.ns = a.ofer > 0 ? a.a300 / a.ofer * 100 : null;
    a.abandPct = a.ofer > 0 ? a.aband / a.ofer * 100 : null;
    a.tma = a.atend > 0 ? Math.max(0, a.tmaS / a.atend) : null;
    a.tme = a.atend > 0 ? Math.max(0, a.tmeS / a.atend) : null;
    // atendidos "direto": em até 1 min, entre as atendidas (sem métrica de 60s no arquivo: null)
    a.dir60 = a.atend > 0 && a.temA60 ? Math.min(100, a.a60 / a.atend * 100) : null;
    return a;
  }
  // Acumulado do dia num minuto qualquer, interpolando entre as duas leituras em volta (proporcional ao tempo).
  // Serve para o histórico (leituras de 15 em 15 min) comparar com a coleta do Pulse no meio de um bloco:
  // 19:20 = leitura das 19:15 + 1/3 do que entrou entre 19:15 e 19:30. Os retratos (fila, agentes) não se interpolam.
  const SOMAS = ['ofer', 'atend', 'aband', 'a300', 'a60', 'tmaS', 'tmeS', 'espTot'];
  function agregarEm(d, m, skills) {
    const ls = d.leituras;
    let ant = null, pos = null;
    for (const l of ls) { if (l.m <= m) ant = l; if (l.m >= m && !pos) pos = l; }
    if (!ant) return agregar(null, skills);
    if (!pos || pos === ant || ant.m === m) { const a = agregar(ant, skills); a.m = m; return a; }
    const A = agregar(ant, skills), B = agregar(pos, skills), f = (m - ant.m) / (pos.m - ant.m);
    const r = Object.assign({}, A, { m });
    SOMAS.forEach(k => { r[k] = A[k] + (B[k] - A[k]) * f; });
    return derivar(r);
  }
  // um intervalo qualquer [ini, fim] com a mesma regra (volumes = fim − início; NS e abandono ÷ finalizadas)
  const intervaloEm = (d, ini, fim, skills) => delta(agregarEm(d, fim, skills), agregarEm(d, ini, skills));

  // diferença entre dois acumulados (fim − início); os instantâneos (fila, espera máx., agentes) são os do fim
  function delta(fim, ini) {
    const d = { ofer: fim.ofer - ini.ofer, atend: fim.atend - ini.atend, aband: fim.aband - ini.aband,
      a300: fim.a300 - ini.a300, a60: fim.a60 - ini.a60, tmaS: fim.tmaS - ini.tmaS, tmeS: fim.tmeS - ini.tmeS,
      espTot: fim.espTot - ini.espTot, fila: fim.fila, espMax: fim.espMax, agMax: fim.agMax, dispMax: fim.dispMax,
      temA60: fim.temA60, temEsp: fim.temEsp };
    // contador que diminuiu = virada/reinício na origem: não inventa negativo
    d.negativo = ['ofer', 'atend', 'aband', 'a300'].some(k => d[k] < 0);
    ['ofer', 'atend', 'aband', 'a300', 'a60', 'espTot'].forEach(k => { if (d[k] < 0) d[k] = 0; });
    derivar(d);
    // No intervalo, a base do NS e do abandono são as chamadas FINALIZADAS nele (atendidas + abandonadas):
    // uma chamada pode entrar num intervalo e ser atendida no seguinte, e dividir pelas oferecidas passaria de 100%.
    // (No acumulado do dia continua a regra do Pulse: ÷ oferecidas.)
    d.fin = d.atend + d.aband;
    d.ns = d.fin > 0 ? Math.min(100, d.a300 / d.fin * 100) : null;
    d.abandPct = d.fin > 0 ? d.aband / d.fin * 100 : null;
    return d;
  }

  // ---------------------------------------------------------------- intervalos (eixo X)
  // passo em minutos; desde/ate em minutos do dia (padrão: 08:00 até a última leitura)
  function intervalos(d, passo, skills, opt) {
    opt = opt || {};
    const ls = d.leituras;
    const ultima = ls[ls.length - 1];
    const porM = new Map(ls.map(l => [l.m, l]));
    const desde = opt.desde != null ? opt.desde : INICIO;
    const ate = ultima.m;
    const out = [];
    // base: leitura no início; sem ela, a última leitura antes; sem nenhuma, zero (inclui o acumulado anterior)
    let baseL = porM.get(desde) || [...ls].reverse().find(l => l.m < desde) || null;
    let base = agregar(baseL, skills);
    let baseZero = !baseL;
    for (let s = desde; s < ate && s < FIM; s += passo) {
      const e = s + passo;
      let fimL = porM.get(e), andamento = false;
      if (!fimL && e > ate) { fimL = ultima; andamento = true; }
      const it = { ini: s, fim: e, rot: hhmm(s), andamento, ateM: fimL ? fimL.m : null };
      it.esp = esperaNoIntervalo(ls, s, fimL ? fimL.m : e, skills);
      if (!fimL) { it.semColeta = true; out.push(it); continue; }
      const fimA = agregar(fimL, skills);
      it.v = delta(fimA, base);
      it.juntaAnterior = baseL ? baseL.m < s : false;          // houve slot sem coleta antes: volume dos dois juntos
      it.incluiAntes = baseZero;                              // primeiro intervalo sem leitura no início
      it.baseM = baseL ? baseL.m : null;
      out.push(it);
      base = fimA; baseL = fimL; baseZero = false;
    }
    return out;
  }
  // Técnicos em espera (fila) num intervalo. A fila é um RETRATO de cada coleta, não um contador: as chamadas em
  // espera podem ser somadas entre as skills (cada chamada está numa fila só), mas não ao longo do tempo.
  // Por intervalo vale o PICO: o maior número de técnicos esperando ao mesmo tempo nas coletas do intervalo
  // (de ini, exclusive, até fim, inclusive — o retrato do fim do intervalo pertence a ele).
  // Horas fechadas têm uma coleta a cada 15 min; a hora atual, uma a cada 5.
  function esperaNoIntervalo(ls, ini, fim, skills) {
    const r = { n: 0, pico: 0, picoM: null, espMax: 0, espMaxM: null, comFila: 0 };
    ls.forEach(l => {
      if (l.m <= ini || l.m > fim) return;
      let fila = 0, mx = 0, tem = false;
      skills.forEach(k => { const v = l.v[k]; if (!v || v.Current_Calls == null) return; tem = true; fila += v.Current_Calls || 0; mx = Math.max(mx, v.Curr_Max_Wait_Time || 0); });
      if (!tem) return;   // leitura sem fila (ex.: dia do histórico): não conta como coleta
      r.n++;
      if (fila > 0) r.comFila++;
      if (fila > r.pico || r.picoM == null) { r.pico = fila; r.picoM = l.m; }
      if (mx > r.espMax || r.espMaxM == null) { r.espMax = mx; r.espMaxM = l.m; }
    });
    return r.n ? r : null;
  }

  // Modo ACUMULADO: mesmas colunas dos intervalos, mas cada uma com o total do dia até o FIM dela
  // (a leitura de ateM, agregada: NS e abandono ÷ oferecidas, como no Pulse). Para a fila, que é retrato,
  // o acumulado é a MAIOR fila do dia até ali. Coluna sem coleta continua sem coleta.
  function acumulados(d, iv, skills) {
    const porM = new Map(d.leituras.map(l => [l.m, l]));
    let pico = null;
    return iv.map(c => {
      const o = Object.assign({}, c, { acum: true, juntaAnterior: false, incluiAntes: false });
      if (c.esp) {
        if (!pico) pico = Object.assign({}, c.esp);
        else {
          const p = Object.assign({}, pico);
          p.n += c.esp.n; p.comFila += c.esp.comFila;
          if (c.esp.pico > p.pico) { p.pico = c.esp.pico; p.picoM = c.esp.picoM; }
          if (c.esp.espMax > p.espMax) { p.espMax = c.esp.espMax; p.espMaxM = c.esp.espMaxM; }
          pico = p;
        }
      }
      o.esp = pico ? Object.assign({}, pico) : null;
      if (c.v) { const l = porM.get(c.ateM); o.v = l ? agregar(l, skills) : null; if (!o.v) o.semColeta = true; }
      return o;
    });
  }

  // modo automático: o menor passo cujo número de colunas cabe na tela
  function passoAuto(d, maxCol) {
    const ate = d.leituras[d.leituras.length - 1].m;
    const span = Math.max(1, Math.min(ate, FIM) - INICIO);
    for (const p of PASSOS) if (Math.ceil(span / p) <= maxCol) return p;
    return PASSOS[PASSOS.length - 1];
  }

  // ---------------------------------------------------------------- formatação (pt-BR)
  const fmtInt = n => n == null ? '—' : Math.round(n).toLocaleString('pt-BR');
  const fmtPct = (p, c) => p == null ? '—' : p.toLocaleString('pt-BR', { minimumFractionDigits: c == null ? 1 : c, maximumFractionDigits: c == null ? 1 : c }) + '%';
  // segundos → "45s", "4min 05s", "1h 02min"
  function fmtSeg(s) {
    if (s == null) return '—';
    s = Math.round(s);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'min ' + pad(s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + pad(Math.floor(s % 3600 / 60)) + 'min';
  }
  const fmtRel = s => s == null ? '—' : pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(Math.round(s % 60));

  const api = { OBRIGATORIAS, EWT_SEM_AGENTE, INICIO, FIM, PASSOS, normalizar, filtro, agregar, delta, intervalos,
    passoAuto, acumulados, derivar, agregarEm, intervaloEm, espera: esperaNoIntervalo, curto, minDe, hhmm, msDe, fmtInt, fmtPct, fmtSeg, fmtRel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Dados = api;
})(typeof self !== 'undefined' ? self : this);
