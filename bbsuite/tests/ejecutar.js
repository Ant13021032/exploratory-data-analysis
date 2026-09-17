/* Corredor de pruebas mínimo: sin dependencias, salida legible. */
let pasadas = 0, fallidas = 0;
const fallos = [];
let grupoActual = '';

function grupo(nombre, fn){ grupoActual = nombre; console.log('\n── ' + nombre); fn(); }
function prueba(nombre, fn){
  try{ fn(); pasadas++; console.log('   ✓ ' + nombre); }
  catch(e){ fallidas++; fallos.push(grupoActual + ' › ' + nombre + '\n     ' + e.message); console.log('   ✗ ' + nombre + '\n     ' + e.message); }
}
function igual(obtenido, esperado, mensaje){
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if(a !== b) throw new Error((mensaje ? mensaje + ': ' : '') + 'se esperaba ' + b + ' y se obtuvo ' + a);
}
function cierto(cond, mensaje){ if(!cond) throw new Error(mensaje || 'la condición es falsa'); }
function resumen(){
  console.log('\n' + '='.repeat(52));
  console.log(`${pasadas} pruebas superadas, ${fallidas} fallidas`);
  if(fallidas){ console.log('\nFALLOS:'); fallos.forEach(f=>console.log(' · ' + f)); }
  console.log('='.repeat(52));
  process.exit(fallidas ? 1 : 0);
}
module.exports = {grupo, prueba, igual, cierto, resumen};
