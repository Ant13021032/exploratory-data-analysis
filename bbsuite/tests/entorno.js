/* Carga la lógica pura de bbsuite.html (el tramo entre los marcadores
   "LOGICA PURA: INICIO" y "LOGICA PURA: FIN") y la devuelve como un
   objeto con todo lo que define, para poder probarla en Node sin
   navegador. Si los marcadores no están, falla ruidosamente: es
   preferible a probar una versión antigua sin enterarse. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'bbsuite.html');

function cargarLogica(){
  const src = fs.readFileSync(HTML, 'utf8');
  const ini = src.indexOf('LOGICA PURA: INICIO');
  const fin = src.indexOf('LOGICA PURA: FIN');
  if(ini < 0 || fin < 0) throw new Error('No se encuentran los marcadores de lógica pura en bbsuite.html');
  const cuerpo = src.slice(src.indexOf('*/', ini) + 2, src.lastIndexOf('/* ===', fin));
  const contexto = {console, Math, Date, JSON, Number, String, Array, Set, Map, Error, isNaN, parseInt, parseFloat};
  vm.createContext(contexto);
  /* Lo declarado con const/let no queda colgado del contexto, así que
     se añade un epílogo que lo recoge todo en un mismo objeto. */
  const epilogo = `
    globalThis.expuesto = {
      pad, eur, signedEur, formatearImporte, porcentaje, parseNumList, safeJsonForScript, AVISO_OBLIGATORIO,
      Analisis, RNG, Finanzas,
      ORDEN_NUMEROS_CICLO, APORTACION_FIJA_JUGADOR, REINTEGROS_POR_FRECUENCIA,
      MIN_BOLETOS, MAX_APUESTAS_POR_BOLETO, PRECIO_APUESTA_DEFECTO, VERSION_ESTADO,
      valorCiclico, siguienteApuestaCiclicaPura, generarApuestasCiclicas,
      generarApuestaAleatoria, asignarReintegros, muestrearPoolAleatorio,
      aCentimos, aEuros, repartoTeorico, resumenReparto, planSorteo,
      repartirApuestasEnBoletos, generarBoletos,
      circulo, compararApuesta, clasificarPremio, formatearApuestaConCirculos,
      generarInformeWhatsapp,
      filtrosPorDefecto, estadoPorDefecto, migrarEstado, validarReglas
    };`;
  vm.runInContext(cuerpo + epilogo, contexto, {filename: 'bbsuite-logica.js'});
  return contexto.expuesto;
}

module.exports = {cargarLogica};
