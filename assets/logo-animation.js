/*  Animated Zzzap lockup — header.
 *
 *  Ported from the app's bundled design export (zap/zap/ZzzapLogoAnimation.html)
 *  without the React + dc-runtime wrapper it shipped inside: that wrapper
 *  fetched React, ReactDOM and Babel from unpkg on every load, and the
 *  animation itself was never more than SVG, CSS keyframes and the timers here.
 *
 *  The markup's resting state IS the finished lockup, so the header renders the
 *  complete logo with this file blocked or still loading. Everything below is
 *  the lightning strike, the idle crackle and the power flicker on top of it.
 *
 *  The app's copy also carried a light-theme branch. This page is always black,
 *  so the dark-theme colors are baked straight into the markup instead.
 */

(function () {
    'use strict';

    var root = document.getElementById('zzzap-logo');
    if (!root) return;

    // Nominal gap between strikes. The real wait is heavily varied per strike so
    // the loop never reads as a loop — see scheduleRestrike().
    var RESTRIKE_EVERY = 7000;

    var restrikeTimer = null;
    var crackleTimer = null;
    var timers = new Set();     // one-shot timers, tracked so they can be cancelled

    function q(sel) { return root.querySelector(sel); }
    function qa(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

    function later(fn, ms) {
        var id = setTimeout(function () { timers.delete(id); fn(); }, ms);
        timers.add(id);
        return id;
    }

    // Replaying a finished CSS animation needs the old one cleared and a reflow
    // forced in between, otherwise the browser coalesces the two and nothing plays.
    function restart(el, anim) {
        if (!el) return;
        el.style.animation = 'none';
        void root.offsetWidth;
        el.style.animation = anim;
    }

    // Full strike: bolts wipe in, the mark shakes, the z takes the hit, sparks
    // fly and the wordmark's power blows out.
    function strike() {
        // Vary every strike so it feels live rather than looped.
        var both = Math.random() < 0.5;
        var leftFirst = Math.random() < 0.5;
        var doL = both || leftFirst;
        var doR = both || !leftFirst;
        var together = both && Math.random() < 0.3;
        var stagger = together ? 0 : 40 + Math.random() * 160;
        var dL = leftFirst ? 0 : stagger;
        var dR = leftFirst ? stagger : 0;
        var durL = 150 + Math.random() * 115;
        var durR = 150 + Math.random() * 115;
        var ease = 'cubic-bezier(.4,0,.7,.3)';
        var hots = qa('.hot');
        var ends = [];

        // Each striking bolt draws in top-to-bottom (the glow on its parent
        // follows, so there's no box) behind a white-hot strobe.
        if (doL) {
            restart(q('.wipeL'), 'zzWipe ' + (durL | 0) + 'ms ' + ease + ' ' + (dL | 0) + 'ms both');
            if (hots[0]) restart(hots[0], 'zzStrobe ' + ((400 + Math.random() * 230) | 0) + 'ms linear ' + (dL | 0) + 'ms both');
            ends.push(dL + durL);
        }
        if (doR) {
            restart(q('.wipeR'), 'zzWipe ' + (durR | 0) + 'ms ' + ease + ' ' + (dR | 0) + 'ms both');
            if (hots[1]) restart(hots[1], 'zzStrobe ' + ((400 + Math.random() * 230) | 0) + 'ms linear ' + (dR | 0) + 'ms both');
            ends.push(dR + durR);
        }
        if (!ends.length) return;

        var impact = Math.max.apply(null, ends) - 20;   // when the last bolt lands on the z
        later(function () { restart(q('.shake'), 'zzShake 400ms both'); }, Math.max(0, impact - 60));
        later(function () { restart(q('.burst'), 'zzBurst 520ms both'); }, Math.max(0, impact - 20));
        restart(q('.zimpact'), 'zzZImpact 700ms ease ' + ((impact - 20) | 0) + 'ms both');
        qa('.spk').forEach(function (p, i) {
            restart(p, 'zzSparkFly ' + (520 + (i % 4) * 30) + 'ms ' + (impact - 30) + 'ms both');
        });

        // The strike knocks the wordmark's power out; it flickers back on.
        later(powerFlicker, Math.max(0, impact - 25));

        // Hand the hot overlays back to the crackle loop once the strike settles.
        later(function () {
            qa('.hot').forEach(function (h) {
                h.style.animation = 'none';
                h.style.opacity = 0;
                h.style.clipPath = 'none';
            });
        }, 1000);
    }

    // Knock the word out, then flicker it back on. Driven by one of three CSS
    // keyframes picked at random rather than per-frame JS.
    function powerFlicker() {
        var g = q('.wordgrp');
        if (!g) return;
        var kf = ['zzFlickA', 'zzFlickB', 'zzFlickC'][Math.floor(Math.random() * 3)];
        var dur = (950 + Math.random() * 700) | 0;
        restart(g, kf + ' ' + dur + 'ms linear both');
        // The tagline stays out through the flicker, then fades in once the
        // word's power is back.
        var tag = q('.tag');
        if (tag) restart(tag, 'zzTagFade 240ms ease-out ' + (dur + 70) + 'ms both');
    }

    function scheduleRestrike() {
        clearTimeout(restrikeTimer);
        var wait;
        if (Math.random() < 0.3) wait = 350 + Math.random() * 1250;             // flurry: quick follow-up
        else wait = RESTRIKE_EVERY * (0.55 + Math.random() * 1.2);              // otherwise a varied, longer gap
        restrikeTimer = setTimeout(function () {
            strike();
            scheduleRestrike();
        }, Math.max(300, wait));
    }

    function startCrackle() {
        clearTimeout(crackleTimer);
        crackleTimer = setTimeout(function () {
            crackle();
            startCrackle();
        }, 520 + Math.random() * 1500);
    }

    // Idle life between strikes: the bolts blink, the spark core pops and a
    // filament occasionally arcs across the gap.
    function crackle() {
        var hots = qa('.hot');
        if (!hots.length) return;
        var targets = Math.random() < 0.28 ? hots : [hots[Math.random() < 0.5 ? 0 : 1]];
        var peak = 0.26 + Math.random() * 0.32;

        targets.forEach(function (h) { h.style.transition = 'none'; h.style.opacity = peak; });
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                targets.forEach(function (h) {
                    h.style.transition = 'opacity 130ms ease-out';
                    h.style.opacity = 0;
                });
            });
        });

        // Double blink.
        if (Math.random() < 0.4) {
            later(function () {
                targets.forEach(function (h) { h.style.transition = 'none'; h.style.opacity = peak * 0.65; });
                requestAnimationFrame(function () {
                    targets.forEach(function (h) {
                        h.style.transition = 'opacity 110ms ease-out';
                        h.style.opacity = 0;
                    });
                });
            }, 85);
        }

        // Spark core pop.
        var sp = q('.spark');
        if (sp) {
            sp.style.transition = 'none';
            sp.style.opacity = 1;
            sp.style.transform = 'scale(1.28)';
            requestAnimationFrame(function () {
                sp.style.transition = 'opacity 280ms ease-out, transform 280ms ease-out';
                sp.style.opacity = 0.7;
                sp.style.transform = 'scale(1)';
            });
        }

        // Arcing filament.
        if (Math.random() < 0.55) {
            var arcs = qa('.arc');
            var a = arcs[Math.floor(Math.random() * arcs.length)];
            if (a) {
                a.style.transition = 'none';
                a.style.opacity = 0.85;
                requestAnimationFrame(function () {
                    a.style.transition = 'opacity 120ms ease-out';
                    a.style.opacity = 0;
                });
            }
        }

        // Jolt on a strong crackle. Inherited from the app's copy, where the
        // peak range tops out below this threshold — it fires only if the range
        // above is ever raised.
        if (peak > 0.72 && Math.random() < 0.5) restart(q('.shake'), 'zzMicroShake 260ms');
    }

    function start() {
        // The resting markup already reads as the finished logo, so the intro
        // strike is a transient on top of it, not a build-in.
        strike();
        later(startCrackle, 1100);
        scheduleRestrike();
    }

    function stop() {
        timers.forEach(clearTimeout);
        timers.clear();
        clearTimeout(restrikeTimer);
        clearTimeout(crackleTimer);
    }

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function sync() {
        stop();
        // Nothing to drive while the tab is in the background, and nothing to
        // drive for someone who has asked for less motion — the static lockup
        // is already on screen either way.
        if (!reduceMotion.matches && !document.hidden) start();
    }

    document.addEventListener('visibilitychange', sync);
    if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', sync);
    else reduceMotion.addListener(sync);

    sync();
})();
