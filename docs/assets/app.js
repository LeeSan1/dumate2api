(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector("[data-theme-toggle]");
  const menuButton = document.querySelector("[data-menu-toggle]");
  const navLinks = document.querySelector("[data-nav-links]");
  const savedTheme = localStorage.getItem("dumate2api-theme");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  root.dataset.theme = savedTheme || (systemDark ? "dark" : "light");

  function syncThemeButton() {
    if (!themeButton) return;
    const isDark = root.dataset.theme === "dark";
    themeButton.setAttribute("aria-label", isDark ? "切换到浅色模式" : "切换到深色模式");
    themeButton.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  }

  syncThemeButton();

  themeButton?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("dumate2api-theme", root.dataset.theme);
    syncThemeButton();
  });

  menuButton?.addEventListener("click", () => {
    const isOpen = navLinks?.classList.toggle("open") || false;
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });

  navLinks?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      navLinks.classList.remove("open");
      menuButton?.setAttribute("aria-expanded", "false");
    }
  });

  document.querySelectorAll(".copy-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const block = button.closest(".code-block");
      const code = block?.querySelector("code")?.textContent || "";
      try {
        await navigator.clipboard.writeText(code);
        const previous = button.textContent;
        button.textContent = "已复制";
        window.setTimeout(() => {
          button.textContent = previous;
        }, 1400);
      } catch {
        button.textContent = "复制失败";
      }
    });
  });

  const tocLinks = [...document.querySelectorAll(".toc a[href^='#']")];
  const sectionMap = new Map(
    tocLinks
      .map((link) => {
        const id = link.getAttribute("href")?.slice(1);
        const section = id ? document.getElementById(id) : null;
        return section ? [section, link] : null;
      })
      .filter(Boolean),
  );

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (!visible.length) return;
      const activeLink = sectionMap.get(visible[0].target);
      if (!activeLink) return;
      tocLinks.forEach((link) => link.classList.toggle("active", link === activeLink));
    },
    { rootMargin: "-14% 0px -72% 0px", threshold: 0 },
  );

  sectionMap.forEach((_link, section) => observer.observe(section));
})();
