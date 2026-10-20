(function () {
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme');
  function isDark() { return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
  function paintTheme() {
    var dark = isDark();
    themeBtn.textContent = dark ? 'Light' : 'Dark';
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
  }
  themeBtn.addEventListener('click', function () { root.dataset.theme = isDark() ? 'light' : 'dark'; paintTheme(); });
  paintTheme();

  function focusIn(el) {
    var h = el.matches('section') ? el.querySelector('h2') : el.querySelector('h3');
    if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  // Jumps scroll without writing history: the page may sit inside a frame that owns the address.
  document.querySelectorAll('[data-jump]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var t = document.getElementById(a.dataset.jump);
      if (!t) return;
      e.preventDefault();
      t.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
      focusIn(t);
    });
  });

  // j and k (or the arrows) move between sections.
  var cards = Array.prototype.slice.call(document.querySelectorAll('[data-sec]'));
  function current() {
    var best = -1;
    cards.forEach(function (c, i) { if (c.getBoundingClientRect().top <= 90) best = i; });
    return best;
  }
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'PRE' || t.isContentEditable)) return;
    var d = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    var i = current() + d;
    if (i < 0) { if (d < 0) { e.preventDefault(); window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); } return; }
    if (i >= cards.length) return;
    e.preventDefault();
    cards[i].scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    focusIn(cards[i]);
  });
})();
