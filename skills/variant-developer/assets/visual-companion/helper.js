// helper.js — client-side click capture for the visual companion (mockup-mode).
// Loaded by frame-template.html via <script src="/__helper.js"></script>.
//
// Sends click events to the server via POST /__events__ so the agent can
// read them on its next turn from $STATE_DIR/events.

(function () {
  function postEvent(payload) {
    fetch('/__events__', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, timestamp: Date.now() }),
    }).catch(() => {});
  }

  function updateIndicator() {
    var el = document.getElementById('indicator');
    if (!el) return;
    var selected = document.querySelectorAll('.selected[data-choice]');
    if (selected.length === 0) {
      el.innerHTML = '<span class="label">no selection</span>';
      return;
    }
    var ids = [];
    selected.forEach(function (s) { ids.push(s.getAttribute('data-choice')); });
    el.innerHTML = '<span class="label">selected:</span> <span>' + ids.join(', ') + '</span>';
  }

  window.toggleSelect = function (el) {
    var container = el.closest('.options, .cards, .palette-board, .type-pairing, .section-sketch, .density-grid');
    var multi = container && container.dataset.multiselect != null;
    if (!multi && container) {
      var siblings = container.querySelectorAll('.selected');
      siblings.forEach(function (s) { if (s !== el) s.classList.remove('selected'); });
    }
    el.classList.toggle('selected');
    postEvent({
      type: 'click',
      choice: el.dataset.choice || null,
      text: ((el.querySelector('h3, .content, .palette-name, .type-display') || {}).textContent || '').trim(),
    });
    updateIndicator();
  };

  // Auto-attach to anything with data-choice on click without explicit handler.
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-choice]');
    if (target && !target.hasAttribute('data-handled') && !target.getAttribute('onclick')) {
      window.toggleSelect(target);
    }
  });

  document.addEventListener('DOMContentLoaded', updateIndicator);
})();
