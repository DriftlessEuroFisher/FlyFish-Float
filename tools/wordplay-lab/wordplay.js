/* Wordplay lab driver. play(el, opts) runs one animation: CSS does the
   motion, this only decides when. The element's finished look is its default
   style, so reduced motion (or no script) just never arms it.
   Attributes on the .wp element: data-dur (ms of motion), data-hold (ms to
   rest before a loop), data-loop="0" (play once), data-thr (visibility needed
   to start). ?embed hides everything but [data-stage] for the chooser. */
(function () {
  "use strict";
  var RM = false;
  try { RM = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  if (/[?&]rm(=|&|$)/.test(location.search)) RM = true;   // ?rm: preview the reduced-motion state
  var EMBED = /[?&]embed(=|&|$)/.test(location.search);
  var NOLOOP = /[?&]noloop(=|&|$)/.test(location.search);   // ?noloop: play once, for stepping through frames
  var players = [];

  // Glyph widths in em, so the r and W slots match whichever font really loaded.
  function measure() {
    var d = document.documentElement, p = document.createElement("span");
    p.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:500 100px "Barlow Condensed",sans-serif;display:block!important';   // !important: embed mode hides body children
    document.body.appendChild(p);
    function w(t, fw) { p.textContent = t; p.style.fontWeight = fw; return p.getBoundingClientRect().width / 100; }
    var r = w("r", 500), w1 = w("w", 500), w2 = w("W", 700);
    if (r && w1 && w2) {                    // 0 means no layout yet: keep the CSS defaults
      d.style.setProperty("--rw", r.toFixed(3) + "em");
      d.style.setProperty("--w1", w1.toFixed(3) + "em");
      d.style.setProperty("--w2", w2.toFixed(3) + "em");
    }
    document.body.removeChild(p);
  }

  function play(el, o) {
    o = o || {};
    var dur = o.dur || +el.dataset.dur || 4000;
    var hold = o.hold != null ? o.hold : (el.dataset.hold != null ? +el.dataset.hold : 1800);
    var loop = !NOLOOP && (o.loop != null ? o.loop : el.dataset.loop !== "0");
    var thr = o.threshold || +el.dataset.thr || 0.6;
    var t = 0, vis = false, started = false;
    var p = { el: el, replay: function () { if (!RM) run(); } };
    players.push(p);
    if (RM) return p;                       // final state, no loop
    el.classList.add("armed");              // pre-state, paused
    function run() {
      clearTimeout(t); started = true;
      el.classList.remove("go"); el.classList.add("rs");
      void el.offsetWidth;                  // flush so the animations restart
      el.classList.remove("rs"); el.classList.add("go");
      if (loop) t = setTimeout(function () { if (vis) run(); else started = false; }, dur + hold);
    }
    if (!("IntersectionObserver" in window)) { t = setTimeout(run, 400); return p; }
    new IntersectionObserver(function (es) {
      vis = es[0].isIntersecting;
      if (vis && !started) t = setTimeout(run, o.delay || 400);
    }, { threshold: thr }).observe(el);
    return p;
  }

  function replayAll() { players.forEach(function (p) { p.replay(); }); }

  function init() {
    measure();
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", measure);
    if (EMBED) {
      document.body.classList.add("embed");
      var s = document.querySelector("[data-stage]");
      if (s) document.body.insertBefore(s, document.body.firstChild);
    }
    var els = document.querySelectorAll("[data-wp]");
    for (var i = 0; i < els.length; i++) play(els[i]);
    // hover replay (the nav lockup)
    var hv = document.querySelectorAll("[data-wp-hover]");
    for (var j = 0; j < hv.length; j++) hv[j].addEventListener("mouseenter", function () {
      players.forEach(function (p) { if (this.contains(p.el)) p.replay(); }, this);
    });
    var rb = document.querySelectorAll("[data-wp-replay]");
    for (var k = 0; k < rb.length; k++) rb[k].addEventListener("click", replayAll);
    var ra = document.querySelector("[data-wp-replay-all]");     // chooser: ask every preview frame
    if (ra) ra.addEventListener("click", function () {
      var f = document.querySelectorAll("iframe");
      for (var n = 0; n < f.length; n++) f[n].contentWindow.postMessage("wp-replay", "*");
    });
    var note = document.getElementById("rm-note");
    if (note && RM) note.hidden = false;
  }
  addEventListener("message", function (e) { if (e.data === "wp-replay") replayAll(); });

  var fonts = document.fonts && document.fonts.load ? Promise.race([
    Promise.all([document.fonts.load('500 40px "Barlow Condensed"'), document.fonts.load('700 40px "Barlow Condensed"')]),
    new Promise(function (r) { setTimeout(r, 1500); })
  ]) : Promise.resolve();
  function start() { fonts.then(init, init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.WP = { play: play, replayAll: replayAll };
})();
