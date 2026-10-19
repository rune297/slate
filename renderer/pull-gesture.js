(function (root) {
  'use strict';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const threshold = height => clamp(height * .26, 96, 160);
  function offsetFor(delta,height,initiallyExpanded=false){
    const raw=(initiallyExpanded?0:-height)+delta;
    if(raw>0)return 32*(1-1/(1+raw/96));
    if(raw < -height)return -height-16*(1-1/(1+(-height-raw)/96));
    return raw;
  }
  function releaseOpens(distance, height, cancelled = false, moved = false, initiallyExpanded = false) {
    if (cancelled) return initiallyExpanded;
    if (distance < 4 && !moved) return !initiallyExpanded;
    return distance >= threshold(height) ? !initiallyExpanded : initiallyExpanded;
  }
  if (typeof module === 'object' && module.exports) { module.exports = { threshold, releaseOpens,offsetFor }; return; }
  const api = root.slateAPI, motion = root.SlatePanelMotion;
  const app = document.getElementById('app'), handle = document.getElementById('slate'), panel = document.getElementById('panel');
  if (!api?.beginPull || !motion || !app || !handle || !panel) return;
  let state = null, suppressClickUntil = 0;
  const frame = () => new Promise(resolve => {
    let finished = false;
    const done = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(done, 48);
    requestAnimationFrame(done);
  });
  const paint = s => {
    s.raf = 0;
    if (state !== s || s.settling) return;
    app.style.setProperty('--pull-distance', `${s.visible}px`);
    app.style.setProperty('--pull-translate', `${offsetFor(s.delta,s.height,s.initiallyExpanded)}px`);
  };
  function releaseCapture(s) {
    if (handle.hasPointerCapture(s.pointerId)) handle.releasePointerCapture(s.pointerId);
  }
  async function settle(s) {
    if (state !== s || !s.ready || s.settling) return;
    s.settling = true;
    s.released = true;
    releaseCapture(s);
    cancelAnimationFrame(s.raf);
    let expanded = releaseOpens(s.distance, s.height, s.cancelled, s.travel >= 4, s.initiallyExpanded);
    const start = offsetFor(s.delta,s.height,s.initiallyExpanded), end = expanded ? 0 : -s.height;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 230;
    // Both animations are compositor work. Native bounds and the IPC count stay
    // constant throughout the drag, and preview controls remain inert.
    s.animation = app.animate([{ transform:`translate3d(0,${start}px,0)` }, { transform:`translate3d(0,${end}px,0)` }], {
      duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards',
    });
    try { await s.animation.finished; } catch (_) { expanded = s.initiallyExpanded; }
    if (state !== s) return;
    if (s.cancelled) expanded = s.initiallyExpanded;
    try {
      if (!s.nativeGone) {
        const result = await api.finishPull({ id: s.id, expanded });
        if (!result?.ok) expanded = false;
      } else expanded = s.nativeExpanded;
    } catch (_) { expanded = false; }
    motion.finishPull(expanded);
    app.classList.remove('pulling', 'pull-ready');
    app.style.removeProperty('--pull-distance');
    app.style.removeProperty('--pull-translate');
    s.animation.cancel();
    if (expanded && s.initiallyExpanded && s.focused?.isConnected && !panel.inert) s.focused.focus({ preventScroll: true });
    suppressClickUntil = Date.now() + 400;
    state = null;
  }
  async function begin(s) {
    try {
      if (!await motion.preparePull()) { state = null; releaseCapture(s); return; }
      s.prepared = true;
      app.classList.add('pulling');
      if (s.initiallyExpanded) app.classList.add('pull-ready');
      app.style.setProperty('--pull-distance', `${s.visible}px`);
      app.style.setProperty('--pull-translate', `${offsetFor(s.delta,s.height,s.initiallyExpanded)}px`);
      await frame();
      const result = await api.beginPull(s.initiallyExpanded ? 'expanded' : 'collapsed');
      if (!result?.ok) throw new Error('pull unavailable');
      s.id = result.id;
      await frame(); await frame();
      s.height = app.getBoundingClientRect().height;
      s.visible = clamp((s.initiallyExpanded ? s.height : 0) + s.delta, 0, s.height);
      paint(s);
      app.classList.add('pull-ready');
      await frame();
      if (!(await api.readyPull(s.id))?.ok) throw new Error('pull interrupted');
      s.ready = true;
      if (s.released || s.cancelled) settle(s);
    } catch (_) {
      s.released = true;
      releaseCapture(s);
      if (s.id) { try { await api.finishPull({ id: s.id, expanded: s.initiallyExpanded }); } catch (_) { /* watchdog also recovers */ } }
      if (s.prepared) motion.finishPull(s.initiallyExpanded);
      app.classList.remove('pulling', 'pull-ready');
      app.style.removeProperty('--pull-distance');
      app.style.removeProperty('--pull-translate');
      suppressClickUntil = Date.now() + 400;
      if (state === s) state = null;
    }
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || state || app.classList.contains('opening') || app.classList.contains('closing')) return;
    event.preventDefault();
    const initiallyExpanded = app.classList.contains('expanded');
    const height = app.getBoundingClientRect().height;
    const s = { pointerId: event.pointerId, startY: event.clientY, distance: 0, delta: 0, travel: 0, height, visible: initiallyExpanded ? height : 0, initiallyExpanded, focused: document.activeElement, raf: 0 };
    state = s;
    suppressClickUntil = Date.now() + 400;
    handle.setPointerCapture(event.pointerId);
    begin(s);
  });
  handle.addEventListener('pointermove', event => {
    const s = state;
    if (!s || event.pointerId !== s.pointerId || s.released || s.settling) return;
    updatePosition(s, event.clientY);
    if (!s.raf) s.raf = requestAnimationFrame(() => paint(s));
  });
  handle.addEventListener('pointerup', event => {
    const s = state;
    if (!s || event.pointerId !== s.pointerId) return;
    updatePosition(s, event.clientY);
    s.released = true;
    suppressClickUntil = Date.now() + 400;
    releaseCapture(s);
    settle(s);
  });
  function updatePosition(s, y) {
    s.delta = y - s.startY;
    s.distance = Math.max(0, s.initiallyExpanded ? -s.delta : s.delta);
    s.travel = Math.max(s.travel, Math.abs(s.delta));
    s.visible = clamp((s.initiallyExpanded ? s.height : 0) + s.delta, 0, s.height);
  }
  function cancel() {
    if (!state) return;
    state.cancelled = true;
    state.released = true;
    if (state.settling) { state.animation?.cancel(); state.handleAnimation?.cancel(); }
    else settle(state);
  }
  handle.addEventListener('pointercancel', cancel);
  handle.addEventListener('lostpointercapture', () => { if (state && !state.released) cancel(); });
  handle.addEventListener('click', event => {
    if (!state && Date.now() >= suppressClickUntil) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  root.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  document.addEventListener('keydown', event => {
    if (state && event.key === 'Escape') { event.preventDefault(); cancel(); }
  }, true);
  api.onPullCancel?.((id, expanded) => { if (state?.id === id) { state.nativeGone = true; state.nativeExpanded = expanded === true; cancel(); } });
  root.SlatePull = { isDragging: () => Boolean(state), cancel };
})(typeof window === 'undefined' ? globalThis : window);
