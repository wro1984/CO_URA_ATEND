/* URA · Suporte B2C — regras dos alarmes (página Alarmes).
 * Regras puras: recebem os números já calculados pelo app (m) e devolvem a lista de verificações de UMA visão:
 *   'agora' = a hora aberta (de HH:00 até a última coleta; na virada da hora, a hora anterior)
 *   'dia'   = o dia até a última coleta
 * Os dois lados comparam com o previsto (mediana dos dias de comparação no MESMO trecho do dia).
 * Os limites ficam todos em LIM (um bloco por visão), num lugar só, para ajustar depois.
 *
 * Cada verificação: { id, tipo, nivel: 'crit'|'aten'|'ok'|'na', titulo ('Nome · status'), status (curto), det (HTML), valor, valorSub, tag, regra,
 *   onde (HTML ou ''), alvo: { ch, dir, grupo } | null }  — 'na' = sem dado para avaliar (ex.: poucas chamadas).
 */
(function (raiz, fab) {
  if (typeof module !== 'undefined' && module.exports) module.exports = fab(require('./dados.js'));
  else raiz.Alarmes = fab(raiz.Dados);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  // ---------------------------------------------------------------- limites (modelo inicial, para ajustar)
  // %: diferença para o previsto · p.p.: pontos percentuais · minFin: mínimo de chamadas finalizadas (CO) no trecho
  const LIM = {
    agora: {
      ns: { aten: 90, crit: 70, minFin: 15 },
      vol: { atenMais: 25, critMais: 50, atenMenos: -30, critMenos: -50, minPrev: 20 },
      aband: { atenExc: 3, critExc: 6, atenPct: 20, critPct: 40, minFin: 15 },       // abandonos A MAIS que o previsto
      fila: { aten: 120, crit: 300, filaCrit: 15, acima: 3, raros: 1 },             // espera (s), fila; e fila fora do comum
      agentes: {},
      tme: { aten: 25, crit: 50, minDif: 60, minFin: 15 },
      tma: { aten: 25, crit: 50, minDif: 30, minFin: 15 },
      direto: { aten: -10, crit: -20, minFin: 15 },
      grupos: { aten: 50, crit: 100, minPrev: 10 },
      parada: { minPrev: 5 },
      tel: { aten: 10, crit: 20, minOfer: 20 },
      coleta: { aten: 10, crit: 20 }
    },
    dia: {
      ns: { aten: 90, crit: 70, minFin: 20 },
      vol: { atenMais: 15, critMais: 30, atenMenos: -20, critMenos: -35, minPrev: 100 },
      aband: { aten: 20, crit: 40, pctCrit: 10, minPrev: 10, minFin: 20 },
      fila: { aten: 50, crit: 100, minDif: 5 },                                       // pico do dia × mediana dos picos
      agentes: {},
      tme: { aten: 25, crit: 50, minDif: 30, minFin: 20 },
      tma: { aten: 25, crit: 50, minDif: 30, minFin: 20 },
      direto: { aten: -10, crit: -20, minFin: 20 },
      grupos: { aten: 30, crit: 60, minPrev: 50 },
      parada: { minPrev: 5 },
      tel: { aten: 10, crit: 20, minOfer: 100 },
      coleta: { aten: 10, crit: 20 }
    }
  };
  // tipos de alarme (a configuração liga/desliga por tipo, em cada visão)
  const TIPOS = [
    { id: 'ns', nome: 'NS', desc: 'nível de serviço (atendidas em até 5 min) do CO' },
    { id: 'vol', nome: 'Oferecidas', desc: 'oferecidas da URA contra o previsto' },
    { id: 'aband', nome: 'Abandonadas', desc: 'abandonadas do CO contra o previsto' },
    { id: 'fila', nome: 'Em espera', desc: 'técnicos esperando: espera longa, fila grande ou fora do comum' },
    { id: 'agentes', nome: 'Em espera sem agente', desc: 'skill com espera e nenhum agente disponível' },
    { id: 'tme', nome: 'TME', desc: 'tempo médio de espera do CO' },
    { id: 'tma', nome: 'TMA', desc: 'tempo médio de atendimento do CO' },
    { id: 'direto', nome: 'Atendidos direto', desc: 'atendidas em até 1 min (CO)' },
    { id: 'grupos', nome: 'Grupos', desc: 'grupo com volume bem acima do previsto' },
    { id: 'parada', nome: 'Skills sem chamadas', desc: 'skill sem nenhuma chamada na última hora' },
    { id: 'tel', nome: 'CO/TEL', desc: 'parte das chamadas indo para a TEL' },
    { id: 'coleta', nome: 'Coleta', desc: 'coleta do Pulse atrasada' }
  ];
  const NOME = Object.fromEntries(TIPOS.map(t => [t.id, t.nome]));

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fI = D.fmtInt, fP = D.fmtPct, fS = D.fmtSeg;
  const sinal = x => (x > 0 ? '+' : x < 0 ? '−' : '±');
  const pctTx = x => sinal(x) + Math.abs(Math.round(x)) + '%';
  const ppTx = x => sinal(x) + Math.abs(x).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const dif = (v, r) => (v == null || r == null || !r) ? null : (v - r) / r * 100;
  const ondeTx = l => l && l.length ? l.slice(0, 3).map(x => `<b>${esc(x.nome)}</b> ${esc(x.tx)}`).join(' · ') : '';
  const espTx = s => s >= 60 ? Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') : Math.round(s) + 's';
  const n = (x, um, varios) => fI(x) + ' ' + (x === 1 ? um : varios);

  function verif(tipo, tag, alvo) { return { id: tipo, tipo, tag, alvo, nivel: 'na', titulo: NOME[tipo], status: '', det: '', valor: '', valorSub: '', regra: '', onde: '', atual: '', ref: '' }; }

  // m: { horario, cmpNome, vivo, atrasoMin,
  //   agora|dia: { ini, ate, fecha, ofer, oferPrev, oferPrevHora,
  //     co: { ofer, fin, a300, ns, aband, abandPct, tme, tma, dir60 }, prev: { ns, aband, tme, tma, dir60 },
  //     telPct, telPctPrev, filaPico, filaPicoPrev, filaDiasRef, filaRefs,
  //     grupos: [{ g, dir, v, prev }] | null, onde: { ns, aband, vol, fila: [{nome, tx}] } },
  //   fila: { total, espMax, skillMax, semAgente: [nomes] }, paradas: [{ nome, dir, prev }] | null }
  function avaliar(m, vista, lim) {
    vista = vista === 'dia' ? 'dia' : 'agora';
    const Lm = (lim || LIM)[vista], hr = vista === 'agora';
    const P = m[vista] || {}, co = P.co || {}, pv = P.prev || {}, onde = P.onde || {}, fila = m.fila || {};
    const cmp = m.cmpNome ? ` · med. ${esc(m.cmpNome)}: ` : null;
    const med = tx => cmp ? cmp + tx : '';
    const per = hr ? (P.ini != null ? `${D.hhmm(P.ini)}–${D.hhmm(P.ate)}` : 'na hora') : 'no dia';
    const naPer = hr ? 'na hora' : 'no dia';
    const daPer = hr ? 'da hora' : 'do dia';
    const finOk = x => co.fin != null && co.fin >= x;
    const out = [];

    // 1) NS
    let v = verif('ns', 'CO', { ch: 'ns', dir: 'CO' });
    const N = Lm.ns;
    v.regra = `NS ${daPer} (CO) abaixo de ${N.aten}% = em atenção; abaixo de ${N.crit}% = crítico (a partir de ${N.minFin} chamadas finalizadas).`;
    if (co.ns != null && finOk(N.minFin)) {
      v.nivel = co.ns < N.crit ? 'crit' : co.ns < N.aten ? 'aten' : 'ok';
      v.status = v.nivel === 'crit' ? `abaixo de ${N.crit}% ${naPer}` : `abaixo da meta ${naPer}`;
      v.det = (hr ? `${per}: <b>${fI(co.a300)}</b> de ${fI(co.fin)} finalizadas em até 5 min` : `NS <b>${fP(co.ns)}</b> · meta ${N.aten}%`) + (pv.ns != null ? med(fP(pv.ns)) : '');
      v.valor = fP(co.ns); v.valorSub = naPer;
      v.atual = fP(co.ns); v.ref = `meta ${N.aten}%` + (pv.ns != null ? ` · med. ${fP(pv.ns)}` : '');
      v.onde = ondeTx(onde.ns);
    }
    out.push(v);

    // 2) volume (URA) contra o previsto do mesmo trecho
    v = verif('vol', 'URA', { ch: 'of', dir: 'TODOS' });
    const V = Lm.vol;
    v.regra = `Oferecidas ${daPer} (URA) contra o previsto ${hr ? 'até o mesmo minuto' : 'até o mesmo horário'}: ${V.atenMais}% acima ou ${-V.atenMenos}% abaixo = em atenção; ${V.critMais}% acima ou ${-V.critMenos}% abaixo = crítico (previsto de ${V.minPrev} ou mais).`;
    const dv = P.oferPrev >= V.minPrev ? dif(P.ofer, P.oferPrev) : null;
    if (dv != null) {
      v.nivel = dv >= V.critMais || dv <= V.critMenos ? 'crit' : dv >= V.atenMais || dv <= V.atenMenos ? 'aten' : 'ok';
      v.status = `${dv >= 0 ? 'acima' : 'abaixo'} do previsto ${naPer}`;
      v.det = `${hr ? per + ': ' : ''}<b>${fI(P.ofer)}</b> oferecidas${hr ? '' : ' no dia'} · previsto ${fI(P.oferPrev)}` + (hr && !P.fecha && P.oferPrevHora != null ? ` (hora inteira: ${fI(P.oferPrevHora)})` : '');
      v.valor = pctTx(dv); v.valorSub = naPer;
      v.atual = fI(P.ofer); v.ref = `previsto ${fI(P.oferPrev)} (${pctTx(dv)})`;
      v.onde = ondeTx(onde.vol);
    }
    out.push(v);

    // 3) abandono (CO)
    v = verif('aband', 'CO', { ch: 'ab', dir: 'CO' });
    const A = Lm.aband;
    if (hr) {
      // na hora o normal costuma ser 0 ou poucos: conta os abandonos A MAIS que o previsto
      v.regra = `Abandonadas da hora (CO) a mais que o previsto: ${A.atenExc} ou mais = em atenção; ${A.critExc} ou mais = crítico (quando o previsto passa de zero, também precisa estar ${A.atenPct}% / ${A.critPct}% acima). Avalia a partir de ${A.minFin} finalizadas.`;
      if (pv.aband != null && co.aband != null && finOk(A.minFin)) {
        const exc = co.aband - pv.aband, d = pv.aband > 0 ? exc / pv.aband * 100 : Infinity;
        v.nivel = exc >= A.critExc && d >= A.critPct ? 'crit' : exc >= A.atenExc && d >= A.atenPct ? 'aten' : 'ok';
        v.status = 'acima do normal na hora';
        v.det = `${per}: <b>${fI(co.aband)}</b> abandonadas (${fP(co.abandPct)})` + med(fI(Math.round(pv.aband * 10) / 10));
        v.valor = sinal(Math.round(exc)) + fI(Math.abs(Math.round(exc))); v.valorSub = 'a mais';
        v.atual = fI(co.aband); v.ref = `med. ${fI(Math.round(pv.aband * 10) / 10)}`;
        v.onde = ondeTx(onde.aband);
      }
    } else {
      v.regra = `Abandonadas do dia (CO) contra o previsto até o mesmo horário: ${A.aten}% acima = em atenção; ${A.crit}% acima ou abandono de ${A.pctCrit}% das oferecidas ou mais = crítico.`;
      const da = pv.aband >= A.minPrev ? dif(co.aband, pv.aband) : null;
      const pctAlto = co.abandPct != null && co.ofer >= A.minFin && co.abandPct >= A.pctCrit;
      if (da != null || (co.abandPct != null && co.ofer >= A.minFin)) {
        v.nivel = pctAlto || (da != null && da >= A.crit) ? 'crit' : da != null && da >= A.aten ? 'aten' : 'ok';
        v.status = pctAlto && !(da != null && da >= A.aten) ? `${A.pctCrit}% ou mais das oferecidas` : 'acima do normal no dia';
        v.det = `<b>${fI(co.aband)}</b> abandonadas no dia (${fP(co.abandPct)})` + (pv.aband != null ? med(fI(pv.aband)) : '');
        v.valor = da != null ? pctTx(da) : fP(co.abandPct); v.valorSub = da != null ? 'vs. normal' : 'das oferecidas';
        v.atual = fI(co.aband); v.ref = (pv.aband != null ? `med. ${fI(pv.aband)} · ` : '') + `${fP(co.abandPct)} das oferecidas`;
        v.onde = ondeTx(onde.aband);
      }
    }
    out.push(v);

    // 4) fila (CO)
    v = verif('fila', 'CO', { ch: 'esp', dir: 'CO' });
    const F = Lm.fila;
    if (hr) {
      v.regra = `Agora: chamada mais antiga na fila com ${fS(F.aten)} ou mais = em atenção; ${fS(F.crit)} ou mais, ou ${F.filaCrit} técnicos esperando = crítico. ` +
        `Fora do comum: maior fila da hora ${F.acima} acima da mediana do horário, ou alguém esperando num horário em que no máximo ${F.raros} dos dias de comparação teve fila = em atenção.`;
      if (fila.total != null) {
        const nEsp = fila.espMax >= F.crit || fila.total >= F.filaCrit ? 'crit' : fila.espMax >= F.aten ? 'aten' : 'ok';
        const pico = P.filaPico || 0, pMed = P.filaPicoPrev;
        const incomum = pMed != null && pico > 0 && (pico >= pMed + F.acima || (pMed === 0 && P.filaDiasRef != null && P.filaDiasRef <= F.raros));
        v.nivel = nEsp !== 'ok' ? nEsp : incomum ? 'aten' : 'ok';
        v.status = nEsp === 'crit' && fila.total >= F.filaCrit && fila.espMax < F.crit ? 'fila grande' : nEsp !== 'ok' ? 'espera longa' : 'fora do comum para o horário';
        v.det = fila.total ? `<b>${n(fila.total, 'técnico esperando', 'técnicos esperando')}</b> · mais antiga <b>${fS(fila.espMax)}</b>` + (fila.skillMax ? ` · ${esc(fila.skillMax)}` : '') : `ninguém esperando agora · maior fila ${per}: <b>${fI(pico)}</b>`;
        if (incomum && pMed != null) v.det += ` · normal neste horário: ${fI(pMed)}` + (P.filaRefs ? ` (fila em ${P.filaDiasRef} de ${P.filaRefs} dias)` : '');
        v.valor = fila.total ? espTx(fila.espMax) : fI(pico); v.valorSub = fila.total ? 'espera' : 'maior fila';
        v.atual = fila.total ? n(fila.total, 'esperando', 'esperando') : '0'; v.ref = fila.total ? `mais antiga ${fS(fila.espMax)} (limite ${fS(F.aten)})` : `maior fila ${naPer}: ${fI(pico)}` + (pMed != null ? ` · med. ${fI(pMed)}` : '');
        v.onde = ondeTx(onde.fila);
      }
    } else {
      v.regra = `Maior fila do dia (CO) contra a mediana das maiores filas até o mesmo horário: ${F.aten}% acima = em atenção; ${F.crit}% acima = crítico (só com ${F.minDif} técnicos ou mais de diferença).`;
      if (P.filaPico != null && P.filaPicoPrev != null) {
        const x = P.filaPico - P.filaPicoPrev, d = P.filaPicoPrev > 0 ? x / P.filaPicoPrev * 100 : (x > 0 ? Infinity : 0);
        v.nivel = x >= F.minDif && d >= F.crit ? 'crit' : x >= F.minDif && d >= F.aten ? 'aten' : 'ok';
        v.status = 'maior que o normal no dia';
        v.det = `maior fila do dia: <b>${n(P.filaPico, 'técnico', 'técnicos')}</b>` + med(fI(P.filaPicoPrev));
        v.valor = isFinite(d) ? pctTx(d) : '+' + fI(x); v.valorSub = isFinite(d) ? 'vs. normal' : 'a mais';
        v.atual = fI(P.filaPico); v.ref = `maior fila do dia · med. ${fI(P.filaPicoPrev)}`;
      }
    }
    out.push(v);

    // 5) fila sem agente disponível (retrato da última coleta: igual nas duas visões)
    v = verif('agentes', 'CO', { ch: 'esp', dir: 'CO' });
    v.regra = 'Skill com técnico esperando e nenhum agente disponível na última coleta = em atenção.';
    if (fila.semAgente) {
      const k = fila.semAgente.length;
      v.nivel = k ? 'aten' : 'ok';
      v.status = 'skill sem agente disponível';
      v.det = k ? `${k === 1 ? 'skill' : k + ' skills'} com espera e 0 disponível: <b>${fila.semAgente.slice(0, 3).map(esc).join(', ')}</b>${k > 3 ? '…' : ''}` : '';
      v.valor = k ? fI(k) : ''; v.valorSub = k ? (k === 1 ? 'skill' : 'skills') : '';
      v.atual = '0 skills'; v.ref = fila.total ? 'quem tem espera tem agente disponível' : 'ninguém esperando';
    }
    out.push(v);

    // 6–7) TME e TMA (CO)
    [['tme', 'TME', 'tempo médio de espera'], ['tma', 'TMA', 'tempo médio de atendimento']].forEach(([k, nome, ext]) => {
      const T = Lm[k], x = verif(k, 'CO', { ch: k, dir: 'CO' });
      x.regra = `${nome} ${daPer} (${ext}, CO) contra o previsto: ${T.aten}% acima = em atenção; ${T.crit}% acima = crítico (só se passar o previsto em ${fS(T.minDif)} ou mais e a partir de ${T.minFin} finalizadas).`;
      const d = dif(co[k], pv[k]);
      if (d != null && finOk(T.minFin)) {
        const longe = co[k] - pv[k] >= T.minDif;
        x.nivel = longe && d >= T.crit ? 'crit' : longe && d >= T.aten ? 'aten' : 'ok';
        x.status = `acima do normal ${naPer}`;
        x.det = `${hr ? per + ': ' : ''}${nome} <b>${fS(co[k])}</b>` + med(fS(pv[k]));
        x.valor = pctTx(d); x.valorSub = 'vs. normal';
        const dS = co[k] - pv[k];
        x.atual = fS(co[k]); x.ref = `med. ${fS(pv[k])} · ${dS >= 0 ? '+' : '−'}${fS(Math.abs(dS))}` + (dS > 0 && d >= T.aten && !longe ? ` (alarma a partir de +${fS(T.minDif)})` : '');
      }
      out.push(x);
    });

    // 8) atendidos direto (CO), em p.p.
    v = verif('direto', 'CO', { ch: 'dir', dir: 'CO' });
    const Dr = Lm.direto;
    v.regra = `Atendidos direto (em até 1 min, CO) ${daPer} contra o previsto: ${-Dr.aten} p.p. abaixo = em atenção; ${-Dr.crit} p.p. abaixo = crítico (a partir de ${Dr.minFin} finalizadas).`;
    if (co.dir60 != null && pv.dir60 != null && finOk(Dr.minFin)) {
      const x = co.dir60 - pv.dir60;
      v.nivel = x <= Dr.crit ? 'crit' : x <= Dr.aten ? 'aten' : 'ok';
      v.status = `abaixo do normal ${naPer}`;
      v.det = `<b>${fP(co.dir60)}</b> das atendidas em até 1 min` + med(fP(pv.dir60));
      v.valor = ppTx(x); v.valorSub = 'p.p.';
      v.atual = fP(co.dir60); v.ref = `med. ${fP(pv.dir60)} (${ppTx(x)} p.p.)`;
    }
    out.push(v);

    // 9) grupos fora do padrão (um alarme por grupo)
    const Gp = Lm.grupos, gs = (P.grupos || []).filter(g => g.prev != null && g.prev >= Gp.minPrev);
    const fora = gs.map(g => Object.assign({ d: dif(g.v, g.prev) }, g)).filter(g => g.d >= Gp.aten).sort((a, b) => b.d - a.d);
    const regraG = `Oferecidas de cada grupo ${daPer} contra o previsto: ${Gp.aten}% acima = em atenção; ${Gp.crit}% acima = crítico (previsto de ${Gp.minPrev} ou mais).`;
    fora.forEach(g => {
      const x = verif('grupos', 'GRUPO', { ch: 'of', dir: g.dir || 'TODOS', grupo: g.g });
      x.id = 'grupo:' + g.g; x.regra = regraG;
      x.nivel = g.d >= Gp.crit ? 'crit' : 'aten';
      x.status = `${g.g} acima do previsto`;
      x.det = `${esc(g.g)}: <b>${fI(g.v)}</b> ${naPer} · previsto ${fI(g.prev)}`;
      x.valor = pctTx(g.d); x.valorSub = naPer;
      out.push(x);
    });
    if (!fora.length) { const x = verif('grupos', 'GRUPO', { ch: 'of', dir: 'TODOS' }); x.regra = regraG; if (gs.length) x.nivel = 'ok'; if (gs.length) { x.atual = fI(gs.length); x.ref = gs.length === 1 ? 'grupo dentro do previsto' : 'grupos dentro do previsto'; } out.push(x); }

    // 10) skills paradas (última hora corrida: igual nas duas visões)
    v = verif('parada', 'SKILL', { ch: 'of', dir: 'TODOS' });
    v.regra = `Skill sem nenhuma chamada nos últimos 60 min, quando o normal seria ${Lm.parada.minPrev} ou mais = em atenção (pode ser falha de roteamento).`;
    if (m.paradas) {
      const p = m.paradas.filter(x => x.prev >= Lm.parada.minPrev).sort((a, b) => b.prev - a.prev);
      v.nivel = p.length ? 'aten' : 'ok';
      v.status = p.length === 1 ? '1 skill sem chamadas há 1 h' : `${p.length} skills sem chamadas há 1 h`;
      v.det = p.length ? p.slice(0, 3).map(x => `<b>${esc(x.nome)}</b> (normal ${fI(x.prev)})`).join(' · ') + (p.length > 3 ? ` e mais ${p.length - 3}` : '') : '';
      v.valor = p.length ? fI(p.length) : ''; v.valorSub = p.length ? (p.length === 1 ? 'skill' : 'skills') : '';
      v.atual = '0 skills'; v.ref = 'todas recebendo chamadas na última hora';
      if (p.length === 1) v.alvo = { ch: 'of', dir: p[0].dir || 'TODOS' };
    }
    out.push(v);

    // 11) divisão CO/TEL
    v = verif('tel', 'URA', { ch: 'oftel', dir: 'TODOS' });
    const Tl = Lm.tel;
    v.regra = `Parte da TEL nas oferecidas ${daPer} contra o previsto: ${Tl.aten} p.p. de diferença = em atenção; ${Tl.crit} p.p. = crítico (a partir de ${Tl.minOfer} oferecidas).`;
    if (P.telPct != null && P.telPctPrev != null && P.ofer >= Tl.minOfer) {
      const x = P.telPct - P.telPctPrev, ax = Math.abs(x);
      v.nivel = ax >= Tl.crit ? 'crit' : ax >= Tl.aten ? 'aten' : 'ok';
      v.status = `${x > 0 ? 'mais' : 'menos'} chamadas indo para a TEL ${naPer}`;
      v.det = `TEL <b>${fP(P.telPct)}</b> das oferecidas` + med(fP(P.telPctPrev));
      v.valor = ppTx(x); v.valorSub = 'p.p.';
      v.atual = fP(P.telPct); v.ref = `TEL · med. ${fP(P.telPctPrev)} (${ppTx(x)} p.p.)`;
    }
    out.push(v);

    // 12) coleta atrasada (só no dia de hoje, no expediente: igual nas duas visões)
    v = verif('coleta', 'PULSE', null);
    const C = Lm.coleta;
    v.regra = `Sem coleta nova do Pulse há ${C.aten} min ou mais = em atenção; ${C.crit} min ou mais = crítico (só no dia de hoje, no expediente).`;
    if (m.vivo) {
      const a = m.atrasoMin || 0;
      v.nivel = a >= C.crit ? 'crit' : a >= C.aten ? 'aten' : 'ok';
      v.status = 'atrasada';
      v.det = `última coleta às <b>${esc(m.horario)}</b>, há ${fI(a)} min`;
      v.valor = fI(a) + ' min'; v.valorSub = 'sem coleta';
      v.atual = 'há ' + fI(a) + ' min'; v.ref = `última às ${m.horario} (limite ${C.aten} min)`;
    }
    out.push(v);

    // título completo (último alarme, silenciados): "Nome · status"
    out.forEach(x => { x.titulo = x.status ? `${NOME[x.tipo]} · ${x.status}` : NOME[x.tipo]; });
    // críticos primeiro, depois em atenção (na ordem das regras)
    const peso = { crit: 0, aten: 1, ok: 2, na: 3 };
    return out.map((x, i) => Object.assign(x, { ordem: i })).sort((a, b) => peso[a.nivel] - peso[b.nivel] || a.ordem - b.ordem);
  }

  // Histórico local (no aparelho), por visão: desde quando cada alarme está ativo, o último encerrado e os silenciados.
  // h: { dia, desde: {id: 'HH:MM'}, tit: {id: título}, ult: {titulo, fim, mais} | null, sil: {id: ms até quando} }
  function registrar(h, dia, horario, lista, agora) {
    if (!h || h.dia !== dia) h = { dia, desde: {}, tit: {}, ult: null, sil: {} };
    h.desde = h.desde || {}; h.tit = h.tit || {}; h.sil = h.sil || {};
    const ativos = new Set(lista.filter(x => x.nivel === 'crit' || x.nivel === 'aten').map(x => x.id));
    // encerrados agora: o primeiro (o mais antigo na lista) vira o "último alarme"; os outros só contam ("e mais N")
    const fim = Object.keys(h.desde).filter(id => !ativos.has(id));
    if (fim.length) h.ult = { titulo: h.tit[fim[0]] || fim[0], fim: horario, mais: fim.length - 1 };
    fim.forEach(id => { delete h.desde[id]; delete h.tit[id]; });
    lista.forEach(x => { if (ativos.has(x.id)) { if (!h.desde[x.id]) h.desde[x.id] = horario; h.tit[x.id] = x.titulo; } });
    Object.keys(h.sil).forEach(id => { if (h.sil[id] <= agora) delete h.sil[id]; });
    return h;
  }

  return { LIM, TIPOS, avaliar, registrar };
});
