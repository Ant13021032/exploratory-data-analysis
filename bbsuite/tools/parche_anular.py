#!/usr/bin/env python3
"""Fase 3b: poder anular los boletos ya confirmados.

Ahora que confirmar los boletos gasta dinero de verdad, equivocarse al
confirmar deja un gasto en el libro que no habia forma de deshacer sin
tocar el libro a mano. Este parche etiqueta cada movimiento con un
identificador propio, lo guarda en el sorteo en curso y anade un boton
que anula el sorteo devolviendo el gasto al fondo y dejando el cursor
del metodo ciclico donde estaba."""
import pathlib
p = pathlib.Path('bbsuite.html'); s = p.read_text(encoding='utf-8')
pares = []

pares.append(("""    const r = Finanzas.aplicar(Finanzas.saldos(ledger), tipo, importe);
    ledger.movements.push({
      date: opts.date || new Date().toISOString().slice(0,10),
      type: tipo,""",
"""    const r = Finanzas.aplicar(Finanzas.saldos(ledger), tipo, importe);
    ledger.movements.push({
      /* Identificador propio del movimiento: permite localizarlo más
         tarde aunque se hayan borrado o añadido otros por delante, que
         es lo que hace falta para poder anular un sorteo confirmado. */
      id: opts.id || ('mov-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7)),
      date: opts.date || new Date().toISOString().slice(0,10),
      type: tipo,"""))

pares.append(("""  eliminarMovimiento(ledger, index){
    if(index<0 || index>=ledger.movements.length) return ledger;
    ledger.movements.splice(index,1);
    return Finanzas.recalcularBalances(ledger);
  },""",
"""  eliminarMovimiento(ledger, index){
    if(index<0 || index>=ledger.movements.length) return ledger;
    ledger.movements.splice(index,1);
    return Finanzas.recalcularBalances(ledger);
  },
  eliminarMovimientoPorId(ledger, id){
    const i = ledger.movements.findIndex(m=>m.id===id);
    if(i<0) return false;
    Finanzas.eliminarMovimiento(ledger, i);
    return true;
  },"""))

pares.append(("""    const etiqueta = pendingDraw.fecha ? `Boletos del sorteo ${pendingDraw.fecha}` : 'Boletos del sorteo en curso';
    Finanzas.registrarMovimiento(STATE.finance, 'gasto', meta.costeReal, {
      note: `${etiqueta} · ${meta.numApuestasTotal} apuestas × ${eur(meta.plan.precioApuesta)}`
    });
    if(r.method==='CICLICO') STATE.cyclic = pendingDraw.meta.cyclicStateFinal;
    STATE.currentDraw = {fecha: pendingDraw.fecha, method: pendingDraw.meta.metodo, boletos: pendingDraw.meta.boletos, meta: pendingDraw.meta};""",
"""    const etiqueta = pendingDraw.fecha ? `Boletos del sorteo ${pendingDraw.fecha}` : 'Boletos del sorteo en curso';
    const movId = 'sorteo-' + Date.now().toString(36);
    Finanzas.registrarMovimiento(STATE.finance, 'gasto', meta.costeReal, {
      id: movId,
      note: `${etiqueta} · ${meta.numApuestasTotal} apuestas × ${eur(meta.plan.precioApuesta)}`
    });
    const cyclicAntes = STATE.cyclic;
    if(r.method==='CICLICO') STATE.cyclic = pendingDraw.meta.cyclicStateFinal;
    STATE.currentDraw = {fecha: pendingDraw.fecha, method: pendingDraw.meta.metodo, boletos: pendingDraw.meta.boletos,
      meta: pendingDraw.meta, movId, cyclicAntes};"""))

pares.append(("""    $('current-tag').textContent = (d.fecha?d.fecha+' · ':'') + d.method;
    $('currentTickets').innerHTML = UI.renderTicketsHtml(d.boletos);
  },""",
"""    $('current-tag').textContent = (d.fecha?d.fecha+' · ':'') + d.method;
    const apuestas = d.boletos.reduce((s,b)=>s+b.apuestas.length,0);
    const coste = (d.meta && d.meta.costeReal) || 0;
    $('currentInfo').textContent = `${apuestas} apuestas en ${d.boletos.length} boletos · ${eur(coste)} ya descontados del fondo.`;
    $('currentTickets').innerHTML = UI.renderTicketsHtml(d.boletos);
  },
  /* Confirmar gasta dinero de verdad, así que tiene que poder
     deshacerse mientras el sorteo no se haya comprobado: se borra el
     gasto del libro por su identificador y el cursor del método cíclico
     vuelve a donde estaba antes de generar. */
  async anularSorteoEnCurso(){
    const d = STATE.currentDraw;
    if(!d) return;
    const coste = (d.meta && d.meta.costeReal) || 0;
    if(!confirm(`¿Anular los boletos de este sorteo?\\n\\nSe borrarán las ${d.boletos.reduce((s,b)=>s+b.apuestas.length,0)} apuestas generadas y los ${eur(coste)} volverán al fondo. Úsalo solo si todavía no has rellenado los boletos de verdad.`)) return;
    if(d.movId) Finanzas.eliminarMovimientoPorId(STATE.finance, d.movId);
    if(d.cyclicAntes) STATE.cyclic = d.cyclicAntes;
    STATE.currentDraw = null;
    await publishState();
  },"""))

pares.append(("""  <div class="card" id="currentCard" style="display:none;">
    <h2>Boletos del sorteo en curso <small id="current-tag"></small></h2>
    <div id="currentTickets"></div>
  </div>""",
"""  <div class="card" id="currentCard" style="display:none;">
    <h2>Boletos del sorteo en curso <small id="current-tag"></small></h2>
    <div class="hint" id="currentInfo"></div>
    <div id="currentTickets"></div>
    <button class="btn btn-danger" onclick="UI.anularSorteoEnCurso()">↩ Anular estos boletos y devolver el gasto al fondo</button>
  </div>"""))

for viejo, nuevo in pares:
    assert s.count(viejo) == 1, 'NO ENCONTRADO: ' + viejo[:70]
    s = s.replace(viejo, nuevo)
p.write_text(s, encoding='utf-8')
print('OK: %d bloques' % len(pares))
