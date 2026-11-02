/**
 * @file public/js/ui/inicio.js — AERIS E-commerce
 * Solo para la página de inicio: carrusel del hero, pestañas de categorías y looks de conjuntos.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const dos = (n) => String(n).padStart(2, '0');
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* ---------- Hero ---------- */
    const slides = [...document.querySelectorAll('.hero .slide')];
    const barras = [...document.querySelectorAll('.hero .barras i')];
    if (slides.length > 1) {
        let actual = 0, temporizador = null;
        const ir = (i) => {
            actual = (i + slides.length) % slides.length;
            slides.forEach((s, k) => {
                s.classList.toggle('on', k === actual);
                if (k === actual) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
            });
            barras.forEach((b, k) => b.classList.toggle('on', k === actual));
            slides.forEach((s, k) => { if (s.tagName === 'A') s.tabIndex = k === actual ? 0 : -1; });
            const s = slides[actual], d = s.dataset;
            $('heroNum').textContent = `${dos(actual + 1)} / ${dos(slides.length)}`;
            // Título y texto del enlace son opcionales: si no hay, no se muestra nada
            $('heroTitulo').textContent = d.titulo;
            $('heroTitulo').hidden = !d.titulo;
            const enlace = $('heroEnlace');
            enlace.textContent = d.textoEnlace;
            enlace.hidden = !(d.enlace && d.textoEnlace);
            enlace.href = d.enlace || '#';
            if (d.externo) { enlace.target = '_blank'; enlace.rel = 'noopener'; } else { enlace.removeAttribute('target'); enlace.removeAttribute('rel'); }
            reiniciar();
        };
        const reiniciar = () => {
            clearInterval(temporizador);
            if (!quieto.matches && !document.hidden) temporizador = setInterval(() => ir(actual + 1), 6000);
        };
        $('heroPrev').addEventListener('click', () => ir(actual - 1));
        $('heroNext').addEventListener('click', () => ir(actual + 1));
        document.addEventListener('visibilitychange', reiniciar);

        let x0 = null, deslizo = false;
        const hero = $('hero');
        hero.addEventListener('pointerdown', e => { x0 = e.clientX; deslizo = false; });
        hero.addEventListener('pointerup', e => {
            if (x0 === null) return;
            const dx = e.clientX - x0; x0 = null;
            if (Math.abs(dx) > 40) { deslizo = true; ir(actual + (dx < 0 ? 1 : -1)); }
        });
        // Deslizar para cambiar de banner no debe abrir el enlace del banner
        hero.addEventListener('click', e => { if (deslizo && e.target.closest('a.slide')) { e.preventDefault(); deslizo = false; } }, true);
        reiniciar();
    }

    /* ---------- Pestañas de categorías ---------- */
    const tabs = [...document.querySelectorAll('#tabsInicio [role="tab"]')];
    const verMas = $('verMas');
    function elegir(tab, enfocar) {
        tabs.forEach(t => {
            const si = t === tab;
            t.setAttribute('aria-selected', String(si));
            t.tabIndex = si ? 0 : -1;
            $(t.getAttribute('aria-controls')).hidden = !si;
        });
        verMas.href = tab.dataset.catalogo;     // "Ver más en Catálogo" lleva a la categoría elegida
        if (enfocar) tab.focus();
    }
    tabs.forEach((t, i) => {
        t.addEventListener('click', () => elegir(t));
        t.addEventListener('keydown', e => {
            const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (paso) { e.preventDefault(); elegir(tabs[(i + paso + tabs.length) % tabs.length], true); }
        });
    });

    /* ---------- Looks de conjuntos ---------- */
    const looks = [...document.querySelectorAll('[data-look]')];
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-ir-look]');
        if (!b) return;
        const n = Number(b.dataset.irLook);
        looks.forEach((l, k) => { l.hidden = k !== n; });
        const boton = looks[n].querySelector(`[data-ir-look="${n}"]`);
        if (boton) boton.focus();
    });
})();
