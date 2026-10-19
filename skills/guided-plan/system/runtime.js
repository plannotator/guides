(function () {
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme');
  function paintTheme() { themeBtn.textContent = root.dataset.theme === 'dark' ? 'Light' : 'Dark'; }
  themeBtn.addEventListener('click', function () { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; paintTheme(); });
  paintTheme();

  // ---------- figures: controls and rules ----------
  function initFigure(fig) {
    var data = fig.querySelector('script[data-rules]');
    if (!data) return;
    var cfg = JSON.parse(data.textContent);
    var values = Object.assign({}, cfg.values);
    var cap = fig.querySelector('[data-cap]');
    function apply() {
      var st = resolve(cfg, values);
      var gone = st.gone || [], show = st.show || [], set = st.set || {};
      fig.querySelectorAll('[data-el]').forEach(function (e) {
        if (gone.indexOf(e.getAttribute('data-el')) >= 0) e.setAttribute('data-gone', '1'); else e.removeAttribute('data-gone');
      });
      fig.querySelectorAll('[data-opt]').forEach(function (e) {
        if (show.indexOf(e.getAttribute('data-opt')) >= 0) e.setAttribute('data-on', '1'); else e.removeAttribute('data-on');
      });
      fig.querySelectorAll('[data-slot]').forEach(function (e) {
        var k = e.getAttribute('data-slot');
        if (k in set) e.textContent = set[k];
      });
      // whole states (toggle and steps): a panel shows when every key=value it names matches
      fig.querySelectorAll('[data-when]').forEach(function (e) {
        var ok = e.getAttribute('data-when').split('&').every(function (pair) {
          var kv = pair.split('='); return values[kv[0]] === kv.slice(1).join('=');
        });
        e.hidden = !ok;
      });
      if (st.caption) cap.textContent = st.caption;
      fig.querySelectorAll('.seg-b').forEach(function (b) {
        b.setAttribute('aria-pressed', String(values[b.dataset.key] === b.dataset.val));
      });
      cfg.controls.forEach(function (c) {
        var i = c.options.indexOf(values[c.key]);
        fig.querySelectorAll('[data-step="' + c.key + '"]').forEach(function (b) {
          b.disabled = (b.dataset.d === '-1' && i === 0) || (b.dataset.d === '1' && i === c.options.length - 1);
        });
      });
    }
    fig.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !fig.contains(b)) return;
      if (b.dataset.key) { values[b.dataset.key] = b.dataset.val; apply(); }
      else if (b.dataset.step) {
        var c = cfg.controls.filter(function (x) { return x.key === b.dataset.step; })[0];
        var i = c.options.indexOf(values[c.key]) + Number(b.dataset.d);
        if (i >= 0 && i < c.options.length) { values[c.key] = c.options[i]; apply(); }
      }
    });
    // left and right move between the choices of one control, and pick
    fig.addEventListener('keydown', function (e) {
      var b = e.target.closest && e.target.closest('.seg-b');
      if (!b || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      var group = Array.prototype.slice.call(b.parentNode.querySelectorAll('.seg-b'));
      var n = group.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1);
      if (n < 0 || n >= group.length) return;
      e.preventDefault();
      group[n].focus();
      values[group[n].dataset.key] = group[n].dataset.val;
      apply();
    });
    apply();
  }
  document.querySelectorAll('[data-fig]').forEach(initFigure);

  // ---------- sections: parts, read state ----------
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var readCount = document.getElementById('readcount');
  function paintCount() {
    var n = cards.filter(function (c) { return c.classList.contains('is-read'); }).length;
    readCount.textContent = n ? ' · ' + n + '/' + cards.length + ' read' : '';
  }
  function selectPart(card, id, focus) {
    card.querySelectorAll('.part').forEach(function (li) {
      var on = li.dataset.part === id;
      li.classList.toggle('is-sel', on);
      li.querySelector('.part-b').setAttribute('aria-expanded', String(on));
      li.querySelector('.part-body').hidden = !on;
      if (on && focus) li.querySelector('.part-b').focus();
    });
    card.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== id; });
  }
  function setRead(card, on) {
    card.classList.toggle('is-read', on);
    card.querySelectorAll('.check').forEach(function (c) { c.setAttribute('aria-checked', String(on)); });
    paintCount();
  }
  function scrollToCard(card) {
    card.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    var h = card.querySelector('h2');
    if (!card.classList.contains('is-read') && h) h.focus({ preventScroll: true });
    else card.querySelector('.row-t').focus({ preventScroll: true });
  }
  cards.forEach(function (card) {
    card.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('part-b')) selectPart(card, b.parentNode.dataset.part, false);
      else if (b.classList.contains('check')) setRead(card, b.getAttribute('aria-checked') !== 'true');
      else if (b.hasAttribute('data-open')) { setRead(card, false); scrollToCard(card); }
      else if (b.dataset.goto) { selectPart(card, b.dataset.goto.split('.')[1], true); if (matchMedia('(max-width: 760px)').matches) card.querySelector('.panel:not([hidden])').scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' }); }
    });
    card.querySelector('.parts').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var items = Array.prototype.slice.call(card.querySelectorAll('.part'));
      var i = items.findIndex(function (li) { return li.classList.contains('is-sel'); });
      var n = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (n < 0 || n >= items.length) return;
      e.preventDefault(); e.stopPropagation();
      selectPart(card, items[n].dataset.part, true);
    });
  });

  document.querySelectorAll('[data-jump]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var card = document.getElementById(a.dataset.jump);
      if (!card) return;
      e.preventDefault();
      setRead(card, false);
      history.replaceState(null, '', '#' + a.dataset.jump);
      scrollToCard(card);
    });
  });

  function currentIndex() {
    var best = 0;
    cards.forEach(function (c, i) { if (c.getBoundingClientRect().top <= 90) best = i; });
    if (window.scrollY < 40 && cards[0].getBoundingClientRect().top > 90) return -1;
    return best;
  }
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'PRE' || t.isContentEditable)) return;
    var d = 0;
    if (e.key === 'j' || e.key === 'ArrowDown') d = 1;
    else if (e.key === 'k' || e.key === 'ArrowUp') d = -1;
    if (!d) return;
    var i = currentIndex() + d;
    if (i < 0) { if (d < 0) { e.preventDefault(); window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); } return; }
    if (i >= cards.length) return;
    e.preventDefault();
    scrollToCard(cards[i]);
  });

  // Pins for links and renders: ?sel=section.part, ?read=section,section, ?fig=section-part:key=value
  var q = new URLSearchParams(location.search);
  (q.get('sel') || '').split(',').filter(Boolean).forEach(function (s) {
    var p = s.split('.'); var card = document.getElementById(p[0]); if (card && p[1]) selectPart(card, p[1], false);
  });
  (q.get('fig') || '').split(',').filter(Boolean).forEach(function (s) {
    var i = s.indexOf(':'); if (i < 0) return;
    var fig = document.querySelector('[data-fig="' + s.slice(0, i) + '"]'); if (!fig) return;
    var kv = s.slice(i + 1).split('=');
    var b = fig.querySelector('.seg-b[data-key="' + kv[0] + '"][data-val="' + kv.slice(1).join('=') + '"]'); if (b) b.click();
  });
  (q.get('read') || '').split(',').filter(Boolean).forEach(function (s) { var c = document.getElementById(s); if (c) setRead(c, true); });
  paintCount();
})();
