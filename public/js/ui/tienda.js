/**
 * ============================================================================
 * COMPORTAMIENTO COMÚN DE LA TIENDA — AERIS E-COMMERCE
 * ============================================================================
 * @file public/js/ui/tienda.js
 *
 * Se carga en TODAS las páginas, después de los stores:
 *  - Navbar: vidrio + rubí al hacer scroll, menú de celular.
 *  - Contadores de wishlist y bolsa (escuchan a los stores).
 *  - Botón de wishlist en las tarjetas.
 *  - Selector rápido del "+": vidrio sobre la foto (computadora) u hoja desde abajo
 *    (celular). Agrega 1 unidad a la bolsa y muestra "Agregado".
 *  - Textos que ocupan todo el ancho (AERIS, CATÁLOGO): [data-ajustar].
 *
 * Los datos de los productos llegan en <script type="application/json" data-productos>
 * (un objeto id → ProductDTO). Expone window.AerisUI para los scripts de cada página.
 * ============================================================================
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Contracts = window.AerisContracts;
    const Bolsa = window.AerisBagStore;
    const Wish = window.AerisWishStore;
    const PedidosGuardados = window.AerisPedidosStore;
    const movil = window.matchMedia('(max-width: 640px)');
    const raiz = document.documentElement;

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const soles = (n) => 'S/ ' + Number(n).toFixed(2);
    const svg = (vb, d, extra) => `<svg class="i" viewBox="${vb}" aria-hidden="true">${d}</svg>${extra || ''}`;
    const ICONO = {
        x: svg('0 0 16 16', '<path d="M3 3l10 10M13 3L3 13"/>'),
        wish: svg('0 0 24 24', '<path d="M6 3h12v18l-6-4.5L6 21z"/>'),
        check: svg('0 0 20 20', '<path d="M4 10.5l4 4 8-9"/>')
    };

    /* ---------- Productos de esta página ---------- */
    const productos = {};
    function cargarProductos(raizBusqueda) {
        (raizBusqueda || document).querySelectorAll('script[data-productos]').forEach(s => {
            try { Object.assign(productos, JSON.parse(s.textContent)); } catch (e) { /* JSON roto: sin selector */ }
        });
    }
    cargarProductos();

    /* ---------- Foto que no existe: imagen de reemplazo (nunca un cuadro roto) ---------- */
    const PLACEHOLDER = '/images/placeholder.svg';
    function reemplazar(img) {
        if (img.dataset.sinFoto) return;
        img.dataset.sinFoto = '1';
        img.src = PLACEHOLDER;
    }
    document.addEventListener('error', e => { if (e.target.tagName === 'IMG') reemplazar(e.target); }, true);
    const revisarFotos = (r) => (r || document).querySelectorAll('img').forEach(img => {
        if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) reemplazar(img);
    });
    revisarFotos();

    /* ---------- Bloquear el scroll de fondo (menú, hoja, panel de filtros) ---------- */
    const bloqueos = new Set();
    function bloquearScroll(quien, si) {
        if (si) bloqueos.add(quien); else bloqueos.delete(quien);
        raiz.style.overflow = bloqueos.size ? 'hidden' : '';
    }

    /* ---------- Navbar ---------- */
    const nav = $('nav');
    const pintarNav = () => nav.classList.toggle('glass', window.scrollY > 8);
    window.addEventListener('scroll', pintarNav, { passive: true });
    pintarNav();

    const menuBtn = $('menuBtn'), panelMenu = $('panelMenu');
    // Abre con un fundido y los enlaces entran escalonados; al cerrar se desvanece (no desaparece de golpe).
    let menuAbierto = false, salidaMenu = null;
    function menu(abrir) {
        menuAbierto = abrir;
        clearTimeout(salidaMenu);
        if (abrir) {
            panelMenu.classList.remove('saliendo');
            panelMenu.hidden = false;
        } else {
            panelMenu.classList.add('saliendo');
            salidaMenu = setTimeout(() => { panelMenu.hidden = true; panelMenu.classList.remove('saliendo'); }, SALIDA_MENU_MS);
        }
        nav.classList.toggle('abierto', abrir);
        menuBtn.setAttribute('aria-expanded', String(abrir));
        menuBtn.setAttribute('aria-label', abrir ? 'Cerrar menú' : 'Abrir menú');
        menuBtn.innerHTML = abrir ? svg('0 0 24 24', '<path d="M6 6l12 12M18 6L6 18"/>') : svg('0 0 24 24', '<path d="M4 9h16M4 15h16"/>');
        bloquearScroll('menu', abrir);
    }
    const SALIDA_MENU_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;   // = --r-medio
    menuBtn.addEventListener('click', () => menu(!menuAbierto));
    movil.addEventListener('change', () => { if (menuAbierto) menu(false); });

    /* ---------- Contadores y wishlist ---------- */
    function pintarContador(tipo, n) {
        document.querySelectorAll(`[data-contador="${tipo}"]`).forEach(em => {
            em.hidden = n === 0;
            em.innerHTML = `<span>${n}</span>`;
        });
        document.querySelectorAll(`[data-cuenta="${tipo}"]`).forEach(s => { s.textContent = n; });
    }
    function marcarWish() {
        if (!Wish) return;
        document.querySelectorAll('[data-wish]').forEach(b => b.setAttribute('aria-pressed', String(Wish.has(b.dataset.wish))));
    }
    if (Bolsa) Bolsa.subscribe(() => pintarContador('bolsa', Bolsa.count()));
    if (Wish) Wish.subscribe(items => { pintarContador('wish', items.length); marcarWish(); });
    if (PedidosGuardados) PedidosGuardados.subscribe(items => pintarContador('pedidos', items.length));

    document.addEventListener('click', e => {
        const b = e.target.closest('[data-wish]');
        if (!b || !Wish) return;
        const dto = productos[b.dataset.wish];
        if (dto) Wish.toggle(dto);
    });

    /* ---------- Aviso centrado ---------- */
    function avisar(texto, conCheck) {
        const caja = $('avisoCaja');
        caja.innerHTML = `<div class="aviso">${conCheck === false ? '' : ICONO.check}${esc(texto)}</div>`;
        clearTimeout(avisar.t);
        avisar.t = setTimeout(() => { caja.innerHTML = ''; }, 2300);
    }
    function latirBolsa() {
        const ico = $('icoBolsa');
        ico.classList.remove('latido'); void ico.offsetWidth; ico.classList.add('latido');
    }

    /* ---------- Textos a todo el ancho ---------- */
    // El ajuste vive en views/partials/ajustar-titulos.ejs (en el <head>, antes de pintar).
    const ajustar = () => { if (window.aerisAjustar) window.aerisAjustar(); };

    /* =====================================================================
       SELECTOR RÁPIDO (+)
       ===================================================================== */
    let sel = null; // { id, color, talla, error, modo: 'vidrio'|'hoja', boton, iconoOriginal }

    const stockDe = (dto, color, talla) => dto.variantes
        .filter(v => (!color || v.color === color) && (!talla || v.talla === talla))
        .reduce((s, v) => s + v.stock, 0);
    const listo = (dto) => (dto.colores.length === 0 || sel.color) && (dto.tallas.length === 0 || sel.talla);

    function selectorHTML(dto) {
        const colores = dto.colores.map(c => `<button type="button" class="sw" data-accion="color" data-valor="${esc(c.nombre)}" title="${esc(c.nombre)}" aria-label="${esc(c.nombre)}" style="background:${esc(c.hex)}" aria-pressed="${sel.color === c.nombre}"${stockDe(dto, c.nombre, sel.talla) > 0 ? '' : ' disabled'}></button>`).join('');
        const tallas = dto.tallas.map(t => `<button type="button" class="talla" data-accion="talla" data-valor="${esc(t)}" aria-pressed="${sel.talla === t}"${stockDe(dto, sel.color, t) > 0 ? '' : ' disabled'}>${esc(t)}</button>`).join('');
        return `<div class="selector">
            ${dto.colores.length ? `<div class="sel-grupo"><span class="sel-lab">Elige un color${sel.color ? `: <b>${esc(sel.color)}</b>` : ''}</span><div class="swatches">${colores}</div></div>` : ''}
            ${dto.tallas.length ? `<div class="sel-grupo"><span class="sel-lab">Elige una talla</span><div class="tallas">${tallas}</div></div>` : ''}
            ${sel.error ? `<p class="sel-error" role="alert">${esc(sel.error)}</p>` : ''}
            <button type="button" class="agregar" data-accion="agregar"${listo(dto) ? '' : ' disabled'}>Agregar a la bolsa</button>
        </div>`;
    }

    function hojaHTML(dto) {
        const fotosSolas = (dto.galeria && dto.galeria.length ? dto.galeria : [dto.imagen]).slice(0, 3);
        const tira = dto.colores.length > 1
            ? `<div class="tira">${dto.colores.map(c =>
                `<button type="button" data-accion="color" data-valor="${esc(c.nombre)}" aria-label="Foto en ${esc(c.nombre)}" aria-pressed="${sel.color === c.nombre}"${stockDe(dto, c.nombre, sel.talla) > 0 ? '' : ' disabled'}><img src="${esc(c.imagen)}" alt=""></button>`).join('')}</div>`
            : `<div class="tira${fotosSolas.length === 1 ? ' una' : ''}">${fotosSolas.map(src => `<span class="foto-sola"><img src="${esc(src)}" alt=""></span>`).join('')}</div>`;
        return `<div class="hoja-cab">
                <button type="button" class="guardar" data-wish="${esc(dto.id)}" aria-pressed="false" aria-label="Guardar ${esc(dto.nombre)} en favoritos">${ICONO.wish}</button>
                <div><strong>${esc(dto.nombre)}</strong><span>${soles(dto.precio)}</span></div>
                <button type="button" class="cerrar" data-accion="cerrar" aria-label="Cerrar">${ICONO.x}</button>
            </div>${tira}${selectorHTML(dto)}`;
    }

    function fotoDeCard(dto) {
        const card = document.querySelector(`.card[data-id="${CSS.escape(dto.id)}"]`);
        return card ? card.querySelector('[data-foto]') : null;
    }

    function pintar() {
        if (!sel) return;
        const dto = productos[sel.id];
        // Recordar qué control tenía el foco para devolverlo tras redibujar.
        const activo = document.activeElement;
        const clave = activo && activo.dataset ? `${activo.dataset.accion}|${activo.dataset.valor}` : null;

        let contenedor;
        if (sel.modo === 'hoja') {
            contenedor = $('hoja');
            contenedor.innerHTML = hojaHTML(dto);
        } else {
            contenedor = sel.boton.closest('.card').querySelector('.vidrio:not(.saliendo)');
            contenedor.innerHTML = selectorHTML(dto);
        }
        const foto = fotoDeCard(dto);
        const color = sel.color && dto.colores.find(c => c.nombre === sel.color);
        if (foto && !foto.dataset.sinFoto) foto.src = color ? color.imagen : dto.imagen;
        marcarWish();

        if (clave) {
            const igual = [...contenedor.querySelectorAll('[data-accion]')]
                .find(b => `${b.dataset.accion}|${b.dataset.valor}` === clave && !b.disabled);
            if (igual) igual.focus();
        }
    }

    function abrir(boton) {
        cerrar();
        const dto = productos[boton.dataset.abrir];
        if (!dto || !Contracts || !Bolsa) return;

        const conStock = dto.colores.filter(c => stockDe(dto, c.nombre, null) > 0);
        sel = {
            id: dto.id,
            color: conStock.length === 1 && dto.colores.length === 1 ? conStock[0].nombre : null,   // un solo color: ya elegido
            talla: null,
            error: null,
            modo: movil.matches ? 'hoja' : 'vidrio',
            boton,
            iconoOriginal: boton.innerHTML
        };

        if (sel.modo === 'hoja') {
            clearTimeout(salidaHoja);
            $('capa').classList.remove('saliendo');
            $('capa').hidden = false;
            bloquearScroll('hoja', true);
            pintar();
            const x = $('hoja').querySelector('.cerrar');
            if (x) x.focus();
        } else {
            const vidrio = document.createElement('div');
            vidrio.className = 'vidrio';
            boton.closest('.card').querySelector('.foto').appendChild(vidrio);
            boton.setAttribute('aria-expanded', 'true');
            if (boton.classList.contains('mas')) {          // "+" de la tarjeta → "×"
                boton.setAttribute('aria-label', 'Cerrar selector');
                boton.innerHTML = ICONO.x;
            } else {                                        // botón con texto (favoritos) → "Cerrar"
                boton.textContent = 'Cerrar';
            }
            pintar();
        }
    }

    // Al cerrar, el vidrio y la hoja salen con una animación suave (no desaparecen de golpe).
    const SALIDA_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;   // = --r-medio
    let salidaHoja = null;

    function cerrar(devolverFoco) {
        if (!sel) return;
        const { boton, modo, iconoOriginal, id } = sel;
        const dto = productos[id];
        if (modo === 'hoja') {
            const capa = $('capa');
            capa.classList.add('saliendo');
            bloquearScroll('hoja', false);
            clearTimeout(salidaHoja);
            salidaHoja = setTimeout(() => {
                capa.hidden = true;
                capa.classList.remove('saliendo');
                $('hoja').innerHTML = '';
            }, SALIDA_MS);
        } else {
            const vidrio = boton.closest('.card').querySelector('.vidrio:not(.saliendo)');
            if (vidrio) {
                vidrio.classList.add('saliendo');
                setTimeout(() => vidrio.remove(), SALIDA_MS);
            }
        }
        boton.setAttribute('aria-expanded', 'false');
        if (boton.classList.contains('mas')) boton.setAttribute('aria-label', `Elegir color y talla de ${dto.nombre}`);
        boton.innerHTML = iconoOriginal;
        const foto = fotoDeCard(dto);
        if (foto && !foto.dataset.sinFoto) foto.src = dto.imagen;
        sel = null;
        if (devolverFoco) boton.focus();
    }

    function agregar() {
        const dto = productos[sel.id];
        const eleccion = { color: sel.color, talla: sel.talla };
        try {
            const item = Contracts.buildCartItem(dto, eleccion, 1);
            // El stock se valida contando lo que ya está en la bolsa.
            Contracts.buildCartItem(dto, eleccion, Bolsa.cantidadDe(item.key) + 1);
            Bolsa.add(item);
        } catch (err) {
            sel.error = err && err.codigo === 'STOCK_INSUFICIENTE'
                ? 'Ya tienes en tu bolsa todas las unidades disponibles de esta talla y color.'
                : (err && err.message) || 'No se pudo agregar a la bolsa.';
            pintar();
            return;
        }
        cerrar(true);
        avisar('Agregado');
        latirBolsa();
    }

    document.addEventListener('click', e => {
        const abrirBtn = e.target.closest('[data-abrir]');
        if (abrirBtn) {
            if (sel && sel.boton === abrirBtn) cerrar(true); else abrir(abrirBtn);
            return;
        }
        if (e.target === $('capa')) { cerrar(true); return; }
        if (!sel) return;
        const b = e.target.closest('.vidrio [data-accion], .hoja [data-accion]');
        if (!b || b.disabled) return;
        const accion = b.dataset.accion;
        if (accion === 'cerrar') cerrar(true);
        else if (accion === 'color') { sel.color = sel.color === b.dataset.valor ? null : b.dataset.valor; sel.error = null; pintar(); }
        else if (accion === 'talla') { sel.talla = sel.talla === b.dataset.valor ? null : b.dataset.valor; sel.error = null; pintar(); }
        else if (accion === 'agregar') agregar();
    });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (sel) cerrar(true);
        else if (menuAbierto) { menu(false); menuBtn.focus(); }
    });
    movil.addEventListener('change', () => cerrar());

    /** Tras reemplazar parte de la página: leer sus productos, marcar wishlist y revisar fotos. */
    function refrescar(raizNueva) { cerrar(); cargarProductos(raizNueva); marcarWish(); revisarFotos(raizNueva); }

    window.AerisUI = { productos, avisar, latirBolsa, ajustar, bloquearScroll, esc, refrescar, haySelectorAbierto: () => !!sel };
})();
