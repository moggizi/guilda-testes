// app-loader.js - animacao inicial leve, sem leituras no Firebase.
(function () {
  const MIN_VISIBLE_MS = 320;
  const FAILSAFE_MS = 4200;
  const startedAt = Date.now();
  let hidden = false;

  function ensureLoader() {
    if (document.getElementById('app-boot-loader')) return;
    const loader = document.createElement('div');
    loader.id = 'app-boot-loader';
    loader.className = 'app-boot-loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.innerHTML = [
      '<div class="app-boot-loader__box">',
      '  <div class="app-boot-loader__mark"></div>',
      '  <div class="app-boot-loader__text">Carregando</div>',
      '</div>'
    ].join('');
    document.body.appendChild(loader);
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
    show: ensureLoader
  };

  if (document.body) ensureLoader();
  else document.addEventListener('DOMContentLoaded', ensureLoader, { once: true });

  window.addEventListener('guildahub:page-ready', hide);
  window.addEventListener('load', () => setTimeout(hide, 550), { once: true });
  setTimeout(hide, FAILSAFE_MS);
})();
