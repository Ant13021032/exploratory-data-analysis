#!/usr/bin/env node
/* ============================================================
   BBSuite — pruebas de navegador (DOM + cableado).
   Complementa tests/pruebas.js (lógica pura), que NO se repite aquí.

   Uso:  cd bbsuite && node tests/navegador.js
   Requiere playwright-core y el Chromium de /opt/pw-browsers.
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
];
function chromePath() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  const root = '/opt/pw-browsers';
  for (const d of fs.readdirSync(root)) {
    const p = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No encuentro el Chromium de Playwright en /opt/pw-browsers');
}

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const APP = 'file://' + path.resolve(__dirname, '..', 'bbsuite.html');

/* ---------- registro de resultados ---------- */
const RES = [];
let RECORRIDO = '';
function check(nombre, cond, detalle) {
  RES.push({ recorrido: RECORRIDO, nombre, ok: !!cond, detalle: cond ? '' : (detalle || '') });
  console.log((cond ? '  OK   ' : '  FALLO') + ' · ' + nombre + (cond ? '' : '  →  ' + (detalle || '')));
}
function eq(nombre, actual, esperado) {
  check(nombre, String(actual) === String(esperado), `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(actual)}`);
}

/* ---------- utilidades de página ---------- */
async function nuevaPagina(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.__errores = [];
  page.__consola = [];
  page.on('pageerror', e => page.__errores.push('pageerror: ' + (e && e.stack ? e.stack.split('\n')[0] : e)));
  page.on('console', m => {
    const t = m.type();
    const txt = m.text();
    page.__consola.push(t + ': ' + txt);
    // los fallos de red del entorno (certificado del proxy) no son defectos de la app
    if (t === 'error' && !/ERR_CERT|net::ERR|Failed to load resource/.test(txt)) {
      page.__errores.push('console.error: ' + txt);
    }
  });
  page.on('dialog', d => d.accept());
  if (opts.initScript) await page.addInitScript(opts.initScript);
  await page.goto(APP);
  await page.waitForTimeout(150);
  return page;
}
function sinExcepciones(page, etiqueta) {
  check(etiqueta || 'sin excepciones de JavaScript', page.__errores.length === 0, page.__errores.join(' | '));
  page.__errores.length = 0;
}
const txt = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return e ? e.textContent.trim() : '@@NO-EXISTE@@'; }, id);
const val = (page, id) => page.evaluate(i => { const e = document.getElementById(i); return e ? e.value : '@@NO-EXISTE@@'; }, id);

async function irA(page, tab) { await page.click(`#nav button[data-p="${tab}"]`); await page.waitForTimeout(60); }

async function ponJugadores(page, nombres) {
  await page.evaluate(() => { document.getElementById('playerRows').innerHTML = ''; UI.updatePlayersSum(); });
  for (const n of nombres) {
    await page.evaluate(nn => UI.addPlayerRow(nn), n);
  }
  await page.waitForTimeout(60);
}
async function ponPrecio(page, v) {
  await page.fill('#r_betprice', String(v));
  await page.dispatchEvent('#r_betprice', 'input');
  await page.waitForTimeout(60);
}
async function guardarReglas(page) { await page.click('button.btn-primary:has-text("Guardar reglas")'); await page.waitForTimeout(250); }

async function addMov(page, tipo, importe, nota) {
  await irA(page, 'finanzas');
  await page.selectOption('#f_type', tipo);
  await page.fill('#f_amount', String(importe));
  if (nota) await page.fill('#f_note', nota);
  await page.click('button:has-text("Añadir movimiento")');
  await page.waitForTimeout(150);
}

async function datosBoletos(page, contenedor) {
  return page.evaluate(sel => {
    const boletos = Array.from(document.querySelectorAll(sel + ' .boleto'));
    return boletos.map(b => ({
      cabecera: b.querySelector('.boleto-head') ? b.querySelector('.boleto-head').textContent.trim() : '',
      reintegro: b.querySelector('.rtag') ? b.querySelector('.rtag').textContent.replace('R:', '').trim() : null,
      apuestas: Array.from(b.querySelectorAll('.combo')).map(c => Array.from(c.querySelectorAll('.num')).map(n => Number(n.textContent)))
    }));
  }, contenedor);
}

function textoSospechoso(s) {
  const malos = [];
  if (/undefined/.test(s)) malos.push('undefined');
  if (/NaN/.test(s)) malos.push('NaN');
  if (/\[object Object\]/.test(s)) malos.push('[object Object]');
  if (/€\s*€/.test(s)) malos.push('€ €');
  if (/\bnull\b/.test(s)) malos.push('null');
  return malos;
}

/* ============================================================
   RECORRIDOS
   ============================================================ */

async function r1_arranque(browser) {
  RECORRIDO = '1 · Arranque limpio';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await nuevaPagina(browser);
  sinExcepciones(page, 'arranque sin excepciones');
  check('el panel Reglas está visible', await page.isVisible('#panel-reglas'));
  eq('7 filas de jugador en blanco', await page.evaluate(() => document.querySelectorAll('#playerRows .playerrow').length), 7);
  eq('precio por defecto', await val(page, 'r_betprice'), '1.00');
  /* Al arrancar en blanco hay 7 FILAS de jugador, pero ninguna con
     nombre. Una fila vacía no aporta 4 €, así que el plan tiene que
     anunciar 0 € y decirlo: prometer 28 € de presupuesto que la propia
     aplicación no va a registrar al guardar era el defecto 4 del
     informe de calidad. */
  eq('plan · aportaciones', await txt(page, 'plan_aport'), '0,00 €');
  eq('plan · premios', await txt(page, 'plan_premios'), '0,00 €');
  eq('plan · total', await txt(page, 'plan_total'), '0,00 €');
  eq('plan · apuestas', await txt(page, 'plan_apuestas'), '0');
  eq('plan · boletos', await txt(page, 'plan_boletos'), '0');
  eq('plan · se juega', await txt(page, 'plan_jugado'), '0,00 €');
  eq('plan · reparto', await txt(page, 'plan_reparto'), '—');
  const aviso = await txt(page, 'plan_aviso');
  check('plan · avisa de que aún no hay jugadores', /no hay ningún jugador/i.test(aviso), aviso);
  // y en cuanto se escribe un nombre, el plan lo recoge
  await page.fill('#playerRows .playerrow:nth-child(1) .pname', 'Ana');
  eq('plan · un jugador escrito ya suma 4 €', await txt(page, 'plan_aport'), '4,00 €');
  eq('plan · 4 € dan 4 apuestas', await txt(page, 'plan_apuestas'), '4');
  await page.fill('#playerRows .playerrow:nth-child(1) .pname', '');
  eq('plan · al borrar el nombre vuelve a 0 €', await txt(page, 'plan_aport'), '0,00 €');
  // coherencia del panel: nada raro en el bloque
  const plan = await page.evaluate(() => document.getElementById('planPreview').textContent);
  eq('plan sin textos rotos', textoSospechoso(plan).join(','), '');
  check('aviso "sin configuración" visible al arrancar en blanco', await page.isVisible('#reglas-empty'));
  await page.context().close();
}

async function r2_configurar(browser) {
  RECORRIDO = '2 · Configurar y guardar';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await nuevaPagina(browser);
  const nombres = ['Antonio', 'Belen', 'Carlos', 'Diana', 'Elena', 'Fran', 'Gloria'];
  await ponJugadores(page, nombres);
  await ponPrecio(page, '1.00');
  await guardarReglas(page);
  eq('sin errores de validación', await txt(page, 'r_errors'), '');
  sinExcepciones(page, 'guardar reglas sin excepciones');
  eq('jugadores guardados en el estado', await page.evaluate(() => STATE.rules.players.length), 7);
  eq('precio guardado', await page.evaluate(() => STATE.rules.precioApuesta), 1);
  check('el cartel de "sin configuración" desaparece', !(await page.isVisible('#reglas-empty')));

  // plan en vivo al añadir jugador
  await page.evaluate(() => UI.addPlayerRow('Hugo'));
  await page.waitForTimeout(60);
  eq('plan tras añadir 8º jugador · apuestas', await txt(page, 'plan_apuestas'), '32');
  eq('plan tras añadir 8º jugador · total', await txt(page, 'plan_total'), '32,00 €');
  // quitar uno
  await page.evaluate(() => document.querySelector('#playerRows .playerrow .xbtn').click());
  await page.waitForTimeout(60);
  eq('plan tras quitar un jugador · apuestas', await txt(page, 'plan_apuestas'), '28');

  // precio 1,50
  await ponPrecio(page, '1.5');
  eq('precio 1,50 · apuestas', await txt(page, 'plan_apuestas'), '18');
  eq('precio 1,50 · boletos', await txt(page, 'plan_boletos'), '10');
  eq('precio 1,50 · se juega', await txt(page, 'plan_jugado'), '27,00 €');
  eq('precio 1,50 · sobra', await txt(page, 'plan_sobra'), '1,00 €');
  // precio 0
  await ponPrecio(page, '0');
  eq('precio 0 · apuestas', await txt(page, 'plan_apuestas'), '0');
  eq('precio 0 · boletos', await txt(page, 'plan_boletos'), '0');
  check('precio 0 · avisa', /mayor que cero/i.test(await txt(page, 'plan_aviso')), await txt(page, 'plan_aviso'));
  // precio vacío
  await ponPrecio(page, '');
  eq('precio vacío · apuestas', await txt(page, 'plan_apuestas'), '0');
  check('precio vacío · avisa', /mayor que cero/i.test(await txt(page, 'plan_aviso')), await txt(page, 'plan_aviso'));
  const planTxt = await page.evaluate(() => document.getElementById('planPreview').textContent);
  eq('plan con precio vacío sin textos rotos', textoSospechoso(planTxt).join(','), '');
  // guardar con precio vacío debe dar error de validación
  await guardarReglas(page);
  check('guardar con precio vacío da error de validación', /mayor que cero/i.test(await txt(page, 'r_errors')), 'r_errors=' + (await txt(page, 'r_errors')));
  sinExcepciones(page, 'validaciones sin excepciones');

  // fila de jugador en blanco: ¿el plan la cuenta?
  await ponPrecio(page, '1.00');
  await page.evaluate(() => UI.addPlayerRow(''));
  await page.waitForTimeout(60);
  const apuestasConBlanco = await txt(page, 'plan_apuestas');
  await guardarReglas(page);
  const guardados = await page.evaluate(() => STATE.rules.players.length);
  check('el plan en vivo no cuenta filas de jugador en blanco',
    apuestasConBlanco === '28' && guardados === 7,
    `el plan mostraba ${apuestasConBlanco} apuestas (8 filas, una en blanco) pero al guardar solo se registran ${guardados} jugadores → 28 €`);
  await page.context().close();
}

async function r3_persistencia(browser) {
  RECORRIDO = '3 · Persistencia tras recargar';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await nuevaPagina(browser);
  await ponJugadores(page, ['Antonio', 'Belen', 'Carlos', 'Diana', 'Elena', 'Fran', 'Gloria']);
  await ponPrecio(page, '1.00');
  await guardarReglas(page);
  for (let i = 0; i < 7; i++) await addMov(page, 'aportacion', 4, 'cuota jugador ' + (i + 1));
  await addMov(page, 'reinversion', 19, 'premios pequeños');

  const antes = await page.evaluate(() => JSON.stringify({ r: STATE.rules.players.map(p => p.name), p: STATE.rules.precioApuesta, m: STATE.finance.movements.length, s: Finanzas.saldos(STATE.finance) }));
  await page.reload();
  await page.waitForTimeout(250);
  sinExcepciones(page, 'recarga sin excepciones');
  const despues = await page.evaluate(() => JSON.stringify({ r: STATE.rules && STATE.rules.players.map(p => p.name), p: STATE.rules && STATE.rules.precioApuesta, m: STATE.finance.movements.length, s: Finanzas.saldos(STATE.finance) }));
  eq('estado idéntico tras recargar', despues, antes);
  eq('reglas en pantalla tras recargar · precio', await val(page, 'r_betprice'), '1.00');
  eq('reglas en pantalla tras recargar · jugadores', await page.evaluate(() => document.querySelectorAll('#playerRows .playerrow').length), 7);
  await irA(page, 'finanzas');
  eq('bolsa aportaciones tras recargar', await txt(page, 'fu_aport'), '28,00 €');
  eq('bolsa premios tras recargar', await txt(page, 'fu_premios'), '19,00 €');
  eq('movimientos en el libro tras recargar', await page.evaluate(() => document.querySelectorAll('#ledger .mov').length), 8);

  // confirmar boletos y recargar otra vez
  await irA(page, 'generacion');
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(1500);
  await page.click('#previewCard button:has-text("Confirmar boletos")');
  await page.waitForTimeout(600);
  const boletosAntes = await page.evaluate(() => STATE.currentDraw ? STATE.currentDraw.boletos.length : 0);
  await page.reload();
  await page.waitForTimeout(400);
  sinExcepciones(page, 'recarga tras confirmar sin excepciones');
  eq('los boletos confirmados sobreviven a la recarga', await page.evaluate(() => STATE.currentDraw ? STATE.currentDraw.boletos.length : 0), boletosAntes);
  await irA(page, 'generacion');
  check('la tarjeta de boletos en curso se ve tras recargar', await page.isVisible('#currentCard'));
  eq('boletos pintados tras recargar', await page.evaluate(() => document.querySelectorAll('#currentTickets .boleto').length), boletosAntes);

  // exportar copia de seguridad (sin capacidad downloads: ruta clásica de blob)
  const descargas = [];
  page.on('download', d => descargas.push(d.suggestedFilename()));
  await irA(page, 'reglas');
  await page.click('button:has-text("Exportar copia de seguridad")');
  await page.waitForTimeout(700);
  check('el botón de exportar produce un fichero', descargas.length > 0, 'no se disparó ninguna descarga: ' + JSON.stringify(descargas));
  sinExcepciones(page, 'exportar sin excepciones');

  // borrar la copia del dispositivo
  await page.click('button:has-text("Borrar la copia de este dispositivo")');
  await page.waitForTimeout(600);
  const quedaLocal = await page.evaluate(() => localStorage.getItem('bbsuite_estado_pena'));
  check('"Borrar la copia" elimina la clave de localStorage', quedaLocal === null, 'sigue habiendo ' + (quedaLocal || '').slice(0, 60));
  eq('tras borrar, la app arranca en blanco', await page.evaluate(() => STATE.rules === null), 'true');
  sinExcepciones(page, 'borrado sin excepciones');
  await page.context().close();
}

async function r4_finanzas(browser) {
  RECORRIDO = '4 · Finanzas';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await nuevaPagina(browser);
  await ponJugadores(page, ['Antonio', 'Belen', 'Carlos', 'Diana', 'Elena', 'Fran', 'Gloria']);
  await ponPrecio(page, '1.00');
  await guardarReglas(page);
  for (let i = 0; i < 7; i++) await addMov(page, 'aportacion', 4, 'cuota ' + (i + 1));
  await addMov(page, 'reinversion', 19, 'premios reinvertidos');
  eq('bolsa de aportaciones', await txt(page, 'fu_aport'), '28,00 €');
  eq('bolsa de premios', await txt(page, 'fu_premios'), '19,00 €');
  eq('total jugable', await txt(page, 'fu_total'), '47,00 €');
  check('detalle del total menciona 47 apuestas en 10 boletos',
    /47 apuestas en 10 boletos/.test(await txt(page, 'fu_total_det')), await txt(page, 'fu_total_det'));
  const fichas = await page.evaluate(() => Array.from(document.querySelectorAll('#ledger .mov')).map(m => m.textContent.replace(/\s+/g, ' ').trim()));
  eq('8 fichas en el libro', fichas.length, 8);
  eq('fichas sin textos rotos', fichas.map(textoSospechoso).flat().join(','), '');
  sinExcepciones(page, 'registrar movimientos sin excepciones');

  // borrar un movimiento intermedio (la 4ª aportación, índice 3)
  await page.evaluate(() => UI.eliminarMovimiento(3));
  await page.waitForTimeout(300);
  sinExcepciones(page, 'eliminar movimiento sin excepciones');
  eq('aportaciones tras borrar una cuota', await txt(page, 'fu_aport'), '24,00 €');
  eq('premios tras borrar una cuota', await txt(page, 'fu_premios'), '19,00 €');
  eq('total tras borrar una cuota', await txt(page, 'fu_total'), '43,00 €');
  eq('quedan 7 fichas', await page.evaluate(() => document.querySelectorAll('#ledger .mov').length), 7);
  const saldosFicha = await page.evaluate(() => Array.from(document.querySelectorAll('#ledger .mov .mov-foot')).map(f => f.textContent.trim()));
  // las fichas se pintan en orden inverso: la primera es el último movimiento
  check('la ficha más reciente muestra el saldo recalculado 43,00 €',
    /43,00 €/.test(saldosFicha[0]), saldosFicha[0]);
  check('ninguna ficha conserva el saldo viejo de 47,00 €',
    !saldosFicha.some(s => /Saldo tras el movimiento 47,00 €/.test(s)), saldosFicha.join(' || '));
  await page.context().close();
}

/* prepara una peña con el fondo indicado (aportaciones + premios) */
async function penaConFondo(browser, aportaciones, premios, metodo, nJug) {
  const page = await nuevaPagina(browser);
  const nombres = ['Antonio', 'Belen', 'Carlos', 'Diana', 'Elena', 'Fran', 'Gloria'].slice(0, nJug || 7);
  await ponJugadores(page, nombres);
  await ponPrecio(page, '1.00');
  if (metodo) await page.selectOption('#r_method', metodo);
  await guardarReglas(page);
  if (aportaciones > 0) await addMov(page, 'aportacion', aportaciones, 'aportaciones del mes');
  if (premios > 0) await addMov(page, 'reinversion', premios, 'premios reinvertidos');
  return page;
}

async function r5_generacion47(browser) {
  RECORRIDO = '5 · Generación con 47 €';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await penaConFondo(browser, 28, 19);
  await irA(page, 'generacion');
  eq('presupuesto · total', await txt(page, 'g_total'), '47,00 €');
  eq('presupuesto · apuestas', await txt(page, 'g_apuestas'), '47');
  eq('presupuesto · boletos', await txt(page, 'g_boletos'), '10');
  eq('presupuesto · coste', await txt(page, 'g_coste'), '47,00 €');
  eq('presupuesto · sobrante', await txt(page, 'g_sobrante'), '0,00 €');

  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(2000);
  sinExcepciones(page, 'previsualizar sin excepciones');
  const info = await txt(page, 'previewInfo');
  check('el resumen dice 47 apuestas en 10 boletos', /47 apuestas en 10 boletos/.test(info), info);
  check('el resumen no tiene textos rotos', textoSospechoso(info).length === 0, info);
  /* En español el separador decimal es la coma y el signo % va
     separado del número por un espacio, como manda la norma. */
  const cobertura = (info.match(/cobertura alcanzada: [\d,]+ ?%/) || [''])[0];
  check('[Análisis] la cobertura usa el decimal español (coma)', /,\d ?%/.test(cobertura),
    `el resto de la aplicación escribe "47,00 €" pero aquí pone "${cobertura}"`);
  const bs = await datosBoletos(page, '#previewTickets');
  eq('10 boletos pintados', bs.length, 10);
  const totalPintadas = bs.reduce((s, b) => s + b.apuestas.length, 0);
  eq('47 apuestas realmente pintadas en el HTML', totalPintadas, 47);
  check('ningún boleto pasa de 8 apuestas', bs.every(b => b.apuestas.length <= 8), JSON.stringify(bs.map(b => b.apuestas.length)));
  const reint = bs.map(b => b.reintegro).sort();
  eq('los 10 reintegros 0-9 están cubiertos', reint.join(','), '0,1,2,3,4,5,6,7,8,9');
  check('todas las apuestas tienen 6 números 1-49', bs.every(b => b.apuestas.every(a => a.length === 6 && a.every(n => n >= 1 && n <= 49))), 'hay apuestas mal formadas');

  // previsualizar no gasta nada
  eq('previsualizar no toca el fondo', await page.evaluate(() => Finanzas.saldoActual(STATE.finance)), 47);
  eq('previsualizar no anota nada en el libro', await page.evaluate(() => STATE.finance.movements.length), 2);

  await page.click('#previewCard button:has-text("Confirmar boletos")');
  await page.waitForTimeout(600);
  sinExcepciones(page, 'confirmar sin excepciones');
  await irA(page, 'finanzas');
  eq('tras confirmar · aportaciones', await txt(page, 'fu_aport'), '0,00 €');
  eq('tras confirmar · premios', await txt(page, 'fu_premios'), '0,00 €');
  eq('tras confirmar · total', await txt(page, 'fu_total'), '0,00 €');
  const ultimoMov = await page.evaluate(() => { const m = STATE.finance.movements[STATE.finance.movements.length - 1]; return JSON.stringify(m); });
  const mv = JSON.parse(ultimoMov);
  eq('gasto anotado por 47 €', mv.amount, 47);
  eq('gasto repartido · premios', mv.desglose.premios, -19);
  eq('gasto repartido · aportaciones', mv.desglose.aportaciones, -28);
  const fichaGasto = await page.evaluate(() => document.querySelector('#ledger .mov').textContent.replace(/\s+/g, ' ').trim());
  check('la ficha del gasto muestra las dos bolsas', /Premios -19,00 €/.test(fichaGasto) && /Aportaciones -28,00 €/.test(fichaGasto), fichaGasto);
  check('la ficha del gasto no tiene textos rotos', textoSospechoso(fichaGasto).length === 0, fichaGasto);
  await irA(page, 'generacion');
  eq('boletos en curso pintados', await page.evaluate(() => document.querySelectorAll('#currentTickets .boleto').length), 10);
  await page.context().close();
}

async function r6_noventa(browser) {
  RECORRIDO = '6 · Caso de los 90 €';
  console.log('\n== ' + RECORRIDO + ' ==');
  for (const metodo of ['ANALISIS', 'ALEATORIO', 'CICLICO']) {
    const page = await penaConFondo(browser, 90, 0, metodo);
    await irA(page, 'generacion');
    eq(`[${metodo}] presupuesto · apuestas`, await txt(page, 'g_apuestas'), '90');
    eq(`[${metodo}] presupuesto · boletos`, await txt(page, 'g_boletos'), '12');
    await page.click('button:has-text("Previsualizar boletos")');
    await page.waitForTimeout(metodo === 'ANALISIS' ? 4000 : 1200);
    sinExcepciones(page, `[${metodo}] previsualizar sin excepciones`);
    const bs = await datosBoletos(page, '#previewTickets');
    eq(`[${metodo}] 12 boletos pintados`, bs.length, 12);
    eq(`[${metodo}] 90 apuestas pintadas`, bs.reduce((s, b) => s + b.apuestas.length, 0), 90);
    check(`[${metodo}] ningún boleto pasa de 8 apuestas`, bs.every(b => b.apuestas.length <= 8), JSON.stringify(bs.map(b => b.apuestas.length)));
    const reint = new Set(bs.map(b => b.reintegro));
    eq(`[${metodo}] los 10 reintegros 0-9 aparecen`, Array.from(reint).sort((a, b) => a - b).join(','), '0,1,2,3,4,5,6,7,8,9');
    const info = await txt(page, 'previewInfo');
    check(`[${metodo}] el resumen dice 90 apuestas en 12 boletos`, /90 apuestas en 12 boletos/.test(info), info);
    check(`[${metodo}] resumen sin textos rotos`, textoSospechoso(info).length === 0, info);
    if (metodo === 'CICLICO') {
      const cursorAntes = await page.evaluate(() => STATE.cyclic.lastIndexUsed);
      eq('[CICLICO] previsualizar no mueve el cursor', cursorAntes, 0);
      await page.click('#previewCard button:has-text("Confirmar boletos")');
      await page.waitForTimeout(500);
      const cursorDespues = await page.evaluate(() => STATE.cyclic.lastIndexUsed);
      check('[CICLICO] confirmar mueve el cursor', cursorDespues > 0, 'cursor=' + cursorDespues);
    }
    await page.context().close();
  }
}

async function r7_limites(browser) {
  RECORRIDO = '7 · Casos límite';
  console.log('\n== ' + RECORRIDO + ' ==');

  // --- fondo de 8 € ---
  let page = await penaConFondo(browser, 8, 0, null, 2);
  await irA(page, 'generacion');
  eq('[8 €] apuestas', await txt(page, 'g_apuestas'), '8');
  eq('[8 €] boletos', await txt(page, 'g_boletos'), '8');
  const aviso8 = await txt(page, 'g_aviso');
  check('[8 €] avisa de reintegros sin cubrir', /reintegro/i.test(aviso8) && /sin cubrir/i.test(aviso8), aviso8);
  check('[8 €] el aviso no tiene textos rotos', textoSospechoso(aviso8).length === 0, aviso8);
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(1500);
  sinExcepciones(page, '[8 €] previsualizar sin excepciones');
  let bs = await datosBoletos(page, '#previewTickets');
  eq('[8 €] 8 boletos pintados', bs.length, 8);
  eq('[8 €] 8 apuestas pintadas', bs.reduce((s, b) => s + b.apuestas.length, 0), 8);
  check('[8 €] la vista previa repite el aviso de reintegros', /sin cubrir/i.test(await txt(page, 'previewInfo')), await txt(page, 'previewInfo'));
  await page.context().close();

  // --- fondo de 0 € ---
  page = await penaConFondo(browser, 0, 0);
  await irA(page, 'generacion');
  eq('[0 €] apuestas', await txt(page, 'g_apuestas'), '0');
  eq('[0 €] boletos', await txt(page, 'g_boletos'), '0');
  check('[0 €] avisa de que no se puede jugar', /no llega ni para una apuesta/i.test(await txt(page, 'g_aviso')), await txt(page, 'g_aviso'));
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(400);
  sinExcepciones(page, '[0 €] previsualizar sin excepciones');
  check('[0 €] no se pinta ninguna vista previa', !(await page.isVisible('#previewCard')));
  check('[0 €] muestra un error explicativo', /no llega ni para una apuesta/i.test(await txt(page, 'errBanner')), await txt(page, 'errBanner'));
  await page.context().close();

  // --- frontera 80 / 81 ---
  for (const [fondo, boletosEsperados] of [[80, 10], [81, 11]]) {
    page = await penaConFondo(browser, fondo, 0, 'ALEATORIO');
    await irA(page, 'generacion');
    eq(`[${fondo} €] apuestas`, await txt(page, 'g_apuestas'), String(fondo));
    eq(`[${fondo} €] boletos`, await txt(page, 'g_boletos'), String(boletosEsperados));
    await page.click('button:has-text("Previsualizar boletos")');
    await page.waitForTimeout(1200);
    sinExcepciones(page, `[${fondo} €] previsualizar sin excepciones`);
    bs = await datosBoletos(page, '#previewTickets');
    eq(`[${fondo} €] boletos pintados`, bs.length, boletosEsperados);
    eq(`[${fondo} €] apuestas pintadas`, bs.reduce((s, b) => s + b.apuestas.length, 0), fondo);
    check(`[${fondo} €] ningún boleto pasa de 8`, bs.every(b => b.apuestas.length <= 8), JSON.stringify(bs.map(b => b.apuestas.length)));
    eq(`[${fondo} €] los 10 reintegros aparecen`, Array.from(new Set(bs.map(b => b.reintegro))).sort((a, b) => a - b).join(','), '0,1,2,3,4,5,6,7,8,9');
    await page.context().close();
  }

  // --- precio 0 / vacío con fondo disponible ---
  page = await penaConFondo(browser, 40, 0);
  await irA(page, 'reglas');
  await ponPrecio(page, '0');
  await guardarReglas(page);
  check('[precio 0] no se puede guardar', /mayor que cero/i.test(await txt(page, 'r_errors')), await txt(page, 'r_errors'));
  // forzamos el precio 0 en el estado para ver cómo reacciona Generación
  await page.evaluate(() => { STATE.rules.precioApuesta = 0; renderAll(); });
  await page.waitForTimeout(150);
  sinExcepciones(page, '[precio 0] render de Generación sin excepciones');
  await irA(page, 'generacion');
  eq('[precio 0] apuestas', await txt(page, 'g_apuestas'), '0');
  eq('[precio 0] precio mostrado', await txt(page, 'g_precio'), '0,00 €');
  check('[precio 0] avisa', /mayor que cero/i.test(await txt(page, 'g_aviso')), await txt(page, 'g_aviso'));
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(400);
  sinExcepciones(page, '[precio 0] previsualizar sin excepciones');
  await page.context().close();

  // --- peña sin jugadores ---
  page = await nuevaPagina(browser);
  await ponJugadores(page, []);
  await page.waitForTimeout(80);
  check('[sin jugadores] el plan avisa', /ningún jugador/i.test(await txt(page, 'plan_aviso')), await txt(page, 'plan_aviso'));
  eq('[sin jugadores] apuestas', await txt(page, 'plan_apuestas'), '0');
  await guardarReglas(page);
  check('[sin jugadores] no se puede guardar', /al menos un jugador/i.test(await txt(page, 'r_errors')), await txt(page, 'r_errors'));
  sinExcepciones(page, '[sin jugadores] sin excepciones');
  await irA(page, 'generacion');
  check('[sin reglas] Generación explica que faltan las reglas', /Configura primero las Reglas/i.test(await txt(page, 'g_aviso')), await txt(page, 'g_aviso'));
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(300);
  sinExcepciones(page, '[sin reglas] previsualizar sin excepciones');
  await page.context().close();
}

async function r8_sorteo(browser) {
  RECORRIDO = '8 · Sorteo y premios';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await penaConFondo(browser, 28, 19);
  await irA(page, 'generacion');
  await page.fill('#g_date', 'sábado 19 de septiembre de 2026');
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(2000);
  await page.click('#previewCard button:has-text("Confirmar boletos")');
  await page.waitForTimeout(500);

  await irA(page, 'sorteo');
  check('el formulario de sorteo está visible', await page.isVisible('#sorteo-form'));

  // --- entradas mal introducidas ---
  const malos = [
    ['1 2 3 4 5', '3', /6 números ganadores/i, 'solo 5 números'],
    ['1 2 3 4 5 5', '3', /6 números ganadores/i, 'un número repetido'],
    ['1 2 3 4 5 66', '3', /6 números ganadores/i, 'número fuera de 1-49'],
    ['1 2 3 4 5 6', '12', /reintegro debe estar entre 0 y 9/i, 'reintegro 12']
  ];
  for (const [nums, reint, re, etiqueta] of malos) {
    await page.fill('#s_nums', nums);
    await page.fill('#s_reint', reint);
    await page.click('button:has-text("Comprobar y registrar")');
    await page.waitForTimeout(200);
    const err = await txt(page, 'errBanner');
    check(`[entrada inválida: ${etiqueta}] se rechaza con mensaje`, re.test(err), 'errBanner=' + err);
    eq(`[entrada inválida: ${etiqueta}] no se registra el sorteo`, await page.evaluate(() => STATE.history.length), 0);
    check(`[entrada inválida: ${etiqueta}] los boletos siguen en curso`, await page.evaluate(() => !!STATE.currentDraw));
  }
  sinExcepciones(page, 'entradas inválidas sin excepciones');

  // --- resultado válido que premia: copiamos la 1ª apuesta del boleto 1 ---
  const ganadores = await page.evaluate(() => STATE.currentDraw.boletos[0].apuestas[0].slice());
  const reintGanador = await page.evaluate(() => STATE.currentDraw.boletos[0].reintegro);
  await page.fill('#s_nums', ganadores.join(' '));
  await page.fill('#s_reint', String(reintGanador));
  await page.click('button:has-text("Comprobar y registrar")');
  await page.waitForTimeout(600);
  sinExcepciones(page, 'comprobar resultado sin excepciones');
  eq('el sorteo entra en el historial', await page.evaluate(() => STATE.history.length), 1);
  eq('se vacía el sorteo en curso', await page.evaluate(() => STATE.currentDraw === null), 'true');
  const informe = await page.evaluate(() => STATE.history[0].reportText);
  check('el informe menciona el premio de categoría 6', /categoría 6/.test(informe), informe.slice(0, 400));
  check('el informe no tiene textos rotos', textoSospechoso(informe).filter(x => x !== 'null').length === 0, textoSospechoso(informe).join(','));
  const pendientes = await page.evaluate(() => STATE.history[0].prizes.length);
  check('hay premios pendientes de registrar', pendientes > 0, 'pendientes=' + pendientes);
  check('el panel de premios pendientes se pinta', await page.evaluate(() => document.querySelectorAll('#sorteoResults .boleto').length) > 0);
  const panel = await txt(page, 'sorteoResults');
  check('el panel de premios no tiene textos rotos', textoSospechoso(panel).filter(x => x !== 'null').length === 0, panel.slice(0, 300));

  // --- premio pequeño (por debajo del umbral 5 €) ---
  const idxPequeno = await page.evaluate(() => STATE.history[0].prizes.findIndex(p => p.categoria === 'R'));
  check('hay un premio de reintegro para registrar como pequeño', idxPequeno >= 0, 'idx=' + idxPequeno);
  const premiosAntes = await page.evaluate(() => Finanzas.saldos(STATE.finance).premios);
  await page.fill('#pz_amt_' + idxPequeno, '3');
  await page.waitForTimeout(100);
  check('[premio pequeño] no se piden porcentajes', !(await page.isVisible('#pz_split_wrap_' + idxPequeno)));
  await page.click(`#pz_amt_${idxPequeno} ~ button`);
  await page.waitForTimeout(500);
  sinExcepciones(page, 'registrar premio pequeño sin excepciones');
  const premiosDespues = await page.evaluate(() => Finanzas.saldos(STATE.finance).premios);
  eq('[premio pequeño] entra íntegro en la bolsa de premios', premiosDespues, premiosAntes + 3);
  // el informe se regenera con el importe registrado: ¿solo para el premio registrado?
  const datosR = await page.evaluate(() => {
    const h = STATE.history[0];
    const registrados = h.prizes.filter(p => p.status === 'registrado');
    const totalRegistrado = registrados.reduce((s, p) => s + (p.importe || 0), 0);
    const lineas = (h.reportText.match(/PREMIO categoría R: [\d,]+ €/g) || []);
    const total = (h.reportText.match(/Importe total estimado: ([\d.,]+) €/) || [])[1];
    return { nR: h.prizes.filter(p => p.categoria === 'R').length, registrados: registrados.length, totalRegistrado, lineas: lineas.length, total };
  });
  check('[informe] el importe registrado solo se aplica al premio registrado',
    datosR.lineas === datosR.registrados,
    `se ha registrado 1 premio de reintegro (3,00 €) pero el informe pone ese importe en ${datosR.lineas} de las ${datosR.nR} líneas de categoría R; "Importe total estimado" pasa a ${datosR.total} € cuando lo registrado suma ${datosR.totalRegistrado} €`);
  await irA(page, 'finanzas');
  check('[premio pequeño] deja anotación + reinversión en el libro',
    await page.evaluate(() => STATE.finance.movements.filter(m => m.type === 'premio').length) === 1 &&
    await page.evaluate(() => STATE.finance.movements.filter(m => m.type === 'reinversion' && m.amount === 3).length) === 1);
  await irA(page, 'sorteo');

  // --- premio grande ---
  const idxGrande = await page.evaluate(() => STATE.history[0].prizes.findIndex(p => p.status === 'pendiente'));
  check('queda otro premio pendiente para el caso grande', idxGrande >= 0, 'idx=' + idxGrande);
  // importe grande de verdad: formato español de miles
  await page.fill('#pz_amt_' + idxGrande, '1500000');
  await page.dispatchEvent('#pz_amt_' + idxGrande, 'input');
  await page.waitForTimeout(150);
  const millon = await txt(page, 'pz_perplayer_' + idxGrande);
  const detMillon = await txt(page, 'pz_reinv_det_' + idxGrande);
  check('[importes grandes] se formatean con separador de miles',
    /\d\.\d{3}/.test(millon), `un premio de 1.500.000 € al 50% entre 7 jugadores se muestra como "${millon}" y "${detMillon.trim()}"`);

  await page.fill('#pz_amt_' + idxGrande, '100');
  await page.dispatchEvent('#pz_amt_' + idxGrande, 'input');
  await page.waitForTimeout(150);
  check('[premio grande] aparecen los campos de reparto', await page.isVisible('#pz_split_wrap_' + idxGrande));
  const porJug = await txt(page, 'pz_perplayer_' + idxGrande);
  eq('[premio grande] 100 € al 50% entre 7 jugadores', porJug, '7,14 € por jugador');
  const detalle = await txt(page, 'pz_reinv_det_' + idxGrande);
  check('[premio grande] detalle de reinversión', /50,00 €/.test(detalle), detalle);
  // cambiar porcentajes
  await page.fill('#pz_split_' + idxGrande, '0.7');
  await page.dispatchEvent('#pz_split_' + idxGrande, 'input');
  await page.fill('#pz_reinv_' + idxGrande, '0.3');
  await page.dispatchEvent('#pz_reinv_' + idxGrande, 'input');
  await page.waitForTimeout(150);
  eq('[premio grande] se actualiza al cambiar el % de reparto', await txt(page, 'pz_perplayer_' + idxGrande), '10,00 € por jugador');
  check('[premio grande] se actualiza el % de reinversión', /30,00 €/.test(await txt(page, 'pz_reinv_det_' + idxGrande)), await txt(page, 'pz_reinv_det_' + idxGrande));
  // porcentajes que no suman 1
  await page.fill('#pz_reinv_' + idxGrande, '0.5');
  await page.dispatchEvent('#pz_reinv_' + idxGrande, 'input');
  await page.click(`#pz_amt_${idxGrande} ~ button`);
  await page.waitForTimeout(300);
  check('[premio grande] rechaza porcentajes que no suman 1', /debe sumar 1/i.test(await txt(page, 'errBanner')), await txt(page, 'errBanner'));
  await page.fill('#pz_reinv_' + idxGrande, '0.3');
  await page.dispatchEvent('#pz_reinv_' + idxGrande, 'input');
  const premiosPrevios = await page.evaluate(() => Finanzas.saldos(STATE.finance).premios);
  await page.click(`#pz_amt_${idxGrande} ~ button`);
  await page.waitForTimeout(500);
  sinExcepciones(page, 'registrar premio grande sin excepciones');
  eq('[premio grande] solo la parte reinvertida entra en el fondo',
    await page.evaluate(() => Finanzas.saldos(STATE.finance).premios), premiosPrevios + 30);
  const prizeGrande = await page.evaluate(i => JSON.stringify(STATE.history[0].prizes[i]), idxGrande);
  const pg = JSON.parse(prizeGrande);
  eq('[premio grande] por jugador guardado', pg.porJugador, 10);
  page.__page = null;
  await page.context().close();
}

async function r9_informes(browser) {
  RECORRIDO = '9 · Resumen e Investigación';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await penaConFondo(browser, 28, 19);
  await irA(page, 'generacion');
  await page.fill('#g_date', 'sorteo del 19/09/2026');
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(2000);

  // informe de cartera ANTES de confirmar (no hay sorteo en curso)
  await irA(page, 'resumen');
  await page.selectOption('#rp_kind', 'cartera');
  await page.waitForTimeout(150);
  const carteraVacia = await val(page, 'rp_text');
  check('[cartera sin confirmar] mensaje claro', /No hay boletos confirmados/.test(carteraVacia), carteraVacia.slice(0, 120));

  await irA(page, 'generacion');
  await page.click('#previewCard button:has-text("Confirmar boletos")');
  await page.waitForTimeout(600);

  await irA(page, 'resumen');
  for (const kind of ['ultimo', 'cartera', 'fondo']) {
    await page.selectOption('#rp_kind', kind);
    await page.waitForTimeout(150);
    let t = await val(page, 'rp_text');
    check(`[${kind}] el informe no está vacío`, t.length > 10, JSON.stringify(t));
    const malos = textoSospechoso(t).filter(x => x !== 'null');
    check(`[${kind}] sin undefined/NaN/[object Object]/"€ €"`, malos.length === 0, malos.join(',') + ' → ' + t.slice(0, 300));
    // botón Generar
    await page.click('button:has-text("🔄 Generar")');
    await page.waitForTimeout(150);
    eq(`[${kind}] el botón Generar deja constancia`, await txt(page, 'rp_status'), 'Resumen regenerado.');
  }
  sinExcepciones(page, 'informes sin excepciones');

  // ahora comprobamos el sorteo para tener historial
  await irA(page, 'sorteo');
  const ganadores = await page.evaluate(() => STATE.currentDraw.boletos[2].apuestas[0].slice());
  const rg = await page.evaluate(() => STATE.currentDraw.boletos[2].reintegro);
  await page.fill('#s_nums', ganadores.join(' '));
  await page.fill('#s_reint', String(rg));
  await page.click('button:has-text("Comprobar y registrar")');
  await page.waitForTimeout(600);

  await irA(page, 'resumen');
  await page.selectOption('#rp_kind', 'ultimo');
  await page.waitForTimeout(150);
  const ultimo = await val(page, 'rp_text');
  check('[último resultado] contiene el parte del sorteo', /RESULTADO PEÑA BABY BOOM/.test(ultimo), ultimo.slice(0, 200));
  check('[último resultado] sin textos rotos', textoSospechoso(ultimo).filter(x => x !== 'null').length === 0, textoSospechoso(ultimo).join(','));
  check('[último resultado] muestra la fecha del sorteo', /19\/09\/2026/.test(ultimo), ultimo.slice(0, 300));

  await irA(page, 'investigacion');
  await page.waitForTimeout(150);
  sinExcepciones(page, 'investigación sin excepciones');
  const inv = await txt(page, 'metrics');
  check('[investigación] hay una fila de sorteo', await page.evaluate(() => document.querySelectorAll('#metrics table tr').length) >= 2);
  const malosInv = textoSospechoso(inv).filter(x => x !== 'null');
  check('[investigación] sin textos rotos', malosInv.length === 0, malosInv.join(',') + ' → ' + inv.slice(0, 300));
  const celdas = await page.evaluate(() => Array.from(document.querySelectorAll('#metrics table tr:nth-child(2) td')).map(td => td.textContent.trim()));
  eq('[investigación] apuestas del sorteo', celdas[1], '47');
  eq('[investigación] jugado', celdas[2], '47,00 €');
  check('[investigación] el balance del sorteo es negativo sin premios registrados', /^-/.test(celdas[5] || ''), JSON.stringify(celdas));
  await page.context().close();
}

async function r10_migracion(browser) {
  RECORRIDO = '10 · Migración desde v1';
  console.log('\n== ' + RECORRIDO + ' ==');
  const v1 = {
    v: 1,
    pena: { name: 'Peña Baby Boom' },
    rules: {
      prizeTable: { '3': 8, '4': 60 },
      players: [{ name: 'Antonio', contrib: 4 }, { name: 'Belen', contrib: 4 }, { name: 'Carlos', contrib: 4 },
      { name: 'Diana', contrib: 4 }, { name: 'Elena', contrib: 4 }, { name: 'Fran', contrib: 4 }, { name: 'Gloria', contrib: 4 }],
      minMonthly: 28,
      numTickets: 10,
      apuestasPorSorteo: 40,
      method: 'ANALISIS',
      analysis: { poolSize: 25, guarantee: 4, poolMode: 'random', poolManual: [], enumThreshold: 50000, sampleCandidates: 300, poolSeed: null },
      filters: {
        parity: { active: true, minEven: 1, maxEven: 5 }, consecutive: { active: true, maxRun: 3 },
        decades: { active: true, maxPerDecade: 3 }, sum: { active: true, mean: 150, stdev: 32.79, kSigma: 1.5 },
        highLow: { active: true, cutoff: 24, minPerSide: 1 }, endings: { active: true, maxSameEnding: 2 }
      },
      smallPrizeThreshold: 5,
      bigPrizePolicy: { splitPct: 0.5, reinvestPct: 0.5 }
    },
    finance: {
      previousFund: 35,
      movements: [
        { date: '2026-09-01', type: 'aportacion', player: 'Antonio', ticketId: null, amount: 4, balance: 39, note: 'cuota' },
        { date: '2026-09-01', type: 'aportacion', player: 'Belen', ticketId: null, amount: 4, balance: 43, note: 'cuota' }
      ]
    },
    financeArchive: [{ closedAt: '2026-08-31T10:00:00.000Z', movements: [], closingBalance: 35 }],
    cyclic: { lastIndexUsed: 12, lastRunDate: '2026-08-20T10:00:00.000Z' },
    currentDraw: null,
    history: []
  };
  const page = await nuevaPagina(browser, {
    initScript: `(()=>{ try{ localStorage.setItem('bbsuite_estado_pena', ${JSON.stringify(JSON.stringify(v1))}); }catch(e){} })()`
  });
  sinExcepciones(page, 'arranque con estado v1 sin excepciones');
  eq('el estado se migra a v2', await page.evaluate(() => STATE.v), 2);
  eq('previousFund pasa a ser dos bolsas', await page.evaluate(() => JSON.stringify(STATE.finance.previousFund)), '{"aportaciones":35,"premios":0}');
  eq('rules.numTickets desaparece', await page.evaluate(() => STATE.rules.numTickets === undefined), 'true');
  eq('rules.apuestasPorSorteo desaparece', await page.evaluate(() => STATE.rules.apuestasPorSorteo === undefined), 'true');
  eq('se da de alta el precio de la apuesta', await page.evaluate(() => STATE.rules.precioApuesta), 1);
  await irA(page, 'finanzas');
  eq('el fondo antiguo queda en la bolsa de aportaciones', await txt(page, 'fu_aport'), '43,00 €');
  eq('la bolsa de premios queda a cero', await txt(page, 'fu_premios'), '0,00 €');
  eq('total jugable tras migrar', await txt(page, 'fu_total'), '43,00 €');
  const libro = await txt(page, 'ledger');
  check('el libro migrado no tiene textos rotos', textoSospechoso(libro).filter(x => x !== 'null').length === 0, textoSospechoso(libro).join(',') + ' → ' + libro.slice(0, 300));
  eq('fondo acumulado previo', await page.evaluate(() => document.getElementById('fundTotals').textContent.trim()).then(t => /35,00 €/.test(t)), 'true');
  await irA(page, 'generacion');
  eq('el plan migrado da 43 apuestas', await txt(page, 'g_apuestas'), '43');
  eq('el plan migrado da 10 boletos', await txt(page, 'g_boletos'), '10');
  sinExcepciones(page, 'render completo tras migrar sin excepciones');
  // y la migración se persiste
  await page.reload();
  await page.waitForTimeout(300);
  sinExcepciones(page, 'recarga tras migrar sin excepciones');
  await page.context().close();
}

async function r11_extras(browser) {
  RECORRIDO = '11 · Extras adversariales';
  console.log('\n== ' + RECORRIDO + ' ==');

  /* --- a) método Análisis con un pool tan pequeño que no da combinaciones --- */
  let page = await nuevaPagina(browser);
  await ponJugadores(page, ['Antonio', 'Belen', 'Carlos', 'Diana', 'Elena', 'Fran', 'Gloria']);
  await ponPrecio(page, '1.00');
  await page.selectOption('#r_method', 'ANALISIS');
  await page.waitForTimeout(100);
  await page.fill('#a_poolsize', '7');
  await page.selectOption('#a_poolmode', 'manual');
  await page.fill('#a_poolmanual', '1 2 3 4 5 6 7');
  await guardarReglas(page);
  eq('[pool 7] las reglas se guardan', await txt(page, 'r_errors'), '');
  await addMov(page, 'aportacion', 47, 'fondo del mes');
  await irA(page, 'generacion');
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(3000);
  sinExcepciones(page, '[pool 7] previsualizar sin excepciones');
  let bs = await datosBoletos(page, '#previewTickets');
  const vacios = bs.filter(b => b.apuestas.length === 0).length;
  check('[pool 7] no se pintan boletos vacíos', vacios === 0,
    `${vacios} de ${bs.length} boletos salen SIN ninguna apuesta (solo hay ${bs.reduce((s, b) => s + b.apuestas.length, 0)} combinaciones únicas posibles)`);
  const info7 = await txt(page, 'previewInfo');
  check('[pool 7] el resumen avisa de que el pool se queda corto', /pool elegido solo tiene combinaciones/.test(info7), info7);
  await page.click('#previewCard button:has-text("Confirmar boletos")');
  await page.waitForTimeout(500);
  const gasto7 = await page.evaluate(() => STATE.finance.movements[STATE.finance.movements.length - 1].amount);
  eq('[pool 7] solo se cobran las apuestas realmente generadas', gasto7, 7);
  const enCurso = await datosBoletos(page, '#currentTickets');
  check('[pool 7] los boletos en curso tampoco quedan vacíos', enCurso.filter(b => b.apuestas.length === 0).length === 0,
    `${enCurso.filter(b => b.apuestas.length === 0).length} boletos confirmados sin apuestas`);
  await page.context().close();

  /* --- b) previsualizar, vaciar el fondo y confirmar --- */
  page = await penaConFondo(browser, 28, 19);
  await irA(page, 'generacion');
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(2000);
  await page.evaluate(() => UI.eliminarMovimiento(0));  // borra las aportaciones: quedan 19 €
  await page.waitForTimeout(400);
  await irA(page, 'generacion');
  await page.click('#previewCard button:has-text("Confirmar boletos")');
  await page.waitForTimeout(400);
  check('[fondo menguado] confirmar se rechaza con explicación', /Vuelve a previsualizar/i.test(await txt(page, 'errBanner')), await txt(page, 'errBanner'));
  eq('[fondo menguado] no se anota ningún gasto', await page.evaluate(() => STATE.finance.movements.filter(m => m.type === 'gasto').length), 0);
  eq('[fondo menguado] no queda sorteo en curso', await page.evaluate(() => STATE.currentDraw === null), 'true');
  sinExcepciones(page, '[fondo menguado] sin excepciones');
  await page.context().close();

  /* --- c) doble clic en Confirmar --- */
  page = await penaConFondo(browser, 28, 19);
  await irA(page, 'generacion');
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(2000);
  await page.evaluate(() => { UI.confirmarBoletos(); UI.confirmarBoletos(); });
  await page.waitForTimeout(700);
  eq('[doble confirmación] un solo gasto en el libro', await page.evaluate(() => STATE.finance.movements.filter(m => m.type === 'gasto').length), 1);
  sinExcepciones(page, '[doble confirmación] sin excepciones');

  /* --- d) importes inválidos en el libro --- */
  await addMov(page, 'aportacion', 0);
  check('[importe 0] se rechaza', /importe positivo/i.test(await txt(page, 'errBanner')), await txt(page, 'errBanner'));
  await addMov(page, 'aportacion', -5);
  check('[importe negativo] se rechaza', /importe positivo/i.test(await txt(page, 'errBanner')), await txt(page, 'errBanner'));

  /* --- e) gasto manual mayor que el fondo --- */
  const totalAntes = await page.evaluate(() => Finanzas.saldoActual(STATE.finance));
  await addMov(page, 'gasto', 100, 'gasto que no cabe en el fondo');
  const totalDespues = await page.evaluate(() => Finanzas.saldoActual(STATE.finance));
  check('un gasto manual mayor que el fondo no lo deja en negativo',
    totalDespues >= 0, `el fondo pasó de ${totalAntes} € a ${totalDespues} € sin ningún aviso (bolsa de aportaciones ${await page.evaluate(() => Finanzas.saldos(STATE.finance).aportaciones)} €)`);
  const fichaNeg = await page.evaluate(() => document.querySelector('#ledger .mov').textContent.replace(/\s+/g, ' ').trim());
  check('la ficha del gasto sobrepasado no tiene textos rotos', textoSospechoso(fichaNeg).filter(x => x !== 'null').length === 0, fichaNeg);
  sinExcepciones(page, '[gasto excesivo] sin excepciones');
  await page.context().close();

  /* --- f) conciliación mensual --- */
  page = await penaConFondo(browser, 28, 19);
  await irA(page, 'finanzas');
  await page.click('button:has-text("Conciliar mes")');
  await page.waitForTimeout(500);
  sinExcepciones(page, '[conciliar] sin excepciones');
  eq('[conciliar] las dos bolsas se arrastran · aportaciones', await txt(page, 'fu_aport'), '28,00 €');
  eq('[conciliar] las dos bolsas se arrastran · premios', await txt(page, 'fu_premios'), '19,00 €');
  eq('[conciliar] el libro queda vacío', await page.evaluate(() => STATE.finance.movements.length), 0);
  check('[conciliar] el fondo previo se muestra', /47,00 €/.test(await txt(page, 'fundTotals')), await txt(page, 'fundTotals'));
  await page.reload();
  await page.waitForTimeout(300);
  await irA(page, 'finanzas');
  eq('[conciliar] sobrevive a la recarga', await txt(page, 'fu_total'), '47,00 €');
  await page.context().close();

  /* --- g) base de conocimiento local --- */
  page = await nuevaPagina(browser);
  await irA(page, 'conocimiento');
  await page.fill('#j_text', 'Se decide bajar la garantía a 3 aciertos.');
  await page.click('#panel-conocimiento button:has-text("Registrar")');
  await page.waitForTimeout(200);
  eq('[conocimiento] la nota se pinta', await page.evaluate(() => document.querySelectorAll('#kb .kb-item').length), 1);
  await page.reload();
  await page.waitForTimeout(300);
  await irA(page, 'conocimiento');
  eq('[conocimiento] la nota sobrevive a la recarga', await page.evaluate(() => document.querySelectorAll('#kb .kb-item').length), 1);
  sinExcepciones(page, '[conocimiento] sin excepciones');
  await page.context().close();

  /* --- h) exportar e importar la copia de seguridad --- */
  page = await penaConFondo(browser, 28, 19);
  const copia = await page.evaluate(() => JSON.stringify(STATE));
  const tmp = path.join(require('os').tmpdir(), 'bbsuite-copia-prueba.json');
  const objeto = JSON.parse(copia);
  objeto.rules.players.push({ name: 'Hugo', contrib: 4 });
  objeto.updatedAt = new Date(Date.now() + 60000).toISOString();
  fs.writeFileSync(tmp, JSON.stringify(objeto, null, 2));
  const dialogos = [];
  page.on('dialog', d => dialogos.push(d.message()));
  await irA(page, 'reglas');
  await page.setInputFiles('#st_import', tmp);
  await page.waitForTimeout(800);
  sinExcepciones(page, '[importar] sin excepciones');
  eq('[importar] la copia se carga', await page.evaluate(() => STATE.rules.players.length), 8);
  check('[importar] avisa antes de sustituir', dialogos.some(m => /sustituir TODOS los datos/i.test(m)), JSON.stringify(dialogos));
  await page.reload();
  await page.waitForTimeout(300);
  eq('[importar] la copia importada persiste tras recargar', await page.evaluate(() => STATE.rules.players.length), 8);
  // fichero que no es una copia
  const basura = path.join(require('os').tmpdir(), 'bbsuite-basura.json');
  fs.writeFileSync(basura, '{"hola":1}');
  await page.setInputFiles('#st_import', basura);
  await page.waitForTimeout(500);
  check('[importar basura] se rechaza con aviso', dialogos.some(m => /no es una copia de seguridad/i.test(m)), JSON.stringify(dialogos));
  eq('[importar basura] el estado no cambia', await page.evaluate(() => STATE.rules.players.length), 8);
  sinExcepciones(page, '[importar basura] sin excepciones');
  await page.context().close();
}

/* ============================================================ */

/* ============================================================
   12 · Anular un sorteo ya confirmado.
   Confirmar los boletos descuenta dinero de verdad, así que
   equivocarse tiene que poder deshacerse mientras el sorteo no se
   haya comprobado: el gasto vuelve al fondo, a su bolsa, y el
   cursor del método cíclico retrocede a donde estaba.
   ============================================================ */
async function r12_anular(browser) {
  RECORRIDO = '12 · Anular el sorteo en curso';
  console.log('\n== ' + RECORRIDO + ' ==');
  const page = await nuevaPagina(browser);

  await ponJugadores(page, ['Ana', 'Luis', 'Marta', 'Pablo', 'Sara', 'Tomás', 'Elena']);
  await ponPrecio(page, 1);
  await page.selectOption('#r_method', 'CICLICO');
  await guardarReglas(page);
  await addMov(page, 'aportacion', 28, 'Aportaciones del mes');
  await addMov(page, 'reinversion', 19, 'Premios reinvertidos');

  const cursorAntes = await page.evaluate(() => STATE.cyclic.lastIndexUsed);
  await irA(page, 'generacion');
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Confirmar boletos")');
  await page.waitForTimeout(400);

  eq('tras confirmar, el fondo queda a cero', await txt(page, 'g_total'), '0,00 €');
  const cursorDespues = await page.evaluate(() => STATE.cyclic.lastIndexUsed);
  check('el cursor cíclico ha avanzado al confirmar', cursorDespues > cursorAntes, `${cursorAntes} -> ${cursorDespues}`);
  check('el botón de anular está visible', await page.isVisible('button:has-text("Anular estos boletos")'));
  const info = await txt(page, 'currentInfo');
  check('la ficha dice cuánto se ha descontado', /47 apuestas en 10 boletos/.test(info) && /47,00 €/.test(info), info);
  check('la ficha del sorteo en curso no tiene textos rotos', textoSospechoso(info).length === 0, info);

  await page.click('button:has-text("Anular estos boletos")');
  await page.waitForTimeout(400);
  sinExcepciones(page, '[anular] sin excepciones');

  eq('el dinero vuelve al fondo', await txt(page, 'g_total'), '47,00 €');
  eq('vuelve a su bolsa de aportaciones', await txt(page, 'g_aport'), '28,00 €');
  eq('y a su bolsa de premios', await txt(page, 'g_premios'), '19,00 €');
  eq('el cursor cíclico retrocede', await page.evaluate(() => STATE.cyclic.lastIndexUsed), cursorAntes);
  check('ya no hay sorteo en curso', await page.evaluate(() => STATE.currentDraw === null));
  check('la tarjeta de boletos en curso desaparece', !(await page.isVisible('#currentCard')));

  await irA(page, 'finanzas');
  const libro = await page.evaluate(() => document.getElementById('ledger').textContent);
  check('el gasto ya no está en el libro', !/Boletos del sorteo/.test(libro), libro.slice(0, 200));
  eq('el libro vuelve a tener 2 movimientos', await page.evaluate(() => STATE.finance.movements.length), 2);

  await page.reload();
  await page.waitForTimeout(250);
  await irA(page, 'generacion');
  eq('la anulación sobrevive a la recarga', await txt(page, 'g_total'), '47,00 €');

  // y se puede volver a generar sin arrastrar nada del intento anterior
  await page.click('button:has-text("Previsualizar boletos")');
  await page.waitForTimeout(1500);
  const bs = await datosBoletos(page, '#previewTickets');
  eq('se puede volver a generar: 10 boletos', bs.length, 10);
  eq('y otra vez 47 apuestas', bs.reduce((t, b) => t + b.apuestas.length, 0), 47);
  sinExcepciones(page, '[anular] regenerar sin excepciones');

  await page.context().close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const recorridos = [r1_arranque, r2_configurar, r3_persistencia, r4_finanzas, r5_generacion47,
    r6_noventa, r7_limites, r8_sorteo, r9_informes, r10_migracion, r11_extras, r12_anular];
  for (const r of recorridos) {
    try { await r(browser); }
    catch (e) { check('el recorrido termina sin reventar', false, 'EXCEPCIÓN EN EL GUION: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  }
  await browser.close();

  const fallos = RES.filter(r => !r.ok);
  console.log('\n============================================================');
  console.log(`RESUMEN: ${RES.length - fallos.length} pasadas · ${fallos.length} fallidas · ${RES.length} comprobaciones`);
  if (fallos.length) {
    console.log('------------------------------------------------------------');
    const porRecorrido = {};
    fallos.forEach(f => { (porRecorrido[f.recorrido] = porRecorrido[f.recorrido] || []).push(f); });
    Object.keys(porRecorrido).forEach(k => {
      console.log('\n' + k);
      porRecorrido[k].forEach(f => console.log('  ✗ ' + f.nombre + '\n      ' + f.detalle));
    });
  }
  console.log('============================================================');
  process.exit(fallos.length ? 1 : 0);
})();
