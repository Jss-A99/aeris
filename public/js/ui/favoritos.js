/**
 * @file public/js/ui/favoritos.js — AERIS E-commerce
 *
 * Página "Favoritos" (por dentro: wishlist / wish-store):
 *  - Pinta los favoritos guardados en el navegador con sus datos ACTUALES del servidor
 *    (precio, tachado, "Nuevo", agotado). Lo que ya no está publicado queda marcado.
 *  - El marcador de cada tarjeta lo quita (con una salida suave).
 *  - "Agregar a la bolsa" (texto subrayado) abre el selector de color y talla: el vidrio en
 *    computadora, la hoja en celular (tienda.js). En un conjunto: "Ver conjunto".
 *  - "Te puede interesar": oculta lo que ya está en favoritos y deja ver hasta 4.
 *  - Un favorito que ya está en la bolsa SE QUEDA en favoritos y muestra "En tu bolsa"
 *    (o "En tu bolsa · 2" si hay varias unidades/combinaciones). Se actualiza solo.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Wish = window.AerisWishStore;
    const Bolsa = window.AerisBagStore;
    const UI = window.AerisUI;
    const grid = $('favoritos');
    if (!grid || !Wish || !UI) return;

    const esc = UI.esc;
    const soles = (n) => 'S/ ' + Number(n).toFixed(2);
    const SALIDA_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;   // = --r-medio
    const MAX_SUGERENCIAS = 4;
    const ICONO_WISH = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';

    const actuales = {};   // id → ProductDTO actual, o null si ya no está publicado
    let sinConexion = false;

    async function consultar(ids) {
        ids.forEach(id => { if (!(id in actuales) && UI.productos[id]) actuales[id] = UI.productos[id]; });
        const faltan = ids.filter(id => !(id in actuales));
        if (!faltan.length) return;
        try {
            const res = await fetch('/api/bolsa/productos?ids=' + encodeURIComponent(faltan.join(',')), { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(String(res.status));
            const { productos } = await res.json();
            faltan.forEach(id => { actuales[id] = productos[id] || null; });
            Object.assign(UI.productos, productos);        // para el selector y el marcador
            sinConexion = false;
        } catch (e) {
            sinConexion = true;                             // se muestran con lo guardado
        }
    }

    function tarjeta(item) {
        const dto = actuales[item.id];                      // undefined: sin consultar | null: ya no está
        const p = dto || { nombre: item.titulo, precio: item.precio, precioAnterior: null, imagen: item.imagen, url: item.url, tipo: item.tipo, esNuevo: false, agotado: false };
        const id = esc(item.id);
        const noDisponible = dto === null;
        // Si no tenemos sus datos (no está publicado o no hubo conexión), el marcador lo quita directo.
        const marcador = dto
            ? `<button type="button" class="guardar" data-wish="${id}" aria-pressed="true" aria-label="Quitar ${esc(p.nombre)} de favoritos">${ICONO_WISH}</button>`
            : `<button type="button" class="guardar" data-quitar-fav="${id}" aria-pressed="true" aria-label="Quitar ${esc(p.nombre)} de favoritos">${ICONO_WISH}</button>`;

        // Acción en texto subrayado: abre el selector (vidrio / hoja) o lleva al conjunto.
        let accion = '';
        if (!noDisponible && !p.agotado) {
            accion = p.tipo === 'conjunto' || !dto
                ? `<a class="enlace fav-accion" href="${esc(p.url)}">${p.tipo === 'conjunto' ? 'Ver conjunto' : 'Ver prenda'}</a>`
                : `<button type="button" class="enlace fav-accion" data-abrir="${id}" aria-expanded="false">Agregar a la bolsa</button>`;
        }
        const nota = noDisponible ? '<span class="nota">Ya no está disponible</span>'
            : p.agotado ? '<span class="nota">Agotado</span>'
            : p.esNuevo ? '<span class="nota nuevo">Nuevo</span>' : '';

        return `<article class="card fav${noDisponible || p.agotado ? ' agotada' : ''}" data-id="${id}">
            <div class="foto">
                <a href="${esc(p.url)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.imagen)}" alt="" loading="lazy" decoding="async" data-foto></a>
                ${marcador}
            </div>
            <div class="card-texto">
                <div class="fila"><a class="nombre" href="${esc(p.url)}">${esc(p.nombre)}</a></div>
                ${p.tipo === 'conjunto' && dto ? `<span class="nota">Conjunto · ${(dto.piezas || []).length} piezas</span>` : ''}
                <span class="precio">${soles(p.precio)}${p.precioAnterior !== null && p.precioAnterior !== undefined ? `<s>${soles(p.precioAnterior)}</s>` : ''}</span>
                ${nota}
                ${enBolsa(item.id)}
                ${accion}
            </div>
        </article>`;
    }

    /** "En tu bolsa" / "En tu bolsa · N" (unidades de esa prenda o conjunto en la bolsa). */
    function enBolsa(id) {
        if (!Bolsa) return '';
        const n = Bolsa.getItems().filter(it => it.id === id).reduce((s, it) => s + it.cantidad, 0);
        return n ? `<span class="nota en-bolsa">En tu bolsa${n > 1 ? ` · ${n}` : ''}</span>` : '';
    }

    function pintar(items) {
        grid.removeAttribute('aria-busy');
        $('favoritosVacio').hidden = items.length > 0;
        grid.hidden = items.length === 0;
        grid.innerHTML = items.map(tarjeta).join('');
        UI.refrescar(grid);
        pintarSugerencias();
    }

    function pintarSugerencias() {
        const seccion = $('sugerencias');
        if (!seccion) return;
        let visibles = 0;
        seccion.querySelectorAll('.card').forEach(c => {
            const mostrar = !Wish.has(c.dataset.id) && visibles < MAX_SUGERENCIAS;
            if (mostrar) visibles++;
            c.hidden = !mostrar;
        });
        seccion.hidden = visibles === 0;
    }

    let salida = null;
    async function actualizar(items) {
        await consultar(items.map(i => i.id));
        // Las que se quitaron salen con un fundido antes de redibujar.
        const ids = new Set(items.map(i => i.id));
        const quitadas = [...grid.querySelectorAll('.card')].filter(c => !ids.has(c.dataset.id));
        clearTimeout(salida);
        if (quitadas.length && SALIDA_MS) {
            quitadas.forEach(c => c.classList.add('saliendo'));
            salida = setTimeout(() => pintar(Wish.getItems()), SALIDA_MS);
        } else {
            pintar(items);
        }
    }

    grid.addEventListener('click', e => {
        const b = e.target.closest('[data-quitar-fav]');
        if (b) Wish.remove(b.dataset.quitarFav);
    });

    Wish.subscribe(items => { actualizar(items); });
    // Si cambia la bolsa (aquí, en el selector, o en otra pestaña), se actualiza el aviso.
    if (Bolsa) Bolsa.subscribe(() => {
        grid.querySelectorAll('.card').forEach(card => {
            const actual = card.querySelector('.en-bolsa');
            const html = enBolsa(card.dataset.id);
            if (actual) { if (html) actual.outerHTML = html; else actual.remove(); }
            else if (html) {
                const ancla = card.querySelector('.fav-accion');
                if (ancla) ancla.insertAdjacentHTML('beforebegin', html);
                else card.querySelector('.card-texto').insertAdjacentHTML('beforeend', html);
            }
        });
    });
})();
