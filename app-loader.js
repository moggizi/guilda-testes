// app-loader.js - animacao inicial leve, sem leituras no Firebase.
(function () {
  const MIN_VISIBLE_MS = 320;
  const FAILSAFE_MS = 4200;
  const startedAt = Date.now();
  let hidden = false;

  function loaderTemplate() {
    return [
      '<div class="app-boot-loader__box">',
      '  <div class="app-boot-loader__mark"></div>',
      '  <div class="app-boot-loader__text">Carregando</div>',
      '</div>'
    ].join('');
  }

  function ensureLoader() {
    let loader = document.getElementById('app-boot-loader');
    if (loader) {
      loader.classList.remove('app-boot-loader--hide');
      return loader;
    }
    if (!document.body) return null;

    loader = document.createElement('div');
    loader.id = 'app-boot-loader';
    loader.className = 'app-boot-loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.innerHTML = loaderTemplate();
    document.body.insertBefore(loader, document.body.firstChild);
    return loader;
  }

  function hide() {
    if (hidden) return;
    hidden = true;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
    setTimeout(() => {
      const loader = document.getElementById('app-boot-loader');
      if (!loader) return;
      loader.classList.add('app-boot-loader--hide');
      setTimeout(() => loader.remove(), 220);
    }, wait);
  }

  window.GuildaHubLoader = {
    done: hide,
    show() {
      hidden = false;
      ensureLoader();
    }
  };

  if (document.body) ensureLoader();
  else document.addEventListener('DOMContentLoaded', ensureLoader, { once: true });

  window.addEventListener('guildahub:page-ready', hide);
  window.addEventListener('load', () => setTimeout(hide, 550), { once: true });
  setTimeout(hide, FAILSAFE_MS);

  function ensureAlertsNavLink() {
    const sidebar = document.getElementById('sidebar');
    const nav = sidebar?.querySelector('nav');
    if (!nav) return;

    const path = String(window.location.pathname || '').toLowerCase();
    const linesLink = nav.querySelector('a[href="/lines"], a[href="/lines/"], a[href="/lines.html"]');
    const playerHome = nav.querySelector('a[href="/jogador"], a[href="/jogador/"], a[href="/jogador.html"]');
    const guildHome = nav.querySelector('a[href="/dashboard"], a[href="/dashboard/"], a[href="/dashboard.html"]');
    const recruitmentLink = nav.querySelector('a[href="/recrutamento"], a[href="/recrutamento/"], a[href="/recrutamento.html"]');
    const fallbackAnchor = nav.querySelector('a[href="/membros"], #nav-support-link, a[href="/suporte"]');
    const href = linesLink || guildHome
      ? '/alertagd'
      : playerHome
        ? '/alertajg'
        : '/alertasl';
    const anchor = linesLink || recruitmentLink || fallbackAnchor || nav.lastElementChild;
    if (!anchor) return;

    let link = nav.querySelector('[data-player-alerts-nav="true"], a[href="/alertagd"], a[href="/alertajg"], a[href="/alertasl"]');
    if (!link) {
      link = document.createElement('a');
      link.dataset.playerAlertsNav = 'true';
      link.innerHTML = '<i data-lucide="shield-alert" class="w-5 h-5"></i><span>Alertas de jogadores</span>';
    }

    const active = path.includes('/alertagd') || path.includes('/alertajg') || path.includes('/alertasl');
    link.href = href;
    link.className = active
      ? 'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-amber-50 text-amber-700 shadow-sm'
      : 'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors';

    if (anchor.nextElementSibling !== link) {
      anchor.insertAdjacentElement('afterend', link);
    }
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  function scheduleAlertsNavLink() {
    ensureAlertsNavLink();
    setTimeout(ensureAlertsNavLink, 0);
    setTimeout(ensureAlertsNavLink, 450);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAlertsNavLink, { once: true });
  } else {
    scheduleAlertsNavLink();
  }
  window.addEventListener('guildahub:page-ready', ensureAlertsNavLink);
})();
