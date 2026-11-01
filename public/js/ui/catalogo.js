/**
 * @file public/js/ui/catalogo.js — AERIS E-commerce
 *
 * 1. Navegación sin recargar: pestañas, filtros activos, paginación y "Ver resultados"
 *    piden la página nueva al servidor y reemplazan SOLO #catalogoVivo (sin salto visual).
 *    La URL cambia igual (se puede compartir, y atrás/adelante funcionan). Si algo falla,
 *    se abre la página de forma normal.
 * 2. Panel de filtros: abrir/cerrar, acordeones, barra de precio y conteo en vivo con las
 *    MISMAS reglas que usa el servidor (core/catalog-query.js).
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Q = window.AerisCatalogQuery;
    const UI = window.AerisUI;
    const vivo = $('catalogoVivo');
    if (!vivo || !Q || !UI) return;

    const soles = (n) => 'S/ ' + Number(n).toFixed(2);
    const solesCorto = (n) => 'S/ ' + Math.round(n);

    let panel = null;   // { abierto(), cerrar() } del contenido actual

    /* =====================================================================
       Panel de filtros (se vuelve a enlazar cada vez que cambia el contenido)
       ===================================================================== */
    function iniciarPanel() {
        const form = $('filtros');
        let datos;
        try { datos = JSON.parse($('datos-filtro').textContent); } catch (e) { panel = null; return; }
        const { filtros, productos } = datos;
        const pMin = $('pMin'), pMax = $('pMax');
        const boton = $('btnFiltros'), velo = $('velo');

        function estadoDelForm() {
            const marcados = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
            return Q.parsear({
                categoria: datos.categoria,
                orden: marcados('orden')[0],
                talla: marcados('talla'),
                color: marcados('color'),
                min: pMin.value,
                max: pMax.value
            }, filtros);
        }

        function actualizar() {
            const e = estadoDelForm();
            $('fVer').textContent = `Ver resultados (${productos.filter(p => Q.cumple(p, e)).length})`;
            const n = Q.nActivos(e, filtros);
            const limpiar = $('fLimpiar');
            limpiar.textContent = `Eliminar filtros (${n})`;
            limpiar.setAttribute('aria-disabled', String(n === 0));

            const orden = Q.ORDENES.find(o => o.id === e.orden);
            form.querySelector('[data-resumen="orden"]').textContent = orden ? orden.nombre : '';
            form.querySelector('[data-resumen="talla"]').textContent = e.tallas.join(', ');
            form.querySelector('[data-resumen="color"]').textContent = e.colores
                .map(id => (filtros.familiasColor.find(f => f.id === id) || {}).nombre).join(', ');
            form.querySelector('[data-resumen="precio"]').textContent = Q.precioActivo(e, filtros)
                ? `${solesCorto(e.min)} – ${solesCorto(e.max)}` : '';

            const rango = (filtros.precio.max - filtros.precio.min) || 1;
            const pct = (v) => (v - filtros.precio.min) / rango;
            const riel = $('rielSel');
            riel.style.left = `calc(${pct(e.min)} * (100% - 16px) + 8px)`;
            riel.style.right = `calc(${1 - pct(e.max)} * (100% - 16px) + 8px)`;
            $('pMinTxt').textContent = soles(e.min);
            $('pMaxTxt').textContent = soles(e.max);
        }

        function abrir() {
            form.hidden = false; velo.hidden = false;
            boton.setAttribute('aria-expanded', 'true');
            UI.bloquearScroll('filtros', true);
            $('fCerrar').focus();
        }
        function cerrar(devolverFoco = true) {
            form.hidden = true; velo.hidden = true;
            boton.setAttribute('aria-expanded', 'false');
            UI.bloquearScroll('filtros', false);
            if (devolverFoco) boton.focus();
        }
        boton.addEventListener('click', abrir);
        $('fCerrar').addEventListener('click', () => cerrar());
        velo.addEventListener('click', () => cerrar());

        form.querySelectorAll('.acc-cab').forEach(cab => {
            cab.addEventListener('click', () => {
                const abrirlo = cab.getAttribute('aria-expanded') !== 'true';
                cab.setAttribute('aria-expanded', String(abrirlo));
                $(cab.getAttribute('aria-controls')).hidden = !abrirlo;
            });
        });

        // Ordenar: tocar la opción ya marcada la desmarca.
        form.querySelectorAll('input[name="orden"]').forEach(r => {
            const label = r.closest('label');
            label.addEventListener('pointerdown', () => { r.dataset.estaba = String(r.checked); });
            label.addEventListener('click', ev => {
                if (ev.target !== r) return;
                if (r.dataset.estaba === 'true') { r.checked = false; actualizar(); }
                r.dataset.estaba = 'false';
            });
        });

        // Precio: los tiradores no se cruzan.
        pMin.addEventListener('input', () => { if (+pMin.value > +pMax.value) pMin.value = pMax.value; });
        pMax.addEventListener('input', () => { if (+pMax.value < +pMin.value) pMax.value = pMin.value; });

        form.addEventListener('input', actualizar);
        form.addEventListener('change', actualizar);
        form.addEventListener('submit', e => {
            e.preventDefault();
            const url = '/catalogo' + Q.aQuery(estadoDelForm(), filtros);
            cerrar(false);
            navegar(url, { push: true, subir: true });
        });

        actualizar();
        panel = { abierto: () => !form.hidden, cerrar };
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && panel && panel.abierto() && !UI.haySelectorAbierto()) panel.cerrar();
    });

    /* =====================================================================
       Navegación sin recargar
       ===================================================================== */
    let pedido = 0;   // si llegan dos clics seguidos, solo vale el último

    async function navegar(url, { push, subir }) {
        const mio = ++pedido;
        vivo.classList.add('cargando');
        vivo.setAttribute('aria-busy', 'true');
        try {
            const res = await fetch(url, { headers: { Accept: 'text/html' } });
            if (!res.ok) throw new Error(String(res.status));
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const nuevo = doc.getElementById('catalogoVivo');
            if (!nuevo) throw new Error('sin contenido');
            if (mio !== pedido) return;

            UI.bloquearScroll('filtros', false);
            const cambiar = () => {
                vivo.innerHTML = nuevo.innerHTML;
                document.title = doc.title;
                if (push) history.pushState({ catalogo: true }, '', url);
                UI.refrescar(vivo);
                iniciarPanel();
            };
            // Fundido corto entre listas (si el navegador lo soporta y no se pidió reducir animaciones)
            if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                await document.startViewTransition(cambiar).updateCallbackDone;
            } else {
                cambiar();
            }

            // Si la lista quedó más arriba de lo que se está viendo, subir hasta la barra.
            if (subir) {
                const altoNav = document.getElementById('nav').offsetHeight;
                const tope = vivo.getBoundingClientRect().top + window.scrollY - altoNav;
                if (window.scrollY > tope) window.scrollTo({ top: tope });
            }
        } catch (e) {
            window.location.href = url;   // plan B: carga normal
        } finally {
            if (mio === pedido) {
                vivo.classList.remove('cargando');
                vivo.removeAttribute('aria-busy');
            }
        }
    }

    vivo.addEventListener('click', e => {
        const a = e.target.closest('a[href^="/catalogo"]');
        if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (panel && panel.abierto()) panel.cerrar(false);
        navegar(a.getAttribute('href'), { push: true, subir: true });
    });

    window.addEventListener('popstate', () => {
        if (location.pathname === '/catalogo') navegar(location.pathname + location.search, { push: false, subir: false });
    });
    history.replaceState({ catalogo: true }, '', location.href);

    iniciarPanel();
})();
