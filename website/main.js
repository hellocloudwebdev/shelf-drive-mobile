/* Shelf Drive — mobile landing page interactions.
   No dependencies. Every effect degrades gracefully without JavaScript. */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ────────────────────────────────────────────────────────── theme */
  const themeToggle = document.getElementById('theme-toggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const applyTheme = (theme, { persist = true } = {}) => {
    root.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem('shelf-drive-site-theme', theme); } catch (_) { /* private mode */ }
    }
    if (themeToggle) {
      const next = theme === 'dark' ? 'light' : 'dark';
      themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
      themeToggle.setAttribute('aria-pressed', String(theme === 'light'));
    }
    if (themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#050b18' : '#f4f8fd');
  };

  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark', { persist: false });

  themeToggle?.addEventListener('click', () => {
    applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
  });

  /* ─────────────────────────────────────────────────────── mobile nav */
  const navToggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');

  const setNavOpen = (open) => {
    if (!nav || !navToggle) return;
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };

  navToggle?.addEventListener('click', () => setNavOpen(!nav?.classList.contains('is-open')));
  nav?.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) setNavOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setNavOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) setNavOpen(false);
  });

  /* ──────────────────────────────────────────── reveal on scroll */
  const revealTargets = document.querySelectorAll(
    '.section-head, .trust-card, .feature-copy, .feature-media, .capability, .privacy-card, .android-copy, .android-media, .download-card, .steps, .faq-item, .rail'
  );

  if (!reduceMotion && 'IntersectionObserver' in window) {
    revealTargets.forEach((element) => element.classList.add('reveal'));
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    revealTargets.forEach((element) => revealObserver.observe(element));
  }

  /* ──────────────────────────────────────────── active nav section */
  const navLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((section) => sectionObserver.observe(section));
  }

  /* ─────────────────────────────────────────────── gallery rail */
  const rail = document.getElementById('screen-rail');
  document.querySelectorAll('[data-rail]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!rail) return;
      const item = rail.querySelector('.rail-item');
      const step = item ? item.getBoundingClientRect().width + 18 : 220;
      rail.scrollBy({
        left: button.dataset.rail === 'next' ? step * 2 : -step * 2,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    });
  });

  /* ───────────────────────────────────────── latest release badge */
  const chip = document.getElementById('release-chip');
  const REPO = 'hellocloudwebdev/shelf-drive-mobile';

  const renderRelease = (text, href, state = 'ready') => {
    if (!chip) return;
    chip.textContent = text;
    chip.dataset.state = state;
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.className = chip.className;
      link.id = chip.id;
      link.dataset.state = state;
      link.textContent = text;
      link.setAttribute('rel', 'noopener');
      chip.replaceWith(link);
    }
  };

  if (chip) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((release) => {
        if (!release || !release.tag_name) throw new Error('no release');
        const tag = String(release.tag_name).replace(/^v/i, '');
        renderRelease(`Latest v${tag}`, release.html_url || `https://github.com/${REPO}/releases/latest`);
      })
      .catch(() => {
        renderRelease('Latest release on GitHub', `https://github.com/${REPO}/releases/latest`, 'error');
      })
      .finally(() => clearTimeout(timeout));
  }

  /* ─────────────────────────────────────────────────────── misc */
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
