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
})();