// Admin console → Zzzap Official → App Words (Stacy 2026-11-15).
// Every word Zzzap Official says goes through Say It Like Zzzap, including
// the lines built into the app (ladder cards). This screen lists them from
// app-words.json: for each, the plain meaning (editable), Say It Like Zzzap,
// and 3 versions to pick from. Picks stay in this browser until Save for
// Claude downloads them as a file (or Copy puts them on the clipboard);
// Claude reads the file and puts the words into the app.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const functions = getFunctions(getApp());
const $ = id => document.getElementById(id);
const PICKS_KEY = "appWordsPicks";

let list = null;          // app-words.json
let picks = loadPicks();  // { itemId: { versionId, title, body, button, plain } }
const versions = {};      // { itemId: [option] } from the last Say It Like Zzzap

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function loadPicks() {
    try { return JSON.parse(localStorage.getItem(PICKS_KEY)) || {}; } catch { return {}; }
}

function savePicks() {
    localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
    updateFooter();
}

function allItems() {
    return list ? list.groups.flatMap(g => g.items) : [];
}

// ---------- Views (same switch notes.js uses) ----------

function show(name) {
    document.querySelectorAll(".reach-view").forEach(v => { v.hidden = v.dataset.reachView !== name; });
    window.scrollTo({ top: 0 });
}

$("reach-appwords-link").addEventListener("click", async () => {
    show("appwords");
    if (!list) await load();
});
$("appwords-close").addEventListener("click", () => show("list"));

async function load() {
    const box = $("appwords-list");
    box.replaceChildren(el("p", "surge-muted", "Loading…"));
    try {
        const res = await fetch("app-words.json", { cache: "no-cache" });
        if (!res.ok) throw new Error(`app-words.json ${res.status}`);
        list = await res.json();
        render();
    } catch (err) {
        box.replaceChildren(el("p", "status-message error", `Couldn't load the app words: ${err.message}`));
    }
}

// ---------- The list ----------

function render() {
    const box = $("appwords-list");
    box.replaceChildren(...list.groups.map(group => {
        const card = el("div", "card surge-panel-card");
        card.append(el("h3", "surge-h3", group.name), el("p", "surge-muted", group.where));
        group.items.forEach(item => card.append(renderItem(item)));
        return card;
    }));
    updateFooter();
}

function wordsBlock(words, className) {
    const block = el("div", className);
    block.append(el("div", "voice-option-title", words.title), el("div", "voice-option-body", words.body));
    if (words.button) block.append(el("div", "voice-option-button", words.button));
    return block;
}

function renderItem(item) {
    const row = el("div", "appwords-item");
    row.dataset.id = item.id;
    const head = el("div", "appwords-head");
    head.append(el("strong", "", item.label), el("span", `appwords-state${picks[item.id] ? " done" : ""}`, picks[item.id] ? "Picked" : "Not picked yet"));
    row.append(head);

    row.append(el("div", "appwords-label", "In the app now (hand-written)"), wordsBlock(item.current, "appwords-current"));

    row.append(el("div", "appwords-label", "What it should say"));
    const draft = el("textarea", "appwords-draft");
    draft.maxLength = 1000;
    draft.value = picks[item.id]?.plain || item.plain;
    row.append(draft);

    const say = el("button", "btn-primary", versions[item.id]?.length ? "Write It Again" : "Say It Like Zzzap");
    say.type = "button";
    const results = el("div", "voice-results");
    row.append(say, results);
    if (versions[item.id]) renderVersions(item, results);
    else if (picks[item.id]) results.append(pickedBlock(item));

    say.addEventListener("click", async () => {
        const text = draft.value.trim();
        if (!text) {
            results.replaceChildren(el("p", "status-message error", "Type what it should say first."));
            return;
        }
        say.disabled = true;
        say.textContent = "Writing…";
        results.replaceChildren(el("p", "surge-muted", "Writing 3 versions in the Zzzap voice…"));
        try {
            const { data } = await httpsCallable(functions, "rewriteInZzzapVoice", { timeout: 120000 })({ draft: text, buttonFor: item.buttonFor });
            versions[item.id] = data.options.map(o => ({ ...o, plain: text }));
            renderVersions(item, results);
        } catch (err) {
            results.replaceChildren(el("p", "status-message error", err.message || "Couldn't write it. Try again."));
        } finally {
            say.disabled = false;
            say.textContent = versions[item.id]?.length ? "Write It Again" : "Say It Like Zzzap";
        }
    });
    return row;
}

function pickedBlock(item) {
    const p = picks[item.id];
    const wrap = el("div", "voice-option chosen");
    wrap.append(wordsBlock(p, ""), el("span", "voice-option-pick", "Picked"));
    return wrap;
}

function renderVersions(item, results) {
    results.replaceChildren(...versions[item.id].map(option => {
        const isPicked = picks[item.id]?.versionId === option.id;
        const row = el("button", `voice-option${isPicked ? " chosen" : ""}`);
        row.type = "button";
        row.append(wordsBlock(option, ""), el("span", "voice-option-pick", isPicked ? "Picked" : "Pick"));
        row.addEventListener("click", () => {
            picks[item.id] = { versionId: option.id, title: option.title, body: option.body, button: option.button, plain: option.plain };
            savePicks();
            renderVersions(item, results);
            const state = results.parentElement.querySelector(".appwords-state");
            state.textContent = "Picked";
            state.classList.add("done");
        });
        return row;
    }));
}

// ---------- Getting the picks back to Claude ----------

function picksForClaude() {
    const items = allItems();
    return {
        about: "Zzzap Official app words picked in Say It Like Zzzap. Claude: put these into the app.",
        savedAt: new Date().toISOString(),
        listUpdated: list?.updated || null,
        picks: Object.fromEntries(items.filter(i => picks[i.id]).map(i => [i.id, picks[i.id]])),
        notPickedYet: items.filter(i => !picks[i.id]).map(i => i.id)
    };
}

function updateFooter() {
    const items = allItems();
    const done = items.filter(i => picks[i.id]).length;
    $("appwords-count").textContent = items.length ? `${done} of ${items.length} picked` : "";
}

function setStatus(message, kind = "") {
    const status = $("appwords-status");
    status.textContent = message;
    status.className = `status-message ${kind}`;
}

$("appwords-save").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(picksForClaude(), null, 2)], { type: "application/json" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = "zzzap-app-words.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Saved to your Downloads as zzzap-app-words.json. Tell Claude it's there.", "success");
});

$("appwords-copy").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(JSON.stringify(picksForClaude(), null, 2));
        setStatus("Copied. Paste it to Claude.", "success");
    } catch {
        setStatus("Couldn't copy. Use Save for Claude instead.", "error");
    }
});
