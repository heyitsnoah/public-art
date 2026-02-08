(function () {
  'use strict';

  var allData = [];
  var filtered = [];
  var rendered = 0;
  var CHUNK = 60;
  var activeCentury = null;
  var activeMuseum = '';
  var activeSearch = '';
  var activeSort = 'default';
  var modalIndex = -1;

  var grid = document.getElementById('grid');
  var searchInput = document.getElementById('searchInput');
  var centuryPills = document.getElementById('centuryPills');
  var museumSelect = document.getElementById('museumSelect');
  var sortSelect = document.getElementById('sortSelect');
  var resultsCount = document.getElementById('resultsCount');
  var loadMore = document.getElementById('loadMore');
  var emptyState = document.getElementById('emptyState');
  var resetFilters = document.getElementById('resetFilters');
  var modal = document.getElementById('detailModal');
  var heroMosaic = document.getElementById('heroMosaic');
  var filterToggle = document.getElementById('filterToggle');
  var filterDrawer = document.getElementById('filterDrawer');

  var modalImg = document.getElementById('modalImg');
  var modalTitle = document.getElementById('modalTitle');
  var modalArtist = document.getElementById('modalArtist');
  var modalDate = document.getElementById('modalDate');
  var modalMedium = document.getElementById('modalMedium');
  var modalMuseum = document.getElementById('modalMuseum');
  var modalCity = document.getElementById('modalCity');
  var modalDimensions = document.getElementById('modalDimensions');
  var modalHighRes = document.getElementById('modalHighRes');
  var modalSource = document.getElementById('modalSource');

  fetch('data.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      allData = data;
      init();
    });

  function init() {
    buildHeroMosaic();

    var museums = new Set(allData.map(function (a) { return a.u; }).filter(Boolean));
    document.getElementById('totalCount').textContent = allData.length.toLocaleString();
    document.getElementById('museumCount').textContent = museums.size.toLocaleString();

    buildCenturyPills();
    buildMuseumSelect();
    applyFilters();
    setupListeners();
    setupIntersectionObserver();
    readHash();
  }

  function buildHeroMosaic() {
    // Pick 32 random artworks for the 8x4 mosaic background
    var shuffled = allData.slice().sort(function () { return Math.random() - 0.5; });
    var picks = shuffled.slice(0, 32);
    var fragment = document.createDocumentFragment();
    picks.forEach(function (art) {
      var img = document.createElement('img');
      img.src = 'thumbnails/' + art.i + '.jpg';
      img.alt = '';
      img.loading = 'eager';
      fragment.appendChild(img);
    });
    heroMosaic.appendChild(fragment);
  }

  function buildCenturyPills() {
    var centuries = {};
    allData.forEach(function (a) {
      if (a.cn != null) centuries[a.cn] = (centuries[a.cn] || 0) + 1;
    });

    var sorted = Object.keys(centuries).sort(function (a, b) {
      if (a === 'BCE') return -1;
      if (b === 'BCE') return 1;
      return Number(a) - Number(b);
    });

    centuryPills.textContent = '';
    sorted.forEach(function (c) {
      var label = c === 'BCE' ? 'BCE' : ordinal(Number(c)) + ' c.';
      var btn = document.createElement('button');
      btn.className = 'pill';
      btn.dataset.century = c;
      btn.textContent = label;
      centuryPills.appendChild(btn);
    });
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function buildMuseumSelect() {
    var counts = {};
    allData.forEach(function (a) {
      if (a.u) counts[a.u] = (counts[a.u] || 0) + 1;
    });
    Object.entries(counts)
      .sort(function (a, b) { return b[1] - a[1]; })
      .forEach(function (entry) {
        var opt = document.createElement('option');
        opt.value = entry[0];
        opt.textContent = entry[0] + ' (' + entry[1] + ')';
        museumSelect.appendChild(opt);
      });
  }

  function applyFilters() {
    var q = activeSearch.toLowerCase().trim();

    filtered = allData.filter(function (a) {
      if (activeCentury != null) {
        if (activeCentury === 'BCE') {
          if (a.cn !== 'BCE') return false;
        } else {
          if (a.cn !== Number(activeCentury)) return false;
        }
      }
      if (activeMuseum && a.u !== activeMuseum) return false;
      if (q) {
        var haystack = [a.t, a.a, a.u, a.c, a.m, a.d].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    sortFiltered();
    rendered = 0;
    grid.textContent = '';
    renderChunk();
    updateResultsCount();
    emptyState.hidden = filtered.length > 0;
    loadMore.hidden = rendered >= filtered.length;
    updateFilterIndicator();
  }

  function updateFilterIndicator() {
    var count = 0;
    if (activeCentury != null) count++;
    if (activeMuseum) count++;
    if (activeSort !== 'default') count++;
    filterToggle.classList.toggle('has-filters', count > 0);
    var label = filterToggle.querySelector('span');
    label.textContent = count > 0 ? 'Filters (' + count + ')' : 'Filters';
  }

  function sortFiltered() {
    switch (activeSort) {
      case 'year-asc':
        filtered.sort(function (a, b) { return (a.y != null ? a.y : 9999) - (b.y != null ? b.y : 9999); });
        break;
      case 'year-desc':
        filtered.sort(function (a, b) { return (b.y != null ? b.y : -9999) - (a.y != null ? a.y : -9999); });
        break;
      case 'title':
        filtered.sort(function (a, b) { return a.t.localeCompare(b.t); });
        break;
      case 'artist':
        filtered.sort(function (a, b) { return a.a.localeCompare(b.a); });
        break;
    }
  }

  function updateResultsCount() {
    if (activeSearch || activeCentury != null || activeMuseum) {
      resultsCount.textContent = filtered.length.toLocaleString() + ' result' + (filtered.length !== 1 ? 's' : '');
    } else {
      resultsCount.textContent = allData.length.toLocaleString() + ' works';
    }
  }

  function renderChunk() {
    var end = Math.min(rendered + CHUNK, filtered.length);
    var fragment = document.createDocumentFragment();
    for (var i = rendered; i < end; i++) {
      fragment.appendChild(createCard(filtered[i], i));
    }
    grid.appendChild(fragment);
    rendered = end;
    loadMore.hidden = rendered >= filtered.length;
  }

  function createCard(art, index) {
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'listitem');
    card.style.animationDelay = ((index - rendered) * 15) + 'ms';

    var img = document.createElement('img');
    img.src = 'thumbnails/' + art.i + '.jpg';
    img.alt = art.t;
    img.loading = 'lazy';
    img.addEventListener('error', function () {
      var placeholder = document.createElement('div');
      placeholder.className = 'card-placeholder';
      var span = document.createElement('span');
      span.textContent = art.t;
      placeholder.appendChild(span);
      img.replaceWith(placeholder);
    });
    card.appendChild(img);

    var overlay = document.createElement('div');
    overlay.className = 'card-overlay';

    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = art.t;
    overlay.appendChild(title);

    var artist = document.createElement('div');
    artist.className = 'card-artist';
    artist.textContent = art.a;
    overlay.appendChild(artist);

    card.appendChild(overlay);
    card.addEventListener('click', function () { openModal(index); });
    return card;
  }

  function setupIntersectionObserver() {
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && rendered < filtered.length) {
        renderChunk();
      }
    }, { rootMargin: '600px' });
    observer.observe(loadMore);
  }

  function setupListeners() {
    // Search
    var searchTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        activeSearch = searchInput.value;
        applyFilters();
        updateHash();
      }, 200);
    });

    // Filter toggle
    filterToggle.addEventListener('click', function () {
      var expanded = filterToggle.getAttribute('aria-expanded') === 'true';
      filterToggle.setAttribute('aria-expanded', String(!expanded));
      filterDrawer.hidden = expanded;
    });

    // Hero CTA
    document.getElementById('heroCta').addEventListener('click', function () {
      document.getElementById('filterBar').scrollIntoView({ behavior: 'smooth' });
    });

    // Century pills
    centuryPills.addEventListener('click', function (e) {
      var btn = e.target.closest('.pill');
      if (!btn) return;
      var val = btn.dataset.century;
      activeCentury = activeCentury === val ? null : val;
      centuryPills.querySelectorAll('.pill').forEach(function (p) {
        p.classList.toggle('active', p.dataset.century === activeCentury);
      });
      applyFilters();
      updateHash();
    });

    museumSelect.addEventListener('change', function () {
      activeMuseum = museumSelect.value;
      applyFilters();
      updateHash();
    });

    sortSelect.addEventListener('change', function () {
      activeSort = sortSelect.value;
      applyFilters();
    });

    resetFilters.addEventListener('click', function () {
      activeSearch = '';
      activeCentury = null;
      activeMuseum = '';
      activeSort = 'default';
      searchInput.value = '';
      museumSelect.value = '';
      sortSelect.value = 'default';
      centuryPills.querySelectorAll('.pill').forEach(function (p) {
        p.classList.remove('active');
      });
      applyFilters();
      updateHash();
    });

    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeModal();
    });

    document.getElementById('modalPrev').addEventListener('click', function () { navigateModal(-1); });
    document.getElementById('modalNext').addEventListener('click', function () { navigateModal(1); });

    document.addEventListener('keydown', function (e) {
      if (!modal.open) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'ArrowRight') navigateModal(1);
    });

    window.addEventListener('hashchange', readHash);
  }

  function openModal(index) {
    if (index < 0 || index >= filtered.length) return;
    modalIndex = index;
    var art = filtered[index];

    modalImg.src = 'thumbnails/' + art.i + '.jpg';
    modalImg.alt = art.t;
    modalTitle.textContent = art.t;
    modalArtist.textContent = art.a;
    modalDate.textContent = art.d || (art.y != null ? String(art.y) : 'Unknown');
    modalMedium.textContent = art.m || 'Unknown';
    modalMuseum.textContent = art.u || 'Unknown';
    modalCity.textContent = art.c;
    modalDimensions.textContent = art.h && art.w ? art.h + ' \u00d7 ' + art.w + ' cm' : 'Unknown';

    document.getElementById('metaDate').hidden = !art.d && art.y == null;
    document.getElementById('metaMedium').hidden = !art.m;

    if (art.img) {
      modalHighRes.href = art.img;
      modalHighRes.hidden = false;
    } else {
      modalHighRes.hidden = true;
    }

    var sourceUrl = art.mu || art.wd;
    if (sourceUrl) {
      modalSource.href = sourceUrl;
      modalSource.hidden = false;
    } else {
      modalSource.hidden = true;
    }

    modal.showModal();
    location.hash = art.i;
  }

  function closeModal() {
    modal.close();
    modalIndex = -1;
    history.replaceState(null, '', location.pathname + location.search);
  }

  function navigateModal(dir) {
    var newIndex = modalIndex + dir;
    if (newIndex >= 0 && newIndex < filtered.length) openModal(newIndex);
  }

  function updateHash() {
    var params = new URLSearchParams();
    if (activeSearch) params.set('q', activeSearch);
    if (activeCentury != null) params.set('c', activeCentury);
    if (activeMuseum) params.set('m', activeMuseum);
    var qs = params.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  function readHash() {
    var hash = location.hash.slice(1);
    if (hash && allData.length) {
      var idx = filtered.findIndex(function (a) { return a.i === hash; });
      if (idx >= 0) {
        while (rendered <= idx) renderChunk();
        openModal(idx);
        return;
      }
    }

    var params = new URLSearchParams(location.search);
    var q = params.get('q');
    var c = params.get('c');
    var m = params.get('m');
    var changed = false;

    if (q && q !== activeSearch) {
      activeSearch = q;
      searchInput.value = q;
      changed = true;
    }
    if (c && c !== activeCentury) {
      activeCentury = c;
      centuryPills.querySelectorAll('.pill').forEach(function (p) {
        p.classList.toggle('active', p.dataset.century === activeCentury);
      });
      changed = true;
    }
    if (m && m !== activeMuseum) {
      activeMuseum = m;
      museumSelect.value = m;
      changed = true;
    }
    if (changed) applyFilters();
  }

})();
