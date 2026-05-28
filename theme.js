(function () {
  const STORAGE_KEY = "guildaHub.theme";
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function readSavedTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === "dark" || saved === "light" ? saved : null;
    } catch (_) {
      return null;
    }
  }

  function preferredTheme() {
    const saved = readSavedTheme();
    if (saved) return saved;
    return media && media.matches ? "dark" : "light";
  }

  function refreshIcons() {
    try {
      if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
      }
    } catch (_) {}
  }

  function updateToggle(theme) {
    const isDark = theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      const label = isDark ? "Tema claro" : "Tema escuro";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      btn.setAttribute("aria-pressed", isDark ? "true" : "false");

      const icon = btn.querySelector("[data-theme-toggle-icon]");
      const text = btn.querySelector("[data-theme-toggle-label]");
      if (icon) {
        icon.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}" class="w-4 h-4"></i>`;
      }
      if (text) text.textContent = label;
    });
    refreshIcons();
  }

  function applyTheme(theme, save) {
    const next = theme === "dark" ? "dark" : "light";
    root.dataset.theme = next;
    root.style.colorScheme = next;

    try {
      if (save) localStorage.setItem(STORAGE_KEY, next);
    } catch (_) {}

    updateToggle(next);
    return next;
  }

  function createButton(compact) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = compact ? "theme-toggle-btn theme-toggle-btn--compact" : "theme-toggle-btn";
    btn.setAttribute("data-theme-toggle", "true");
    btn.innerHTML = [
      '<span class="theme-toggle-btn__icon" data-theme-toggle-icon></span>',
      '<span data-theme-toggle-label class="theme-toggle-btn__label">Tema escuro</span>'
    ].join("");
    btn.addEventListener("click", () => {
      const current = root.dataset.theme === "dark" ? "dark" : "light";
      applyTheme(current === "dark" ? "light" : "dark", true);
    });
    return btn;
  }

  function ensureToggle() {
    if (document.querySelector("[data-theme-toggle]")) {
      updateToggle(root.dataset.theme || preferredTheme());
      return;
    }

    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn && logoutBtn.parentElement) {
      const wrap = document.createElement("div");
      wrap.className = "theme-toggle-wrap";
      wrap.appendChild(createButton(false));
      logoutBtn.parentElement.insertBefore(wrap, logoutBtn);
      updateToggle(root.dataset.theme || preferredTheme());
      return;
    }

    const authTop = document.getElementById("open-auth-top");
    if (authTop && authTop.parentElement) {
      authTop.parentElement.insertBefore(createButton(true), authTop);
      updateToggle(root.dataset.theme || preferredTheme());
      return;
    }

    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      const wrap = document.createElement("div");
      wrap.className = "theme-toggle-wrap theme-toggle-wrap--sidebar";
      wrap.appendChild(createButton(false));
      sidebar.appendChild(wrap);
      updateToggle(root.dataset.theme || preferredTheme());
      return;
    }

    const floating = createButton(true);
    floating.classList.add("theme-toggle-floating");
    document.body.appendChild(floating);
    updateToggle(root.dataset.theme || preferredTheme());
  }

  applyTheme(preferredTheme(), false);

  if (media) {
    const onSystemChange = () => {
      if (!readSavedTheme()) applyTheme(preferredTheme(), false);
    };
    try {
      media.addEventListener("change", onSystemChange);
    } catch (_) {
      try { media.addListener(onSystemChange); } catch (_) {}
    }
  }

  window.GuildTheme = {
    get: () => root.dataset.theme || preferredTheme(),
    set: (theme) => applyTheme(theme, true),
    toggle: () => {
      const current = root.dataset.theme === "dark" ? "dark" : "light";
      return applyTheme(current === "dark" ? "light" : "dark", true);
    },
    useSystem: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return applyTheme(preferredTheme(), false);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureToggle);
  } else {
    ensureToggle();
  }
})();
