/**
 * @file public/js/ui/producto.js — AERIS E-commerce
 *
 * Páginas de PRODUCTO y de CONJUNTO (mismo código; cambia de dónde salen las opciones):
 *  - prenda:   una sola "fuente" de color/talla (el propio producto);
 *  - conjunto: una fuente por pieza, cada una en un acordeón que se abre de a una.
 *
 * Reglas (las mismas que el resto de la tienda, vía AerisContracts.buildCartItem):
 *  - colores y tallas se filtran entre sí según el stock;
 *  - la cantidad no pasa de lo disponible (descontando lo que ya está en la bolsa);
 *    el aviso de stock SOLO aparece si se intenta pedir más;
 *  - "Agregar a la bolsa" se activa con todo elegido.
 */
(function () {
    'use strict';

    const C = window.AerisContracts;
    const Bolsa = window.AerisBagStore;
    const UI = window.AerisUI;
    const ficha = document.getElementById('ficha');
    if (!ficha || !C || !Bolsa || !UI) return;

    let dto;
    try { dto = JSON.parse(document.getElementById('datos-producto').textContent); } catch (e) { return; }

    const esc = UI.esc;
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)');
    const esConjunto = dto.tipo === 'conjunto';
    const CIERRE_MS = 1000;     // lo que tarda en plegarse una pieza (--r-medio + --r-lento) antes de abrir otra
    const PAUSA_MS = 1200;      // cuánto se deja ver una pieza recién completada

    /* =====================================================================
       Galería: la foto grande pasa sola, una a una. Si la clienta toca las
       miniaturas (o elige un color), se detiene y retoma tras un rato sin actividad.
       ===================================================================== */
    const galeria = document.querySelector('[data-galeria]');
    const principal = document.querySelector('[data-principal]');
    const fotos = galeria ? [...galeria.querySelectorAll('[data-foto]')].map(b => b.dataset.foto) : [];
    const PASO_MS = 5000;          // cada cuánto pasa sola
    const RETOMAR_MS = 12000;      // tiempo sin actividad para volver a pasar sola
    let fotoActual = fotos.length ? fotos[0] : null;
    let pase = null, retomar = null, fundido = null;

    function mostrarFoto(src) {
        if (!principal || !src || src === fotoActual) return;
        fotoActual = src;
        galeria.querySelectorAll('[data-foto]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.foto === src)));
        clearTimeout(fundido);
        if (quieto.matches) { delete principal.dataset.sinFoto; principal.src = src; return; }
        principal.classList.add('cambiando');                 // se desvanece…
        fundido = setTimeout(() => {
            delete principal.dataset.sinFoto;
            principal.src = src;                               // …cambia…
            const aparecer = () => principal.classList.remove('cambiando');
            if (principal.complete) requestAnimationFrame(aparecer); else principal.addEventListener('load', aparecer, { once: true });
            principal.addEventListener('error', aparecer, { once: true });
        }, 450);                                               // …y vuelve a aparecer (= --r-medio)
    }
    function siguienteFoto() {
        const i = fotos.indexOf(fotoActual);
        mostrarFoto(fotos[(i + 1) % fotos.length]);
    }
    function iniciarPase() {
        clearInterval(pase);
        if (fotos.length > 1 && !quieto.matches && !document.hidden) pase = setInterval(siguienteFoto, PASO_MS);
    }
    /** La clienta está mirando: se detiene y se retoma tras un rato sin actividad. */
    function pausarPase() {
        clearInterval(pase);
        clearTimeout(retomar);
        retomar = setTimeout(iniciarPase, RETOMAR_MS);
    }
    if (galeria) {
        galeria.addEventListener('click', e => {
            const b = e.target.closest('[data-foto]');
            if (b) { pausarPase(); mostrarFoto(b.dataset.foto); }
        });
        galeria.addEventListener('scroll', pausarPase, { capture: true, passive: true });   // deslizar la tira
        // Con el mouse encima de la foto no pasa sola; al salir, retoma en unos segundos.
        galeria.addEventListener('mouseenter', () => { clearInterval(pase); clearTimeout(retomar); });
        galeria.addEventListener('mouseleave', () => { clearTimeout(retomar); retomar = setTimeout(iniciarPase, 4000); });
        document.addEventListener('visibilitychange', () => (document.hidden ? clearInterval(pase) : pausarPase()));
        iniciarPase();
    }

    /* =====================================================================
       Selección
       ===================================================================== */
    const fuentes = esConjunto ? dto.piezas : [dto];
    const sel = fuentes.map(f => ({ color: f.colores.length === 1 ? f.colores[0].nombre : null, talla: null }));
    let cantidad = 1;
    let aviso = '';
    let abierta = esConjunto && !dto.agotado ? 0 : -1;
    let pasoSiguiente = null, enCurso = null;

    const stockDe = (f, color, talla) => f.variantes
        .filter(v => (!color || v.color === color) && (!talla || v.talla === talla))
        .reduce((s, v) => s + v.stock, 0);
    const lista = (i) => (fuentes[i].colores.length === 0 || sel[i].color) && (fuentes[i].tallas.length === 0 || sel[i].talla);
    const todas = () => fuentes.every((f, i) => lista(i));
    const seleccion = () => (esConjunto
        ? { componentes: fuentes.map((f, i) => ({ id: f.id, color: sel[i].color, talla: sel[i].talla })) }
        : { color: sel[0].color, talla: sel[0].talla });

    /** { tope, enBolsa, libre } con todo elegido; null si falta elegir. */
    function disponible() {
        if (!todas()) return null;
        const tope = Math.min(...fuentes.map((f, i) => stockDe(f, sel[i].color, sel[i].talla)));
        let enBolsa = 0;
        try { enBolsa = Bolsa.cantidadDe(C.buildCartItem(dto, seleccion(), 1).key); } catch (e) { /* sin stock */ }
        return { tope, enBolsa, libre: Math.max(0, tope - enBolsa) };
    }

    function textoAviso(d) {
        const que = esConjunto ? 'con estas tallas y colores' : 'en esta talla y color';
        if (d.enBolsa > 0 && d.libre === 0) return `Ya tienes en tu bolsa todo lo disponible ${que}.`;
        if (d.enBolsa > 0) return `Solo puedes agregar <b>${d.libre}</b> más: ya tienes ${d.enBolsa} en tu bolsa.`;
        const n = d.tope;
        return esConjunto
            ? `Solo hay <b>${n}</b> ${n === 1 ? 'conjunto disponible' : 'conjuntos disponibles'} ${que}.`
            : `Solo hay <b>${n}</b> ${n === 1 ? 'unidad disponible' : 'unidades disponibles'} ${que}.`;
    }

    /* =====================================================================
       Pintar
       ===================================================================== */
    function opcionesHTML(i) {
        const f = fuentes[i], s = sel[i];
        const colores = f.colores.length ? `<div class="ficha-grupo"><span class="lab">Color <b>${esc(s.color || '')}</b></span>
            <div class="swatches">${f.colores.map(c => `<button type="button" class="sw" data-i="${i}" data-c="${esc(c.nombre)}" title="${esc(c.nombre)}" aria-label="${esc(esConjunto ? f.nombre + ': ' : '')}${esc(c.nombre)}" style="background:${esc(c.hex)}" aria-pressed="${s.color === c.nombre}"${stockDe(f, c.nombre, s.talla) > 0 ? '' : ' disabled'}></button>`).join('')}</div></div>` : '';
        const tallas = f.tallas.length ? `<div class="ficha-grupo"><span class="lab">Talla</span>
            <div class="tallas-ficha">${f.tallas.map(t => `<button type="button" class="talla" data-i="${i}" data-t="${esc(t)}" aria-label="${esc(esConjunto ? f.nombre + ': ' : '')}talla ${esc(t)}" aria-pressed="${s.talla === t}"${stockDe(f, s.color, t) > 0 ? '' : ' disabled'}>${esc(t)}</button>`).join('')}</div></div>` : '';
        return colores + tallas;
    }

    function pintarOpciones(i) {
        const caja = ficha.querySelector(`[data-opciones="${i}"]`);
        if (!caja) return;
        const activo = document.activeElement;
        const clave = activo && activo.dataset && activo.dataset.i === String(i) ? (activo.dataset.c !== undefined ? 'c' + activo.dataset.c : 't' + activo.dataset.t) : null;
        caja.innerHTML = opcionesHTML(i);
        if (clave) {
            const igual = [...caja.querySelectorAll('[data-i]')].find(b => (b.dataset.c !== undefined ? 'c' + b.dataset.c : 't' + b.dataset.t) === clave);
            if (igual && !igual.disabled) igual.focus();
        }
    }

    /** Conjunto: estado del acordeón, resumen y fotos de cada pieza. */
    function pintarPieza(i) {
        const caja = ficha.querySelector(`[data-pieza="${i}"]`);
        if (!caja) return;
        const f = fuentes[i], s = sel[i], abiertaAhora = abierta === i;
        caja.classList.toggle('abierta', abiertaAhora);
        caja.querySelector('.pieza-cab').setAttribute('aria-expanded', String(abiertaAhora));
        caja.querySelector('.pieza-cuerpo').inert = !abiertaAhora;
        caja.querySelector('.pieza-resumen').textContent = [s.color, s.talla].filter(Boolean).join(' · ');
        // Fotos de la pieza (solo para mirar), siempre en el mismo orden.
        // La del color elegido se resalta con un marco fino; no se reordenan.
        const tira = caja.querySelector('[data-tira]');
        if (!tira.children.length) {
            const fotosPieza = [...new Set([f.imagen, ...f.colores.map(c => c.imagen)].filter(Boolean))];
            tira.innerHTML = fotosPieza.map(src => `<span class="foto-pieza" data-src="${esc(src)}"><img src="${esc(src)}" alt="" loading="lazy"></span>`).join('');
        }
        const color = s.color && f.colores.find(c => c.nombre === s.color);
        tira.querySelectorAll('.foto-pieza').forEach(el => el.classList.toggle('activa', !!color && el.dataset.src === color.imagen));
        pintarOpciones(i);
    }

    function pintarCompra() {
        const d = disponible();
        if (d && d.libre > 0 && cantidad > d.libre) { cantidad = d.libre; aviso = textoAviso(d); }
        if (d && d.libre === 0 && !dto.agotado) aviso = textoAviso(d);
        cantidad = Math.max(1, cantidad);

        ficha.querySelector('[data-cantidad]').textContent = cantidad;
        ficha.querySelector('[data-menos]').disabled = cantidad <= 1;
        ficha.querySelector('[data-mas]').disabled = dto.agotado || !d;

        const avisoEl = ficha.querySelector('[data-aviso]');
        if (aviso && avisoEl.innerHTML !== aviso) avisoEl.innerHTML = aviso;   // solo números en el HTML
        avisoEl.hidden = !aviso;

        const boton = ficha.querySelector('[data-agregar]');
        boton.disabled = dto.agotado || !d || d.libre === 0;
        boton.textContent = dto.agotado ? 'Agotado' : 'Agregar a la bolsa';

        const pista = ficha.querySelector('[data-pista]');
        let texto = '';
        if (!dto.agotado && !todas()) {
            if (esConjunto) {
                texto = `Falta elegir color y talla de: ${fuentes.filter((f, i) => !lista(i)).map(f => f.nombre).join(', ')}.`;
            } else {
                const f = fuentes[0], s = sel[0];
                const faltaColor = f.colores.length && !s.color, faltaTalla = f.tallas.length && !s.talla;
                texto = faltaColor && faltaTalla ? 'Elige color y talla.' : faltaColor ? 'Elige un color.' : 'Elige una talla.';
            }
        }
        pista.textContent = texto;
        pista.hidden = !texto;
    }

    function pintarTodo() {
        fuentes.forEach((f, i) => (esConjunto ? pintarPieza(i) : pintarOpciones(i)));
        pintarCompra();
    }

    /** Abre otra pieza sin prisa: primero se pliega la actual y recién después se abre la nueva. */
    function abrir(i) {
        clearTimeout(enCurso);
        const pinta = () => fuentes.forEach((f, k) => pintarPieza(k));
        if (abierta >= 0 && i >= 0 && abierta !== i && !quieto.matches) {
            abierta = -1; pinta();
            enCurso = setTimeout(() => { abierta = i; pinta(); }, CIERRE_MS);
        } else {
            abierta = i; pinta();
        }
    }

    /* =====================================================================
       Eventos
       ===================================================================== */
    ficha.addEventListener('click', e => {
        const cab = e.target.closest('[data-abrir]');
        if (cab) {
            clearTimeout(pasoSiguiente);
            const i = Number(cab.dataset.abrir);
            abrir(abierta === i ? -1 : i);
            return;
        }

        const b = e.target.closest('[data-i]');
        if (b && !b.disabled) {
            const i = Number(b.dataset.i), s = sel[i];
            const antes = lista(i);
            if (b.dataset.c !== undefined) {
                s.color = s.color === b.dataset.c ? null : b.dataset.c;
                // Producto: la foto grande pasa al color elegido
                const color = !esConjunto && s.color && fuentes[0].colores.find(c => c.nombre === s.color);
                if (color) { pausarPase(); mostrarFoto(color.imagen); }
            }
            if (b.dataset.t !== undefined) s.talla = s.talla === b.dataset.t ? null : b.dataset.t;
            aviso = '';
            pintarTodo();

            // Conjunto: pieza completa → se deja ver un momento y pasa a la siguiente que falte
            clearTimeout(pasoSiguiente);
            if (esConjunto && !antes && lista(i)) {
                const siguiente = fuentes.findIndex((f, k) => k !== i && !lista(k));
                pasoSiguiente = setTimeout(() => { if (abierta === i) abrir(siguiente); }, quieto.matches ? 0 : PAUSA_MS);
            }
            return;
        }

        if (e.target.closest('[data-menos]')) {
            cantidad = Math.max(1, cantidad - 1);
            aviso = '';
            pintarCompra();
            return;
        }
        if (e.target.closest('[data-mas]')) {
            const d = disponible();
            if (!d) return;
            // Al pasar lo disponible no se suma: se avisa cuánto hay.
            if (cantidad >= d.libre) aviso = textoAviso(d); else { cantidad += 1; aviso = ''; }
            pintarCompra();
            return;
        }
        if (e.target.closest('[data-agregar]')) agregar();
    });

    function agregar() {
        const d = disponible();
        if (!d) return;
        try {
            const item = C.buildCartItem(dto, seleccion(), cantidad);
            C.buildCartItem(dto, seleccion(), cantidad + d.enBolsa);   // contando lo que ya hay en la bolsa
            Bolsa.add(item);
        } catch (err) {
            aviso = err && err.codigo === 'STOCK_INSUFICIENTE' ? textoAviso(d) : esc((err && err.message) || 'No se pudo agregar a la bolsa.');
            pintarCompra();
            return;
        }
        UI.avisar('Agregado');
        if (UI.latirBolsa) UI.latirBolsa();
        cantidad = 1;
        aviso = '';
        pintarCompra();
    }

    // Si la bolsa cambia (aquí o en otra pestaña), se recalcula lo disponible.
    Bolsa.subscribe(() => pintarCompra());
    pintarTodo();
})();
