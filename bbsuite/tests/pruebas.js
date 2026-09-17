/* Batería de pruebas de la lógica de BBSuite.
   Ejecutar con:  node tests/pruebas.js
   No necesita navegador ni dependencias: carga el tramo de lógica pura
   de bbsuite.html y lo ejercita directamente. */
const {cargarLogica} = require('./entorno.js');
const {grupo, prueba, igual, cierto, resumen} = require('./ejecutar.js');
const L = cargarLogica();

const libroVacio = () => ({previousFund:{aportaciones:0, premios:0}, movements:[]});

grupo('Del presupuesto a los boletos', ()=>{
  prueba('47 € (28 de aportaciones + 19 de premios) dan 47 apuestas en 10 boletos', ()=>{
    const plan = L.planSorteo({aportaciones:28, premios:19}, 1);
    igual(plan.apuestas, 47, 'apuestas');
    igual(plan.boletos, 10, 'boletos');
    igual(plan.coste, 47, 'coste');
    igual(plan.sobrante, 0, 'sobrante');
    igual(plan.resumen, '7 boletos de 5 apuestas y 3 de 4');
  });
  prueba('90 € no caben en 10 boletos: salen 12', ()=>{
    const plan = L.planSorteo({aportaciones:71, premios:19}, 1);
    igual(plan.apuestas, 90, 'apuestas');
    igual(plan.boletos, 12, 'boletos');
    cierto(plan.cubreReintegros, 'los diez reintegros siguen cubiertos');
  });
  prueba('80 € son el último presupuesto que cabe en 10 boletos', ()=>{
    igual(L.planSorteo({aportaciones:80, premios:0}, 1).boletos, 10);
    igual(L.planSorteo({aportaciones:81, premios:0}, 1).boletos, 11);
  });
  prueba('nunca se baja de 10 boletos mientras haya 10 apuestas', ()=>{
    for(let e=10; e<=80; e++){
      igual(L.planSorteo({aportaciones:e, premios:0}, 1).boletos, 10, e+' €');
    }
  });
  prueba('con menos de 10 € avisa de que no se cubren los diez reintegros', ()=>{
    const plan = L.planSorteo({aportaciones:8, premios:0}, 1);
    igual(plan.apuestas, 8);
    igual(plan.boletos, 8, 'no se inventan boletos vacíos');
    cierto(!plan.cubreReintegros, 'debe avisar');
    cierto(/reintegro/i.test(plan.aviso), 'el aviso habla de los reintegros');
  });
  prueba('un fondo que no llega a una apuesta no genera nada', ()=>{
    const plan = L.planSorteo({aportaciones:0.5, premios:0}, 1);
    igual(plan.apuestas, 0);
    igual(plan.boletos, 0);
    cierto(!!plan.aviso, 'debe avisar');
  });
  prueba('los céntimos sueltos quedan como sobrante, no como media apuesta', ()=>{
    const plan = L.planSorteo({aportaciones:28, premios:19.4}, 1);
    igual(plan.apuestas, 47);
    igual(plan.sobrante, 0.4);
  });
  prueba('si sube el precio de la apuesta, bajan las apuestas', ()=>{
    const plan = L.planSorteo({aportaciones:47, premios:0}, 1.5);
    igual(plan.apuestas, 31);
    igual(plan.coste, 46.5);
    igual(plan.sobrante, 0.5);
  });
  prueba('un precio de cero no revienta el cálculo', ()=>{
    const plan = L.planSorteo({aportaciones:47, premios:0}, 0);
    igual(plan.apuestas, 0);
    cierto(!!plan.aviso);
  });
  prueba('el reparto teórico coincide con el reparto real de apuestas', ()=>{
    for(const total of [10, 23, 47, 80, 81, 90, 137]){
      const plan = L.planSorteo({aportaciones:total, premios:0}, 1);
      const falsas = Array.from({length:plan.apuestas},(_,i)=>[i,i,i,i,i,i]);
      const reales = L.repartirApuestasEnBoletos(falsas, plan.boletos).map(b=>b.length);
      igual(reales, plan.reparto, total+' €');
      igual(reales.reduce((a,b)=>a+b,0), plan.apuestas, 'no se pierde ninguna apuesta ('+total+' €)');
      cierto(Math.max(...reales) <= 8, 'ningún boleto pasa de 8 apuestas ('+total+' €)');
    }
  });
});

grupo('Reintegros', ()=>{
  prueba('con 10 boletos se usan los diez reintegros 0-9 sin repetir', ()=>{
    const boletos = Array.from({length:10},()=>[[1,2,3,4,5,6]]);
    const r = L.asignarReintegros(boletos);
    igual(r.slice().sort((a,b)=>a-b), [0,1,2,3,4,5,6,7,8,9]);
  });
  prueba('con 12 boletos siguen estando los diez y se repiten dos', ()=>{
    const boletos = Array.from({length:12},()=>[[1,2,3,4,5,6]]);
    const r = L.asignarReintegros(boletos);
    igual(new Set(r).size, 10, 'están los diez dígitos');
    igual(r.length, 12);
  });
  prueba('el reintegro más frecuente va al boleto con más apuestas', ()=>{
    const boletos = [[1],[1,1,1],[1,1]].map(b=>b.map(()=>[1,2,3,4,5,6]));
    const r = L.asignarReintegros(boletos);
    igual(r[1], L.REINTEGROS_POR_FRECUENCIA[0], 'el de 3 apuestas se lleva el más frecuente');
  });
});

grupo('Contabilidad de dos bolsas', ()=>{
  prueba('las aportaciones entran en su bolsa y los premios en la suya', ()=>{
    const l = libroVacio();
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{note:'Mes'});
    L.Finanzas.registrarMovimiento(l,'reinversion',19,{note:'Premio'});
    igual(L.Finanzas.saldos(l), {aportaciones:28, premios:19});
    igual(L.Finanzas.saldoActual(l), 47);
  });
  prueba('un gasto consume primero los premios y luego las aportaciones', ()=>{
    const l = libroVacio();
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{});
    L.Finanzas.registrarMovimiento(l,'reinversion',19,{});
    L.Finanzas.registrarMovimiento(l,'gasto',47,{note:'Boletos'});
    igual(L.Finanzas.saldos(l), {aportaciones:0, premios:0});
    const gasto = l.movements[l.movements.length-1];
    igual(gasto.desglose, {aportaciones:-28, premios:-19}, 'desglose del gasto');
  });
  prueba('un gasto menor que la bolsa de premios no toca las aportaciones', ()=>{
    const l = libroVacio();
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{});
    L.Finanzas.registrarMovimiento(l,'reinversion',19,{});
    L.Finanzas.registrarMovimiento(l,'gasto',10,{});
    igual(L.Finanzas.saldos(l), {aportaciones:28, premios:9});
  });
  prueba('borrar un movimiento intermedio recalcula bien las dos bolsas', ()=>{
    const l = libroVacio();
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{});
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{note:'duplicada por error'});
    L.Finanzas.registrarMovimiento(l,'reinversion',19,{});
    L.Finanzas.registrarMovimiento(l,'gasto',47,{});
    L.Finanzas.eliminarMovimiento(l, 1);
    igual(L.Finanzas.saldos(l), {aportaciones:0, premios:0});
    igual(l.movements.length, 3);
  });
  prueba('el fondo previo de las dos bolsas se arrastra al mes siguiente', ()=>{
    const l = {previousFund:{aportaciones:5, premios:3}, movements:[]};
    igual(L.Finanzas.saldos(l), {aportaciones:5, premios:3});
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{});
    igual(L.Finanzas.saldoActual(l), 36);
  });
  prueba('los céntimos no se descuadran al encadenar movimientos', ()=>{
    const l = libroVacio();
    for(let i=0;i<10;i++) L.Finanzas.registrarMovimiento(l,'reinversion',0.1,{});
    igual(L.Finanzas.saldos(l).premios, 1);
  });
  prueba('un tipo de movimiento desconocido se rechaza', ()=>{
    let fallo = false;
    try{ L.Finanzas.registrarMovimiento(libroVacio(),'invento',5,{}); }catch(e){ fallo = true; }
    cierto(fallo, 'debe lanzar error');
  });
});

grupo('Premios', ()=>{
  prueba('un premio pequeño se reinvierte solo, a la bolsa de premios', ()=>{
    const l = libroVacio();
    const r = L.Finanzas.procesarPremio(l, 8, 50, '3', {ticketId:2, numJugadores:7});
    cierto(r.procesado);
    igual(r.tipoUmbral, 'pequeno');
    igual(r.reinvertido, 8);
    igual(L.Finanzas.saldos(l), {aportaciones:0, premios:8});
  });
  prueba('un premio grande no se registra sin decidir antes el reparto', ()=>{
    const l = libroVacio();
    const r = L.Finanzas.procesarPremio(l, 500, 50, '4', {numJugadores:7});
    cierto(!r.procesado, 'no debe registrarse');
    igual(l.movements.length, 0, 'el libro queda intacto');
  });
  prueba('un premio grande reparte entre los jugadores y reinvierte el resto', ()=>{
    const l = libroVacio();
    const r = L.Finanzas.procesarPremio(l, 700, 50, '4', {confirmarGrande:true, pctReparto:0.7, pctReinversion:0.3, numJugadores:7});
    cierto(r.procesado);
    igual(r.repartido, 490);
    igual(r.porJugador, 70, '490 € entre 7 jugadores');
    igual(r.reinvertido, 210);
    igual(L.Finanzas.saldos(l), {aportaciones:0, premios:210}, 'solo vuelve al fondo la parte reinvertida');
  });
  prueba('los porcentajes que no suman 100 % se rechazan', ()=>{
    let fallo = false;
    try{ L.Finanzas.procesarPremio(libroVacio(), 700, 50, '4', {confirmarGrande:true, pctReparto:0.7, pctReinversion:0.4}); }
    catch(e){ fallo = true; }
    cierto(fallo);
  });
});

grupo('Migración del estado antiguo (v1 a v2)', ()=>{
  prueba('el fondo antiguo, que era un solo número, pasa a la bolsa de aportaciones', ()=>{
    const v1 = {v:1, finance:{previousFund:12, movements:[{date:'2026-01-01', type:'aportacion', amount:28, balance:40, note:null}]},
                financeArchive:[{closedAt:'x', movements:[], closingBalance:12}],
                rules:{numTickets:10, apuestasPorSorteo:40, players:[{name:'A'}], method:'ALEATORIO'}};
    const v2 = L.migrarEstado(v1);
    igual(v2.v, L.VERSION_ESTADO);
    igual(v2.finance.previousFund, {aportaciones:12, premios:0});
    igual(L.Finanzas.saldos(v2.finance), {aportaciones:40, premios:0});
    igual(v2.rules.precioApuesta, L.PRECIO_APUESTA_DEFECTO);
    cierto(!('numTickets' in v2.rules), 'el número de boletos ya no se guarda a mano');
    cierto(!('apuestasPorSorteo' in v2.rules), 'las apuestas ya no se guardan a mano');
    igual(v2.financeArchive[0].closingBalance, {aportaciones:12, premios:0});
  });
  prueba('migrar un estado que ya es v2 no lo toca', ()=>{
    const est = L.estadoPorDefecto();
    est.finance.previousFund = {aportaciones:3, premios:4};
    igual(L.migrarEstado(est).finance.previousFund, {aportaciones:3, premios:4});
  });
  prueba('un libro antiguo con reinversiones las manda a la bolsa de premios', ()=>{
    const v1 = {v:1, finance:{previousFund:0, movements:[
      {date:'2026-01-01', type:'aportacion', amount:28, balance:28},
      {date:'2026-01-08', type:'premio', amount:8, balance:28},
      {date:'2026-01-08', type:'reinversion', amount:8, balance:36}
    ]}, financeArchive:[], rules:null};
    const v2 = L.migrarEstado(v1);
    igual(L.Finanzas.saldos(v2.finance), {aportaciones:28, premios:8});
  });
});

grupo('Validación de reglas', ()=>{
  const base = () => ({precioApuesta:1, players:[{name:'Ana'}], method:'ALEATORIO',
    analysis:{poolSize:25, guarantee:4, poolMode:'random', poolManual:[]}, filters:L.filtrosPorDefecto()});
  prueba('unas reglas correctas no dan errores', ()=> igual(L.validarReglas(base()), []));
  prueba('un precio de apuesta de cero se rechaza', ()=>{
    const r = base(); r.precioApuesta = 0;
    cierto(L.validarReglas(r).length > 0);
  });
  prueba('una peña sin jugadores se rechaza', ()=>{
    const r = base(); r.players = [];
    cierto(L.validarReglas(r).length > 0);
  });
  prueba('un jugador sin nombre se rechaza', ()=>{
    const r = base(); r.players = [{name:'  '}];
    cierto(L.validarReglas(r).length > 0);
  });
});

grupo('Generación completa de un sorteo', ()=>{
  const reglas = (metodo) => ({precioApuesta:1, method:metodo, players:Array.from({length:7},(_,i)=>({name:'J'+i})),
    analysis:{poolSize:30, guarantee:3, poolMode:'random', poolManual:[], enumThreshold:50000, sampleCandidates:120, poolSeed:12345},
    filters:L.filtrosPorDefecto()});

  ['ALEATORIO','CICLICO','ANALISIS'].forEach(metodo=>{
    prueba(`método ${metodo}: 47 € producen 47 apuestas en 10 boletos y cuestan 47 €`, ()=>{
      const plan = L.planSorteo({aportaciones:28, premios:19}, 1);
      const meta = L.generarBoletos(reglas(metodo), plan, {lastIndexUsed:0, lastRunDate:null});
      igual(meta.boletos.length, 10, 'boletos');
      igual(meta.numApuestasTotal, 47, 'apuestas generadas');
      igual(meta.costeReal, 47, 'coste real');
      cierto(meta.boletos.every(b=>b.apuestas.length<=8), 'ningún boleto pasa de 8 apuestas');
      cierto(meta.boletos.every(b=>b.apuestas.every(a=>a.length===6 && new Set(a).size===6)), 'todas las apuestas son 6 números distintos');
      cierto(meta.boletos.every(b=>b.apuestas.every(a=>a.every(n=>n>=1&&n<=49))), 'todos los números están entre 1 y 49');
      igual(new Set(meta.boletos.map(b=>b.reintegro)).size, 10, 'los diez reintegros cubiertos');
    });
  });

  prueba('método ALEATORIO: 90 € producen 90 apuestas en 12 boletos', ()=>{
    const plan = L.planSorteo({aportaciones:71, premios:19}, 1);
    const meta = L.generarBoletos(reglas('ALEATORIO'), plan, {lastIndexUsed:0, lastRunDate:null});
    igual(meta.boletos.length, 12);
    igual(meta.numApuestasTotal, 90);
    igual(meta.costeReal, 90);
    cierto(meta.boletos.every(b=>b.apuestas.length<=8));
  });

  prueba('un plan sin apuestas no genera boletos: lanza error', ()=>{
    const plan = L.planSorteo({aportaciones:0, premios:0}, 1);
    let fallo = false;
    try{ L.generarBoletos(reglas('ALEATORIO'), plan, {lastIndexUsed:0}); }catch(e){ fallo = true; }
    cierto(fallo);
  });

  prueba('el método cíclico avanza el cursor y no repite apuestas dentro del sorteo', ()=>{
    const plan = L.planSorteo({aportaciones:47, premios:0}, 1);
    const meta = L.generarBoletos(reglas('CICLICO'), plan, {lastIndexUsed:0, lastRunDate:null});
    cierto(meta.cyclicStateFinal.lastIndexUsed > 0, 'el cursor avanza');
    const todas = meta.boletos.flatMap(b=>b.apuestas.map(a=>a.join(',')));
    igual(new Set(todas).size, todas.length, 'no hay apuestas repetidas');
  });
});

grupo('Ciclo completo de un sorteo con dinero real', ()=>{
  prueba('28 € de aportaciones + 19 € de premios se juegan enteros y dejan el fondo a cero', ()=>{
    const l = libroVacio();
    for(let i=0;i<7;i++) L.Finanzas.registrarMovimiento(l,'aportacion',4,{player:'J'+i});
    L.Finanzas.registrarMovimiento(l,'reinversion',19,{note:'Premios del mes pasado'});
    igual(L.Finanzas.saldoActual(l), 47);

    const plan = L.planSorteo(L.Finanzas.saldos(l), 1);
    const reglas = {precioApuesta:1, method:'ALEATORIO', players:Array.from({length:7},(_,i)=>({name:'J'+i})),
      analysis:{poolSize:25, guarantee:4, poolMode:'random', poolManual:[]}, filters:L.filtrosPorDefecto()};
    const meta = L.generarBoletos(reglas, plan, {lastIndexUsed:0});
    L.Finanzas.registrarMovimiento(l,'gasto',meta.costeReal,{note:'Boletos del sorteo'});

    igual(L.Finanzas.saldoActual(l), 0, 'se juega todo el fondo');
    igual(meta.boletos.length, 10);
    igual(meta.numApuestasTotal, 47);
  });

  prueba('tras un premio pequeño, el sorteo siguiente juega más apuestas', ()=>{
    const l = libroVacio();
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{});
    L.Finanzas.registrarMovimiento(l,'gasto',28,{});
    igual(L.Finanzas.saldoActual(l), 0);
    L.Finanzas.procesarPremio(l, 24, 50, '3', {numJugadores:7});
    L.Finanzas.registrarMovimiento(l,'aportacion',28,{});
    const plan = L.planSorteo(L.Finanzas.saldos(l), 1);
    igual(plan.apuestas, 52, '28 de aportaciones + 24 de premio reinvertido');
    igual(plan.boletos, 10);
  });
});

grupo('Informe de WhatsApp', ()=>{
  prueba('marca los aciertos con círculo y clasifica el premio', ()=>{
    const boletos = [{id:1, reintegro:7, apuestas:[[3,12,18,25,33,49]]}];
    const texto = L.generarInformeWhatsapp(boletos, [3,12,18,25,33,49], 7, {'6':400000}, '2026-09-19');
    cierto(texto.includes('PREMIO categoría 6'), 'detecta el pleno');
    cierto(texto.includes(L.circulo(3)), 'marca el 3 con círculo');
    cierto(texto.includes('AVISO DE RIGOR MATEMATICO'), 'lleva el aviso obligatorio');
  });
  prueba('sin aciertos lo dice explícitamente', ()=>{
    const boletos = [{id:1, reintegro:0, apuestas:[[1,2,3,4,5,6]]}];
    const texto = L.generarInformeWhatsapp(boletos, [10,20,30,40,41,42], 7, {}, null);
    cierto(texto.includes('Sin premios en este sorteo.'));
  });
  prueba('el reintegro acertado es premio aunque no haya números', ()=>{
    igual(L.clasificarPremio(0, true), 'R');
    igual(L.clasificarPremio(5, true), '5R');
    igual(L.clasificarPremio(2, false), null);
  });
});

grupo('Defectos corregidos tras la revisión de calidad', ()=>{
  prueba('los importes largos llevan separador de miles a la española', ()=>{
    igual(L.eur(1500000), '1.500.000,00 €');
    igual(L.eur(107142.86), '107.142,86 €');
    igual(L.eur(47), '47,00 €');
    igual(L.eur(-1234.5), '-1.234,50 €');
    igual(L.signedEur(-1234.5), '-1.234,50 €');
    igual(L.signedEur(750000), '+750.000,00 €');
  });
  prueba('el reparto de un premio grande llega a eur() ya redondeado a céntimos', ()=>{
    /* eur() no puede arreglar un número que ya venga con más de dos
       decimales: por eso todos los importes pasan antes por aEuros(),
       que es aritmética de céntimos enteros. Esta prueba fija ese
       contrato, que es el que evita los redondeos raros en pantalla. */
    const r = L.Finanzas.procesarPremio({previousFund:{aportaciones:0,premios:0}, movements:[]},
      750000, 50, '5R', {confirmarGrande:true, pctReparto:0.5, pctReinversion:0.5, numJugadores:7});
    igual(r.porJugador, 53571.43, '375.000 € entre 7 jugadores');
    igual(L.eur(r.porJugador), '53.571,43 €');
    igual(L.eur(r.reinvertido), '375.000,00 €');
  });
  prueba('los porcentajes usan coma decimal', ()=>{
    igual(L.porcentaje(5.64), '5,6 %');
    igual(L.porcentaje(100), '100,0 %');
  });
  prueba('el importe de un premio no se contagia a las demás apuestas de su categoría', ()=>{
    /* Un boleto con reintegro 7 y cuatro apuestas: si el sorteo saca el
       reintegro 7, las cuatro son premio de categoría R, pero solo una
       tiene importe registrado todavía. */
    const boletos = [{id:1, reintegro:7, apuestas:[[1,2,3,4,5,6],[7,8,9,10,11,12],[13,14,15,16,17,18],[19,20,21,22,23,24]]}];
    const texto = L.generarInformeWhatsapp(boletos, [40,41,42,43,44,45], 7, {}, null, {'1:2': 3});
    const premiadas = texto.split('\n').filter(l=>l.includes('PREMIO categoría R'));
    igual(premiadas.length, 4, 'las cuatro apuestas son premio');
    igual(premiadas.filter(l=>l.includes('3,00 €')).length, 1, 'solo una lleva importe');
    igual(premiadas.filter(l=>l.includes('pendiente de registrar')).length, 3, 'las otras tres quedan pendientes');
    cierto(texto.includes('Importe total estimado: 3,00 €'), 'el total solo suma lo registrado');
  });
  prueba('dos premios de la misma categoría con importes distintos se respetan', ()=>{
    const boletos = [{id:1, reintegro:7, apuestas:[[1,2,3,4,5,6],[7,8,9,10,11,12]]}];
    const texto = L.generarInformeWhatsapp(boletos, [40,41,42,43,44,45], 7, {}, null, {'1:1': 3, '1:2': 5});
    cierto(texto.includes('3,00 €'), 'el primero conserva su importe');
    cierto(texto.includes('5,00 €'), 'el segundo conserva el suyo');
    cierto(texto.includes('Importe total estimado: 8,00 €'));
  });
  prueba('nunca se confirma un boleto sin apuestas aunque el pool se quede corto', ()=>{
    /* Con un pool manual de 7 números solo existen C(7,6)=7 apuestas
       distintas, pero el plan pedía 47 en 10 boletos. */
    const reglas = {precioApuesta:1, method:'ANALISIS', players:[{name:'A'}],
      analysis:{poolSize:7, guarantee:3, poolMode:'manual', poolManual:[1,2,3,4,5,6,7], enumThreshold:50000, sampleCandidates:120, poolSeed:1},
      filters:{}};
    const plan = L.planSorteo({aportaciones:47, premios:0}, 1);
    const meta = L.generarBoletos(reglas, plan, {lastIndexUsed:0});
    cierto(meta.boletos.every(b=>b.apuestas.length>0), 'ningún boleto se queda vacío');
    igual(meta.numApuestasTotal, 7, 'solo hay 7 combinaciones únicas');
    igual(meta.boletos.length, 7, 'y por tanto 7 boletos, no 10');
    igual(meta.costeReal, 7, 'se cobra lo que se juega');
    igual(meta.boletosPrevistos, 10, 'se recuerda cuántos preveía el plan');
    igual(meta.reintegrosCubiertos, 7, 'y cuántos reintegros quedan cubiertos de verdad');
  });
  prueba('cuando el pool da de sobra, no se recorta ningún boleto', ()=>{
    const reglas = {precioApuesta:1, method:'ALEATORIO', players:[{name:'A'}],
      analysis:{poolSize:25, guarantee:4, poolMode:'random', poolManual:[]}, filters:L.filtrosPorDefecto()};
    const plan = L.planSorteo({aportaciones:47, premios:0}, 1);
    const meta = L.generarBoletos(reglas, plan, {lastIndexUsed:0});
    igual(meta.boletos.length, 10);
    igual(meta.reintegrosCubiertos, 10);
  });
});

resumen();
