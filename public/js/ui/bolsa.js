/**
 * @file public/js/ui/bolsa.js — AERIS E-commerce
 *
 * Página "Tu bolsa":
 *  - Pinta las líneas de bag-store y se actualiza con cada cambio (también desde otra pestaña).
 *  - Pide al servidor el precio y el stock ACTUALES de esos productos: el + se apaga al llegar
 *    al stock, una cantidad mayor que el stock se ajusta, y lo agotado o despublicado queda
 *    marcado y fuera del pedido.
 *  - Código promocional (lo valida el servidor), entrega (recojo / Lima / provincia) y totales.
 *  - Envío gratis en Lima: aviso con barra solo cuando falta poco (config/tienda.js → envio).
 *  - "Enviar pedido": registra el pedido en la tienda (código AER-0042, sin tocar el stock)
 *    y abre WhatsApp con el pedido escrito (core/pedido.js). Si la tienda no responde, igual
 *    abre WhatsApp con el pedido, sin código, para no perder la venta.
 *    El pedido se guarda en "Pedidos" (core/pedidos-store.js) marcado como enviado, la bolsa
 *    se vacía y esta pestaña pasa a /pedidos.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const C = window.AerisContracts;
    const Bolsa = window.AerisBagStore;
    const P = window.AerisPedido;
    const UI = window.AerisUI;
    if (!C || !Bolsa || !P || !UI || !$('lineas')) return;

    const esc = UI.esc;
    const soles = (n) => 'S/ ' + Number(n).toFixed(2);
    let datos = {};
    try { datos = JSON.parse($('datos-bolsa').textContent); } catch (e) { /* sin número */ }

    const productos = {};          // id → ProductDTO actual (o null si ya no existe)
    let sinConexion = false;       // no se pudo revisar stock: se confía en lo guardado
    let entrega = null;            // 'recojo' | 'lima' | 'provincia'
    let promo = null;              // { codigo, descuento, etiqueta } validado para el subtotal actual
    let promoSubtotal = 0;
    const ajustes = new Map();     // key → aviso de cantidad ajustada

    /* ---------- Datos actuales del servidor ---------- */
    async function consultar(items) {
        const faltan = [...new Set(items.map(i => i.id))].filter(id => !(id in productos));
        if (!faltan.length) return;
        try {
            const res = await fetch('/api/bolsa/productos?ids=' + encodeURIComponent(faltan.join(',')), { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(String(res.status));
            const json = await res.json();
            faltan.forEach(id => { productos[id] = json.productos[id] || null; });
            sinConexion = false;
        } catch (e) {
            sinConexion = true;
        }
    }

    const seleccionDe = (item) => (item.tipo === 'conjunto'
        ? { componentes: item.componentes.map(c => ({ id: c.id, color: c.color, talla: c.talla })) }
        : { color: item.color, talla: item.talla });

    /** ¿Se puede pedir esta línea con `n` unidades? Usa las mismas reglas que al agregar. */
    function valida(dto, item, n) {
        try { C.buildCartItem(dto, seleccionDe(item), n); return null; } catch (e) { return e; }
    }

    /** { ok, precio, puedeMas, motivo?, max? } */
    function evaluar(item) {
        if (!(item.id in productos) || sinConexion) return { ok: true, precio: item.precio, puedeMas: true };
        const dto = productos[item.id];
        if (!dto) return { ok: false, motivo: 'Ya no está disponible.' };
        const err = valida(dto, item, item.cantidad);
        if (err && err.codigo === 'STOCK_INSUFICIENTE') {
            let max = item.cantidad - 1;
            while (max > 0 && valida(dto, item, max)) max--;
            return max > 0 ? { ok: true, precio: dto.precio, puedeMas: false, max } : { ok: false, motivo: 'Se agotó en esta talla y color.' };
        }
        if (err) return { ok: false, motivo: err.codigo === 'SIN_STOCK' ? 'Se agotó en esta talla y color.' : 'Esta combinación ya no está disponible.' };
        return { ok: true, precio: dto.precio, puedeMas: !valida(dto, item, item.cantidad + 1) };
    }

    /* ---------- Pintar ---------- */
    function opcionesHTML(item) {
        if (item.tipo === 'conjunto') {
            return item.componentes.map(c => `<span>${esc(c.nombre)}: ${esc([c.color, c.talla].filter(Boolean).join(' · '))}</span>`).join('');
        }
        return (item.color ? `<span>Color: ${esc(item.color)}</span>` : '') + (item.talla ? `<span>Talla: ${esc(item.talla)}</span>` : '');
    }

    function lineaHTML(item, ev) {
        const precio = ev.ok ? ev.precio : item.precio;
        const aviso = !ev.ok ? ev.motivo : ajustes.get(item.key);
        const k = esc(item.key);
        return `<article class="linea${ev.ok ? '' : ' no-disponible'}">
            <a class="l-foto" href="${esc(item.url)}" tabindex="-1" aria-hidden="true"><img src="${esc(item.imagen)}" alt=""></a>
            <a class="l-nombre" href="${esc(item.url)}">${esc(item.titulo)}</a>
            <span class="l-precio">${soles(precio * item.cantidad)}${item.cantidad > 1 ? `<small>${item.cantidad} × ${soles(precio)}</small>` : ''}</span>
            <div class="l-opciones">${opcionesHTML(item)}${aviso ? `<span class="l-aviso">${esc(aviso)}</span>` : ''}</div>
            <button type="button" class="l-quitar" data-quitar="${k}" aria-label="Eliminar ${esc(item.titulo)}">Eliminar</button>
            ${ev.ok ? `<div class="cantidad" role="group" aria-label="Cantidad de ${esc(item.titulo)}">
                <button type="button" data-menos="${k}" aria-label="Quitar una unidad"${item.cantidad <= 1 ? ' disabled' : ''}>−</button>
                <span aria-live="polite">${item.cantidad}</span>
                <button type="button" data-mas="${k}" aria-label="Agregar una unidad"${ev.puedeMas ? '' : ' disabled'}>+</button>
            </div>` : ''}
        </article>`;
    }

    let lineasPedido = [];
    let itemsPedido = [];          // los CartItem disponibles, para registrar el pedido
    let envioEsGratis = false;

    function pintar() {
        const items = Bolsa.getItems();
        const lineas = $('lineas');
        lineas.removeAttribute('aria-busy');
        $('bolsaVacia').hidden = items.length > 0;
        $('resumen').hidden = items.length === 0;
        if (!items.length) { lineas.innerHTML = ''; return; }

        // Cantidades por encima del stock: se ajustan (una vez) y se avisa en la línea.
        const evaluaciones = items.map(evaluar);
        let ajusto = false;
        items.forEach((it, i) => {
            const ev = evaluaciones[i];
            if (ev.ok && ev.max) {
                ajustes.set(it.key, `Ajustamos la cantidad: solo quedan ${ev.max}.`);
                Bolsa.setCantidad(it.key, ev.max);
                ajusto = true;
            }
        });
        if (ajusto) return;   // setCantidad vuelve a llamar a pintar()

        lineas.innerHTML = (sinConexion ? '<p class="bolsa-nota">No pudimos revisar el stock ahora. Lo confirmamos por WhatsApp.</p>' : '')
            + items.map((it, i) => lineaHTML(it, evaluaciones[i])).join('');
        UI.refrescar(lineas);

        itemsPedido = items.filter((it, i) => evaluaciones[i].ok);
        lineasPedido = items
            .map((it, i) => ({ it, ev: evaluaciones[i] }))
            .filter(x => x.ev.ok)
            .map(({ it, ev }) => ({
                titulo: it.titulo, precio: ev.precio, cantidad: it.cantidad,
                color: it.color, talla: it.talla, componentes: it.tipo === 'conjunto' ? it.componentes : []
            }));
        pintarTotales();
    }

    function pintarTotales() {
        const base = P.totales(lineasPedido, 0);
        // Si cambió el subtotal, el descuento se vuelve a validar (puede dejar de cumplir el mínimo).
        if (promo && base.subtotal !== promoSubtotal) { promoSubtotal = base.subtotal; aplicarPromo(promo.codigo, true); }

        const t = P.totales(lineasPedido, promo ? promo.descuento : 0);
        const envio = P.envioGratis(t.total, datos.envio);
        const sinCostoFijo = entrega === 'recojo' || (entrega === 'lima' && envio.gratis);

        // Aviso de envío gratis (solo cuando ya es gratis o falta poco)
        $('envioGratis').hidden = !envio.avisar;
        if (envio.avisar) {
            $('avanceRelleno').style.width = (envio.avance * 100) + '%';
            $('envioGratisTexto').textContent = envio.gratis
                ? 'Tu envío en Lima es gratis.'
                : `Te faltan ${soles(envio.falta)} para el envío gratis.`;
        }
        // La opción "Envío en Lima" cambia su descripción al alcanzar el envío gratis
        const lima = datos.entrega && datos.entrega.lima;
        const detalleLima = document.querySelector('[data-detalle="lima"]');
        if (lima && detalleLima) detalleLima.textContent = envio.gratis && lima.detalleGratis ? lima.detalleGratis : lima.detalle;

        $('tSubtotal').textContent = soles(t.subtotal);
        $('filaDesc').hidden = !(promo && t.descuento > 0);
        if (promo) {
            $('tCodigo').textContent = promo.codigo;
            $('tDesc').textContent = '-' + soles(t.descuento);
        }
        $('tEnvio').textContent = !entrega ? 'Elige una opción' : sinCostoFijo ? 'Gratis' : 'Por coordinar';
        $('tTotal').textContent = soles(t.total) + (entrega && !sinCostoFijo ? ' + envío' : '');
        envioEsGratis = envio.gratis;
        $('finalizar').disabled = lineasPedido.length === 0;
    }

    async function actualizar() {
        await consultar(Bolsa.getItems());
        pintar();
    }

    /* ---------- Cantidades y eliminar ---------- */
    $('lineas').addEventListener('click', e => {
        const b = e.target.closest('[data-quitar], [data-menos], [data-mas]');
        if (!b || b.disabled) return;
        const key = b.dataset.quitar || b.dataset.menos || b.dataset.mas;
        ajustes.delete(key);
        if (b.dataset.quitar) { Bolsa.remove(key); return; }
        const actual = Bolsa.cantidadDe(key);
        Bolsa.setCantidad(key, b.dataset.mas ? actual + 1 : Math.max(1, actual - 1));
        const igual = $('lineas').querySelector(`[data-${b.dataset.mas ? 'mas' : 'menos'}="${CSS.escape(key)}"]`);
        if (igual && !igual.disabled) igual.focus();
    });

    /* ---------- Entrega ---------- */
    document.querySelectorAll('input[name="entrega"]').forEach(r => {
        r.addEventListener('change', () => {
            entrega = r.value;
            $('avisoEntrega').hidden = true;
            pintarTotales();
        });
    });

    /* ---------- Código promocional ---------- */
    function mostrarPromo(mensaje, esError) {
        const msg = $('promoMsg');
        msg.textContent = mensaje || '';
        msg.classList.toggle('error', !!esError);
        $('promoFila').hidden = !!promo;
        const aplicado = $('promoAplicado');
        aplicado.hidden = !promo;
        aplicado.innerHTML = promo
            ? `<span class="chip">${esc(promo.codigo)} · ${esc(promo.etiqueta)}<button type="button" id="quitarPromo" aria-label="Quitar código ${esc(promo.codigo)}">✕</button></span>`
            : '';
    }

    async function aplicarPromo(codigo, silencioso) {
        const subtotal = P.totales(lineasPedido, 0).subtotal;
        try {
            const res = await fetch(`/api/promo?codigo=${encodeURIComponent(codigo)}&subtotal=${subtotal}`, { headers: { Accept: 'application/json' } });
            const r = await res.json();
            if (r.ok) {
                promo = { codigo: r.codigo, descuento: r.descuento, etiqueta: r.etiqueta };
                promoSubtotal = subtotal;
                mostrarPromo(silencioso ? '' : 'Código aplicado.');
            } else {
                promo = null;
                mostrarPromo(r.mensaje, true);
            }
        } catch (e) {
            if (!silencioso) mostrarPromo('No pudimos revisar el código. Inténtalo de nuevo.', true);
        }
        pintarTotales();
    }

    $('formPromo').addEventListener('submit', e => {
        e.preventDefault();
        const codigo = $('codigo').value.trim();
        if (!codigo) { mostrarPromo('Escribe un código.', true); return; }
        aplicarPromo(codigo, false);
    });
    $('promoAplicado').addEventListener('click', e => {
        if (!e.target.closest('#quitarPromo')) return;
        promo = null;
        $('codigo').value = '';
        mostrarPromo('');
        pintarTotales();
        $('codigo').focus();
    });

    /* ---------- Enviar pedido ---------- */
    function avisoFinal(texto) {
        const el = $('avisoEntrega');
        el.textContent = texto;
        el.hidden = false;
    }

    $('finalizar').addEventListener('click', async () => {
        if (!lineasPedido.length) return;
        if (!entrega) {
            avisoFinal('Elige cómo quieres recibir tu pedido.');
            document.querySelector('input[name="entrega"]').focus();
            return;
        }
        if (!P.enlaceWhatsApp(datos.whatsapp, '-')) {
            UI.avisar('Falta el número de WhatsApp de la tienda', false);
            return;
        }
        $('avisoEntrega').hidden = true;

        // La pestaña de WhatsApp se abre YA (si se abre después de esperar al servidor, el
        // navegador la bloquea como ventana emergente) y luego se le pone la dirección.
        const ventana = window.open('', '_blank');
        const boton = $('finalizar');
        const textoBoton = boton.innerHTML;
        boton.disabled = true;
        boton.lastChild.textContent = 'Preparando tu pedido…';

        let texto, pedido;
        try {
            const res = await fetch('/api/pedidos', {
                method: 'POST',
                headers: { 'content-type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    entrega,
                    codigoPromo: promo ? promo.codigo : null,
                    lineas: itemsPedido.map(it => ({
                        id: it.id, cantidad: it.cantidad, color: it.color, talla: it.talla,
                        componentes: it.componentes.map(c => ({ id: c.id, color: c.color, talla: c.talla }))
                    }))
                })
            });
            const r = await res.json();
            if (!r.ok) {
                if (ventana) ventana.close();
                avisoFinal(r.mensaje || 'No pudimos registrar tu pedido. Inténtalo de nuevo.');
                if (res.status === 409) {                       // cambió el stock: volver a revisar la bolsa
                    Object.keys(productos).forEach(k => delete productos[k]);
                    actualizar();
                }
                return;
            }
            // Precios y totales confirmados por la tienda
            texto = P.armarMensaje({ codigo: r.codigo, lineas: r.lineas, entrega, promo: r.promo, envioGratis: r.envioGratis });
            pedido = P.pedidoParaGuardar({ codigo: r.codigo, items: itemsPedido, lineas: r.lineas, entrega,
                promo: r.promo, envioGratis: r.envioGratis, mensaje: texto, fecha: new Date() });
        } catch (e) {
            // La tienda no respondió: se envía igual, sin código, para no perder el pedido.
            texto = P.armarMensaje({ lineas: lineasPedido, entrega, promo, envioGratis: envioEsGratis });
            pedido = P.pedidoParaGuardar({ codigo: null, items: itemsPedido, lineas: lineasPedido, entrega,
                promo, envioGratis: envioEsGratis, mensaje: texto, fecha: new Date() });
        } finally {
            boton.disabled = false;
            boton.innerHTML = textoBoton;
        }

        // El pedido pasa a "Pedidos" y la bolsa se vacía. Queda "Enviado por WhatsApp" al abrirse el enlace.
        const Pedidos = window.AerisPedidosStore;
        try { if (Pedidos) Pedidos.agregar(pedido); } catch (e) { /* sin guardar: igual se envía */ }
        Bolsa.clear();

        const enlace = P.enlaceWhatsApp(datos.whatsapp, texto);
        if (Pedidos) Pedidos.marcarEnviado(pedido.id);
        if (ventana) {
            ventana.opener = null;
            ventana.location.href = enlace;
            window.location.href = '/pedidos';      // al volver de WhatsApp, la clienta ve su pedido
        } else {
            window.location.href = enlace;
        }
    });

    Bolsa.subscribe(() => { actualizar(); });
})();
