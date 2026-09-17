# BBSuite — cuaderno de la peña Baby Boom

Aplicación de una sola página (`bbsuite.html`: HTML, CSS y JavaScript en un
único fichero, sin dependencias ni conexión) para llevar la peña de La
Primitiva: reglas, fondo común, generación de boletos, comprobación del
sorteo e informes para WhatsApp.

## Cómo se guardan los datos

Todo lo que se toca queda guardado en el propio dispositivo al instante y,
si la aplicación se abre desde el enlace compartido, se publica además para
el resto de la peña. Cada estado lleva un sello de tiempo: al arrancar gana
el más reciente entre la copia del dispositivo y la versión compartida.

Para pasar la peña del portátil al móvil está el bloque «Copia de seguridad
de la peña», al final del panel Reglas: exporta un `.json` en un dispositivo
e impórtalo en el otro.

## De dónde salen las apuestas y los boletos

No se escriben a mano: se calculan del dinero que hay en el fondo.

    presupuesto = aportaciones de jugadores + premios reinvertidos
    apuestas    = parte entera de (presupuesto / precio de la apuesta)
    boletos     = max(10, techo(apuestas / 8)), sin pasar del nº de apuestas

El suelo de 10 boletos mantiene cubiertos los reintegros 0-9, porque cada
boleto lleva un único reintegro. El techo de 8 apuestas por boleto es el
límite del propio boleto de La Primitiva: por eso 47 € caben en 10 boletos
y 90 € necesitan 12.

El fondo lleva dos bolsas separadas —aportaciones y premios reinvertidos—
que se juegan juntas pero se ven por separado. Un gasto consume primero los
premios y después las aportaciones.

## Pruebas

    node tests/pruebas.js      # 49 pruebas de la lógica (sin navegador)
    node tests/navegador.js    # 288 comprobaciones en un Chromium real

`tests/pruebas.js` extrae el tramo de `bbsuite.html` marcado entre
`LOGICA PURA: INICIO` y `LOGICA PURA: FIN`, así que ese tramo no puede usar
`document`, `localStorage` ni `window`.

`tests/navegador.js` necesita `playwright-core` (`npm install`) y el Chromium
de `/opt/pw-browsers`; no hay que ejecutar `playwright install`.
