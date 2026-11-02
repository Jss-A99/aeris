/**
 * config/tienda.js — AERIS E-commerce
 *
 * Textos fijos de la tienda que NO vienen de la hoja: banners del hero, la franja de
 * ventajas y los datos del pie. Disponibles en todas las vistas como `tienda`.
 *
 * ⚠ Son TEXTOS DE MUESTRA. Cambiarlos aquí cuando estén los definitivos
 *   (montos de envío, horario, redes sociales).
 */
/**
 * Envío gratis en Lima. UN solo lugar: lo usan la franja del inicio y la bolsa.
 *  - gratisDesde: monto (después del código promocional) desde el que el envío en Lima es gratis.
 *  - avisarDesdeFaltan: la bolsa muestra el aviso solo cuando falta esta cantidad o menos.
 */
const ENVIO = Object.freeze({ gratisDesde: 199, avisarDesdeFaltan: 30 });

module.exports = Object.freeze({
    envio: ENVIO,

    /**
     * Direcciones de la propia tienda. Un enlace de banner que apunte a ellas se guarda sin el
     * dominio (/conjunto/12-…): así sigue sirviendo si algún día se conecta un dominio propio.
     * (Los banners del inicio salen de la pestaña BANNERS de la hoja.)
     */
    dominios: ['aeris-pe.onrender.com'],

    /** Franja "Comprar en AERIS es simple". `icono`: envio | whatsapp | cambios | Perú */
    ventajas: [
        { icono: 'envio', lineas: ['Envío gratis en Lima', `desde S/ ${ENVIO.gratisDesde}`] },
        { icono: 'whatsapp', lineas: ['Pedido y pago', 'por WhatsApp'] },
        { icono: 'cambios', lineas: ['Cambios', 'hasta 7 días'] },
        { icono: 'lima', lineas: ['Diseñado y hecho', 'en Perú'] }
    ],

    /**
     * Número que recibe los pedidos: código de país + número, solo dígitos (ej. '51987654321').
     * null = el botón "Enviar pedido" avisa que falta configurarlo.
     */
    whatsapp: '51966796407',

    /**
     * Opciones de entrega de la bolsa (en este orden). `detalleGratis` reemplaza al detalle
     * cuando la compra alcanza el envío gratis.
     */
    entrega: {
        recojo: { titulo: 'Recojo en tienda', detalle: 'Sin costo. Coordinamos día y hora por WhatsApp.' },
        lima: {
            titulo: 'Envío en Lima',
            detalle: `El costo depende de tu distrito y lo coordinamos por WhatsApp. Gratis desde S/ ${ENVIO.gratisDesde}.`,
            detalleGratis: `Gratis: tu compra supera los S/ ${ENVIO.gratisDesde}.`
        },
        provincia: { titulo: 'Envío a provincia', detalle: 'Por agencia. El costo lo coordinamos por WhatsApp.' }
    },

    contacto: ['Lima, Perú', 'Atención por WhatsApp', 'Lun a sáb, 10:00 a 19:00'],

    /**
     * Página Nosotros. ⚠ TEXTOS Y FOTO DE MUESTRA.
     * `imagen`: foto vertical (4:5) en /public, ej. '/images/nosotros/historia.jpg'; null = fondo liso.
     */
    nosotros: {
        etiqueta: 'Nuestra historia',
        frase: 'Ropa simple, hecha con cuidado en Lima.',
        texto: 'Diseñamos prendas para el día a día: cortes limpios, telas nobles y colores que se combinan solos. Cada pieza nace en series pequeñas, pensada para usarse muchas veces y durar más de una temporada.',
        firma: 'Equipo AERIS',
        imagen: null,
        pieDeFoto: 'Colección Primavera 2026'
    },

    /**
     * Ubícanos (Nosotros). El horario es de muestra.
     * `mapa`: lo que se busca en Google Maps para poner el punto. Lo más exacto son las
     *   coordenadas (en Google Maps: clic derecho sobre la tienda → copiar los números, ej. '-12.1211,-77.0297'),
     *   o la dirección completa.
     */
    ubicacion: {
        direccion: ['Galería El Triunfo', 'Av. Horacio Urteaga 1376', 'Lima 15072, Perú'],
        horario: 'Lunes a sábado, 10:00 a 19:00',
        mapa: 'Galería El Triunfo, Av. Horacio Urteaga 1376, Lima 15072, Perú',
        invitacion: 'Ven a probarte las prendas o a recoger tu pedido.'
    },

    /** Aún por decidir cuál será la red principal. url null = se muestra solo el nombre. */
    redes: [
        { nombre: 'Instagram', url: null },
        { nombre: 'TikTok', url: null }
    ]
});
