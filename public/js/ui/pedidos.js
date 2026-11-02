/**
 * @file public/js/ui/pedidos.js — AERIS E-commerce
 *
 * Página "Pedidos": pinta los pedidos guardados en este navegador (core/pedidos-store.js).
 *  - Cada pedido es una fila que se abre con + (el más reciente, abierto).
 *  - Única marca: "Enviado por WhatsApp". Si un pedido no se envió (WhatsApp no llegó a abrirse),
 *    en ese lugar va el botón rubí "Enviar pedido"; al tocarlo, abre WhatsApp y queda marcado.
 *  - Al abrir un pedido: sus artículos, la entrega y los totales (solo lectura).
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Pedidos = window.AerisPedidosStore;
    const P = window.AerisPedido;
    const UI = window.AerisUI;
    if (!Pedidos || !P || !UI || !$('pedidos')) return;

    const esc = UI.esc;
    const soles = (n) => 'S/ ' + Number(n).toFixed(2);
    let datos = {};
    try { datos = JSON.parse($('datos-pedidos').textContent); } catch (e) { /* sin número */ }
    const WA = ($('iconoWA') && $('iconoWA').innerHTML) || '';
    const CHECK = '<svg class="i" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>';
    const MAS = '<svg class="i ped-mas" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h14"/><path class="v" d="M8 1v14"/></svg>';
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

    let abierto = null;   // id del pedido abierto (al cargar: el más reciente)

    function fecha(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const dos = (n) => String(n).padStart(2, '0');
        return `${dos(d.getDate())} ${MESES[d.getMonth()]} ${d.getFullYear()} · ${dos(d.getHours())}:${dos(d.getMinutes())}`;
    }
    const unidades = (p) => p.lineas.reduce((s, l) => s + l.cantidad, 0);
    const conEnvioAparte = (p) => p.entrega === 'provincia' || (p.entrega === 'lima' && !p.envioGratis);
    const titulo = (p) => p.codigo || 'Pedido';

    function opcionesHTML(l) {
        if (l.componentes && l.componentes.length) {
            return l.componentes.map(c => `<span>${esc(c.nombre)}: ${esc([c.color, c.talla].filter(Boolean).join(' · '))}</span>`).join('');
        }
        return (l.color ? `<span>Color: ${esc(l.color)}</span>` : '') + (l.talla ? `<span>Talla: ${esc(l.talla)}</span>` : '');
    }

    function lineaHTML(l) {
        const foto = l.imagen ? `<img src="${esc(l.imagen)}" alt="">` : '';
        const nombre = l.url ? `<a class="l-nombre" href="${esc(l.url)}">${esc(l.titulo)}</a>` : `<span class="l-nombre">${esc(l.titulo)}</span>`;
        return `<div class="linea de-pedido">
            ${l.url ? `<a class="l-foto" href="${esc(l.url)}" tabindex="-1" aria-hidden="true">${foto}</a>` : `<span class="l-foto">${foto}</span>`}
            ${nombre}
            <span class="l-precio">${soles(l.precio * l.cantidad)}${l.cantidad > 1 ? `<small>${l.cantidad} × ${soles(l.precio)}</small>` : ''}</span>
            <div class="l-opciones">${opcionesHTML(l)}</div>
        </div>`;
    }

    function pedidoHTML(p) {
        const abiertoAqui = p.id === abierto;
        const id = esc(p.id);
        const n = unidades(p);
        const entrega = (datos.entrega && datos.entrega[p.entrega]) || {};
        const envio = p.entrega === 'recojo' || (p.entrega === 'lima' && p.envioGratis) ? 'Gratis' : 'Por coordinar';
        const total = soles(p.totales.total) + (conEnvioAparte(p) ? ' + envío' : '');
        const marca = p.enviado
            ? `<span class="enviado">${CHECK}Enviado por WhatsApp</span>`
            : `<button type="button" class="btn btn-wa compacto" data-enviar="${id}">${WA}Enviar pedido</button>`;
        return `<article class="pedido${abiertoAqui ? ' abierto' : ''}">
            <div class="ped-cab">
                <button type="button" class="ped-toggle" data-abrir-pedido="${id}" aria-expanded="${abiertoAqui}" aria-controls="ped-${id}"
                    aria-label="${esc(titulo(p))}, ${esc(fecha(p.fecha))}, ${esc(total)}"></button>
                <span class="cod">${esc(titulo(p))}</span>
                <span class="fecha">${esc(fecha(p.fecha))} · ${n} ${n === 1 ? 'artículo' : 'artículos'}</span>
                <span class="marca">${marca}</span>
                <span class="tot">${soles(p.totales.total)}</span>${MAS}
            </div>
            <div class="ped-cuerpo" id="ped-${id}"${abiertoAqui ? '' : ' inert'}><div class="ped-interior">
                ${p.lineas.map(lineaHTML).join('')}
                <div class="ped-resumen">
                    <div class="grupo">
                        <span class="grupo-titulo">Entrega</span>
                        <span>${esc(entrega.titulo || '')}</span>
                    </div>
                    <div class="res-totales">
                        <dl class="totales">
                            <div><dt>Subtotal</dt><dd>${soles(p.totales.subtotal)}</dd></div>
                            ${p.promo ? `<div><dt>Descuento <span>${esc(p.promo.codigo)}</span></dt><dd>-${soles(p.totales.descuento)}</dd></div>` : ''}
                            <div><dt>Envío</dt><dd>${envio}</dd></div>
                            <div class="total"><dt>Total</dt><dd>${esc(total)}</dd></div>
                        </dl>
                    </div>
                </div>
            </div></div>
        </article>`;
    }

    function pintar(lista) {
        $('pedidosVacio').hidden = lista.length > 0;
        if (abierto === null && lista.length) abierto = lista[0].id;
        $('pedidos').innerHTML = lista.map(pedidoHTML).join('');
        UI.refrescar($('pedidos'));   // fotos que ya no existen → reemplazo
    }

    /* ---------- Enviar pedido (abre WhatsApp y lo marca enviado) ---------- */
    function enviar(p) {
        const enlace = P.enlaceWhatsApp(datos.whatsapp, p.mensaje);
        if (!enlace) { UI.avisar('Falta el número de WhatsApp de la tienda', false); return; }
        if (!p.enviado) Pedidos.marcarEnviado(p.id);
        const ventana = window.open('', '_blank');
        if (ventana) {
            ventana.opener = null;
            ventana.location.href = enlace;
        } else {
            window.location.href = enlace;
        }
    }

    $('pedidos').addEventListener('click', e => {
        const lista = Pedidos.getItems();
        const buscar = (id) => lista.find(x => x.id === id);

        const t = e.target.closest('[data-abrir-pedido]');
        if (t) {
            const id = t.dataset.abrirPedido;
            abierto = abierto === id ? '' : id;
            const art = t.closest('.pedido');
            // Solo se cambia la clase (no se vuelve a pintar) para que el acordeón se mueva suave
            $('pedidos').querySelectorAll('.pedido').forEach(x => {
                const es = x === art && abierto === id;
                x.classList.toggle('abierto', es);
                x.querySelector('.ped-toggle').setAttribute('aria-expanded', String(es));
                const c = x.querySelector('.ped-cuerpo');
                if (es) c.removeAttribute('inert'); else c.setAttribute('inert', '');
            });
            return;
        }
        const env = e.target.closest('[data-enviar]');
        if (env) { const p = buscar(env.dataset.enviar); if (p) enviar(p); }
    });

    Pedidos.subscribe(pintar);
})();
