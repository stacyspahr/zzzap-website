// Admin console → Ladder (Stacy 2026-11-17): the notes ladder's control panel.
// How it's going (counts only, never who), and every part of the ladder:
// steps (add, remove, reorder, turn off), words, what each button opens,
// what counts as doing it (done first = skipped), and the pacing.
//
// Words only come from Say It Like Zzzap: a step can't be saved until its
// words were written and picked there, and changing what it should say or
// the button means writing it again. The server checks the same thing.
//
// Two admin-only functions (functions/index.js, helpers in functions/ladder.js):
//   getLadder()    the saved ladder (or the app's built-in one) + totals
//   saveLadder({ baseVersion, pacing, steps })   saves config/ladder
// The app (NotesLadder.swift) reads config/ladder each session.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const app = getApp();
const functions = getFunctions(app);
const $ = id => document.getElementById(id);

// What a button can open: value → [label, action, buttonFor (what Say It
// Like Zzzap is told the button opens)]. Same places the app knows.
const BUTTONS = {
    "": ["No button", null, null],
    "tab:create": ["New", { type: "tab", tab: "create" }, "the New tab"],
    "screen:newStorm": ["New, set to Storm", { type: "screen", screen: "newStorm" }, "the New tab set to Storm"],
    "screen:newPhoto": ["New, with photo choices", { type: "screen", screen: "newPhoto" }, "the New tab with photo choices on"],
    "screen:makeCircle": ["Make a Circle", { type: "screen", screen: "makeCircle" }, "the Make a Circle screen"],
    "screen:lockScreenVote": ["Lock Screen voting video", { type: "screen", screen: "lockScreenVote" }, "a short video showing how"],
    "screen:invitePeople": ["Invite people", { type: "screen", screen: "invitePeople" }, "a page for inviting people by text"],
    "screen:feedback": ["Send Feedback", { type: "screen", screen: "feedback" }, "a form to send us feedback"],
    "tab:zzzaps": ["Zzzaps tab", { type: "tab", tab: "zzzaps" }, "the Zzzaps tab"],
    "tab:people": ["People tab", { type: "tab", tab: "people" }, "the People tab"],
    "tab:me": ["Me tab", { type: "tab", tab: "me" }, "the Me tab"],
    "link": ["A web page", null, "a web page"],
};

// What counts as doing it. Done before the card ever shows = skipped.
const DONE_WHEN = {
    sentZzzap: "Sends a zzzap",
    sentStorm: "Sends a Storm",
    sentPhoto: "Sends a photo zzzap",
    madeCircle: "Makes a circle",
    lockScreenVote: "Votes from the Lock Screen",
    tappedButton: "Taps the button",
};

const PACING = [
    ["quietFirstDays", "Days with no card after signing up"],
    ["opensBetweenSteps", "App opens between steps"],
    ["daysBetweenSteps", "Days between steps"],
    ["visitsBeforeClose", "Visits before a card closes on its own"],
    ["opensAfterClose", "App opens before a closed card comes back"],
    ["closesBeforeMovingOn", "Closes before moving on to the next step"],
];

let saved = null;     // what getLadder returned
let steps = [];       // working copy: { id, on, doneWhen, buttonKey, link, title, body, label, plain, voiceVersionId, keepWords, writtenFor, isNew }
let pacing = {};
let totals = null;
let limits = {};
let editing = null;   // index of the step open in the editor
let versions = [];    // the last 3 from Say It Like Zzzap, for the open step
let dirty = false;
let loading = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text, className, onClick) {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

function show(name) {
    document.querySelectorAll(".ladder-view").forEach(v => { v.hidden = v.dataset.ladderView !== name; });
    window.scrollTo({ top: 0 });
}

function setStatus(message, kind = "") {
    const status = $("ladder-status");
    status.textContent = message;
    status.className = `status-message ${kind}`;
}

// ---------- Loading ----------

function keyFor(action) {
    if (!action) return "";
    if (action.type === "link") return "link";
    return `${action.type}:${action.tab || action.screen}`;
}

function actionFor(step) {
    if (step.buttonKey === "link") return { type: "link", url: step.link.trim() };
    return BUTTONS[step.buttonKey]?.[1] || null;
}

function buttonForOf(step) {
    return BUTTONS[step.buttonKey]?.[2] || null;
}

async function load() {
    if (loading) return;
    loading = true;
    $("ladder-summary").replaceChildren(el("p", "surge-muted", "Loading…"));
    $("ladder-steps").replaceChildren();
    try {
        const { data } = await httpsCallable(functions, "getLadder", { timeout: 120000 })();
        saved = data;
        totals = data.totals;
        limits = data.choices.pacingLimits;
        pacing = { ...data.ladder.pacing };
        steps = data.ladder.steps.map(s => ({
            id: s.id,
            on: s.on !== false,
            doneWhen: s.doneWhen,
            buttonKey: keyFor(s.button?.action),
            link: s.button?.action?.type === "link" ? s.button.action.url : "",
            title: s.title,
            body: s.body,
            label: s.button?.label || "",
            plain: s.plain || "",
            voiceVersionId: s.voiceVersionId || null,
            keepWords: true,
            // Kept words count as written for the button they were saved with.
            writtenFor: { plain: s.plain || "", buttonKey: keyFor(s.button?.action) },
            isNew: false,
        }));
        dirty = false;
        renderList();
        setStatus("");
    } catch (err) {
        $("ladder-summary").replaceChildren(el("p", "status-message error", err.message || "Couldn't load the ladder."));
    } finally {
        loading = false;
    }
}

// ---------- The voice gate ----------

// Why a step can't be saved yet, or null if it can.
function blocker(step) {
    if (!step.title) return "Needs Say It Like Zzzap";
    const hasButton = step.buttonKey !== "";
    if (step.writtenFor.plain !== step.plain || step.writtenFor.buttonKey !== step.buttonKey) return "Needs Say It Like Zzzap again";
    if (step.buttonKey === "link" && !/^https:\/\/\S+$/.test(step.link.trim())) return "Needs a link starting with https://";
    if (step.doneWhen === "tappedButton" && !hasButton) return "\"Taps the button\" needs a button";
    return null;
}

function canSave() {
    return dirty && steps.length > 0 && steps.some(s => s.on) && steps.every(s => !blocker(s));
}

function markDirty() {
    dirty = true;
    updateSaveBar();
}

function updateSaveBar() {
    const blocked = steps.map((s, i) => [i, blocker(s)]).filter(([, b]) => b);
    $("ladder-save").disabled = !canSave();
    $("ladder-unsaved").textContent = !dirty ? "" : blocked.length
        ? `Step ${blocked[0][0] + 1}: ${blocked[0][1]}`
        : "Not saved";
}

// ---------- The list ----------

function pct(part, whole) {
    return whole ? `${Math.round((100 * part) / whole)}%` : "–";
}

function statBox(title, value, detail) {
    const box = el("div", "stat-box");
    box.append(el("div", "stat-title", title), el("div", "stat-value", String(value)));
    if (detail) box.append(el("div", "stat-detail", detail));
    return box;
}

function renderSummary() {
    const t = totals;
    const grid = el("div", "stats-grid");
    const f = t.sentLastWeek.finished;
    const o = t.sentLastWeek.onLadder;
    grid.append(
        statBox("On the ladder", t.people),
        statBox("Card up now", t.onSomethingNow),
        statBox("Finished", t.finished),
        statBox("Turned it off", t.off),
        statBox("Sent this week, finished", pct(f.sent, f.people), `${f.sent} of ${f.people}`),
        statBox("Sent this week, still going", pct(o.sent, o.people), `${o.sent} of ${o.people}`),
    );
    $("ladder-summary").replaceChildren(grid);
}

function statsFor(id) {
    return totals?.steps.find(s => s.id === id) || null;
}

function renderList() {
    renderSummary();
    const table = el("table", "ladder-table");
    const head = el("tr");
    ["", "Step", "Shown", "Views", "Button", "✕", "Timed out", "Did it", "Knew it", "Gave up", "Now"].forEach(h => head.append(el("th", "", h)));
    table.append(head);

    steps.forEach((step, i) => {
        const s = statsFor(step.id);
        const row = el("tr", `ladder-row${step.on ? "" : " off"}`);
        row.tabIndex = 0;
        row.addEventListener("click", () => openStep(i));
        row.addEventListener("keydown", e => { if (e.key === "Enter") openStep(i); });
        const name = el("td", "ladder-name");
        name.append(el("div", "", step.title || "New step"));
        const sub = [DONE_WHEN[step.doneWhen], step.on ? null : "Off", blocker(step)].filter(Boolean).join(" · ");
        name.append(el("div", "surge-muted", sub));
        row.append(el("td", "ladder-num", String(i + 1)), name);
        const nums = s ? [s.shown, s.views, s.taps, s.xs, s.timeouts, s.didIt, s.alreadyKnew, s.gaveUp, s.onItNow] : Array(9).fill("–");
        nums.forEach(n => row.append(el("td", "ladder-count", String(n))));
        table.append(row);

        // The people card always sits second: it's its own card in the app.
        if (i === 0) {
            const people = el("tr", "ladder-row fixed");
            const cell = el("td", "ladder-name");
            cell.colSpan = 10;
            cell.append(el("div", "", "1 of 3 people connected"), el("div", "surge-muted", "People card · until 3 people are connected · changed in an app update"));
            people.append(el("td", "ladder-num", ""), cell);
            table.append(people);
        }
    });
    const wrap = el("div", "ladder-table-wrap");
    wrap.append(table);
    $("ladder-steps").replaceChildren(wrap);
    $("ladder-add").disabled = steps.length >= (saved?.choices.maxSteps || 12);
    renderPacing();
    updateSaveBar();
}

function renderPacing() {
    const box = $("ladder-pacing");
    box.replaceChildren(...PACING.map(([key, label]) => {
        const row = el("div", "form-row ladder-pace");
        const id = `ladder-pace-${key}`;
        const lab = el("label", "", label);
        lab.htmlFor = id;
        const input = el("input");
        input.type = "number";
        input.id = id;
        const [min, max] = limits[key] || [0, 60];
        input.min = min;
        input.max = max;
        input.step = 1;
        input.value = pacing[key];
        input.addEventListener("input", () => {
            const n = Number(input.value);
            if (Number.isInteger(n) && n >= min && n <= max) {
                pacing[key] = n;
                input.classList.remove("bad");
                markDirty();
            } else {
                input.classList.add("bad");
                $("ladder-save").disabled = true;
            }
        });
        row.append(lab, input);
        return row;
    }));
}

$("ladder-add").addEventListener("click", () => {
    steps.push({
        id: `s${Date.now().toString(36)}`,
        on: true, doneWhen: "tappedButton", buttonKey: "tab:create", link: "",
        title: "", body: "", label: "", plain: "", voiceVersionId: null, keepWords: false,
        writtenFor: { plain: null, buttonKey: null }, isNew: true,
    });
    markDirty();
    openStep(steps.length - 1);
});

$("ladder-refresh").addEventListener("click", () => {
    if (dirty && !confirm("Throw away the changes you haven't saved?")) return;
    load();
});

$("ladder-save").addEventListener("click", async () => {
    if (!canSave()) return;
    const save = $("ladder-save");
    save.disabled = true;
    save.textContent = "Saving…";
    try {
        const { data } = await httpsCallable(functions, "saveLadder")({
            baseVersion: saved.ladder.version,
            pacing,
            steps: steps.map(s => ({
                id: s.id,
                on: s.on,
                doneWhen: s.doneWhen,
                buttonAction: actionFor(s),
                ...(s.keepWords ? { keepWords: true } : { voiceVersionId: s.voiceVersionId }),
            })),
        });
        await load();
        setStatus(`Saved. Phones pick it up the next time Zzzap opens (version ${data.version}).`, "success");
    } catch (err) {
        setStatus(err.message || "Couldn't save. Try again.", "error");
    } finally {
        save.textContent = "Save";
        updateSaveBar();
    }
});

// ---------- One step ----------

function wordsBlock(words) {
    const block = el("div", "");
    block.append(el("div", "voice-option-title", words.title), el("div", "voice-option-body", words.body));
    if (words.label) block.append(el("div", "voice-option-button", words.label));
    return block;
}

function openStep(i) {
    editing = i;
    versions = [];
    renderStep();
    show("step");
}

$("ladder-step-close").addEventListener("click", () => {
    editing = null;
    renderList();
    show("list");
});

function renderStep() {
    const step = steps[editing];
    $("ladder-step-title").textContent = `Step ${editing + 1}`;
    const box = $("ladder-step");
    const s = statsFor(step.id);

    // Its numbers.
    const numbers = el("div", "card surge-panel-card");
    if (s && s.shown + s.alreadyKnew > 0) {
        const grid = el("div", "stats-grid");
        grid.append(
            statBox("Shown", s.shown, `${s.views} views`),
            statBox("Did it after the card", s.didIt, s.medianDaysToDone == null ? "" : `Usually ${Math.round(s.medianDaysToDone * 10) / 10} days after it showed`),
            statBox("Already knew it", s.alreadyKnew, "Skipped"),
            statBox("Tapped the button", s.taps),
            statBox("Tapped ✕", s.xs),
            statBox("Closed on its own", s.timeouts),
            statBox("Gave up", s.gaveUp, "Closed it twice, moved on"),
            statBox("Card up now", s.onItNow),
        );
        numbers.append(grid);
    } else {
        numbers.append(el("p", "surge-muted", step.isNew ? "New step. Numbers show once it's saved and on phones." : "Nobody has seen this one yet."));
    }

    // Settings.
    const form = el("div", "card surge-panel-card");

    const onRow = el("label", "ladder-check");
    const on = el("input");
    on.type = "checkbox";
    on.checked = step.on;
    on.addEventListener("change", () => { step.on = on.checked; markDirty(); });
    onRow.append(on, el("span", "", "On"));
    form.append(onRow);

    form.append(selectRow("Done when someone", "ladder-done", DONE_WHEN, step.doneWhen, value => {
        step.doneWhen = value;
        markDirty();
        renderStep();
    }), el("p", "surge-muted ladder-hint", "Already did it: skipped."));

    form.append(selectRow("Button opens", "ladder-button",
        Object.fromEntries(Object.entries(BUTTONS).map(([k, v]) => [k, v[0]])), step.buttonKey, value => {
            step.buttonKey = value;
            markDirty();
            renderStep();
        }));
    if (step.buttonKey === "link") {
        const row = el("div", "form-row");
        const lab = el("label", "", "Link");
        lab.htmlFor = "ladder-link";
        const input = el("input");
        input.type = "text";
        input.id = "ladder-link";
        input.placeholder = "https://";
        input.value = step.link;
        input.addEventListener("input", () => { step.link = input.value; markDirty(); });
        row.append(lab, input);
        form.append(row);
    }

    // Words.
    const words = el("div", "card surge-panel-card");
    words.append(el("h3", "surge-h3", "Words"));
    if (step.title) {
        const current = el("div", "appwords-current");
        current.append(wordsBlock(step));
        words.append(current);
    }
    const draftRow = el("div", "form-row ladder-draft-row");
    const lab = el("label", "", "What it should say");
    lab.htmlFor = "ladder-draft";
    const draft = el("textarea", "appwords-draft");
    draft.id = "ladder-draft";
    draft.maxLength = 1000;
    draft.value = step.plain;
    draftRow.append(lab, draft);
    const state = el("p", "ladder-gate");
    const refreshGate = () => {
        const b = blocker(step);
        state.textContent = b || "Written in the Zzzap voice";
        state.classList.toggle("done", !b);
    };
    draft.addEventListener("input", () => { step.plain = draft.value; markDirty(); refreshGate(); });
    refreshGate();

    const say = button(versions.length ? "Write It Again" : "Say It Like Zzzap", "btn-primary", async () => {
        const text = step.plain.trim();
        if (!text) { results.replaceChildren(el("p", "status-message error", "Type what it should say first.")); return; }
        say.disabled = true;
        say.textContent = "Writing…";
        results.replaceChildren(el("p", "surge-muted", "Writing 3 versions in the Zzzap voice…"));
        try {
            const { data } = await httpsCallable(functions, "rewriteInZzzapVoice", { timeout: 120000 })({ draft: text, buttonFor: buttonForOf(step) });
            versions = data.options.map(o => ({ ...o, writtenFor: { plain: step.plain, buttonKey: step.buttonKey } }));
            renderVersions(step, results, refreshGate);
        } catch (err) {
            results.replaceChildren(el("p", "status-message error", err.message || "Couldn't write it. Try again."));
        } finally {
            say.disabled = false;
            say.textContent = versions.length ? "Write It Again" : "Say It Like Zzzap";
        }
    });
    const results = el("div", "voice-results");
    words.append(draftRow, state, say, results);
    if (versions.length) renderVersions(step, results, refreshGate);

    // Order and remove.
    const order = el("div", "card surge-panel-card ladder-order");
    const up = button("Move Up", "btn-secondary", () => move(-1));
    const down = button("Move Down", "btn-secondary", () => move(1));
    up.disabled = editing === 0;
    down.disabled = editing === steps.length - 1;
    const remove = button("Remove Step", "btn-secondary ladder-remove", () => {
        if (!confirm("Remove this step? People who already did it keep that, and it stops showing.")) return;
        steps.splice(editing, 1);
        editing = null;
        markDirty();
        renderList();
        show("list");
    });
    remove.disabled = steps.length === 1;
    order.append(up, down, remove);

    const left = el("div");
    left.append(words, form, numbers, order);
    const grid = el("div", "notes-grid");
    grid.append(left, previewCard(step));
    box.replaceChildren(grid);
}

// What it looks like on Home: the app's Zzzap Official card (ZzzapNoteCard).
let previewEls = null;

function previewCard(step) {
    const card = el("div", "card ladder-preview-card");
    card.append(el("h2", "", "Preview"));
    const phone = el("div", "note-phone");
    const note = el("div", "ladder-note");
    const top = el("div", "ladder-note-top");
    const avatar = el("img", "ladder-note-avatar");
    avatar.src = "zzzap-bolts.svg";
    avatar.alt = "";
    top.append(avatar, el("span", "", "Zzzap Official"));
    const title = el("div", "ladder-note-title");
    const body = el("div", "ladder-note-body");
    const btn = el("div", "ladder-note-button");
    note.append(el("span", "ladder-note-x", "✕"), top, title, body, btn);
    phone.append(el("div", "note-status-line", "All caught up."), note);
    card.append(phone);
    previewEls = { title, body, btn };
    showPreview(step);
    return card;
}

// The step's words, or a version being looked at (hover).
function showPreview(step, words) {
    if (!previewEls) return;
    const w = words || { title: step.title, body: step.body, label: step.label };
    previewEls.title.textContent = w.title || "Title";
    previewEls.title.classList.toggle("note-placeholder", !w.title);
    previewEls.body.textContent = w.body || "Say It Like Zzzap, then pick a version to see it here.";
    previewEls.body.classList.toggle("note-placeholder", !w.body);
    previewEls.btn.hidden = step.buttonKey === "";
    previewEls.btn.textContent = w.label || "Button";
}

function renderVersions(step, results, refreshGate) {
    results.replaceChildren(...versions.map(option => {
        const isPicked = step.voiceVersionId === option.id && !step.keepWords;
        const row = el("button", `voice-option${isPicked ? " chosen" : ""}`);
        row.type = "button";
        row.append(wordsBlock({ title: option.title, body: option.body, label: option.button }), el("span", "voice-option-pick", isPicked ? "Picked" : "Pick"));
        row.addEventListener("mouseenter", () => showPreview(step, { title: option.title, body: option.body, label: option.button }));
        row.addEventListener("mouseleave", () => showPreview(step));
        row.addEventListener("click", () => {
            step.title = option.title;
            step.body = option.body;
            step.label = option.button || "";
            step.voiceVersionId = option.id;
            step.keepWords = false;
            step.writtenFor = option.writtenFor;
            markDirty();
            renderStep();
        });
        return row;
    }));
    refreshGate();
}

function selectRow(label, id, options, value, onChange) {
    const row = el("div", "form-row");
    const lab = el("label", "", label);
    lab.htmlFor = id;
    const select = el("select");
    select.id = id;
    Object.entries(options).forEach(([k, text]) => {
        const option = el("option", "", text);
        option.value = k;
        select.append(option);
    });
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    row.append(lab, select);
    return row;
}

function move(by) {
    const to = editing + by;
    if (to < 0 || to >= steps.length) return;
    [steps[editing], steps[to]] = [steps[to], steps[editing]];
    editing = to;
    markDirty();
    renderStep();
}

// ---------- Start ----------

const auth = getAuth(app);

// Loads the first time the tab opens (and again with Refresh).
function maybeLoad() {
    const panel = document.querySelector('.admin-panel[data-panel="ladder"]');
    if (panel && !panel.hidden && !saved && auth.currentUser) load();
}
document.querySelector('.admin-tab[data-tab="ladder"]').addEventListener("click", () => setTimeout(maybeLoad, 0));
onAuthStateChanged(auth, () => setTimeout(maybeLoad, 0));

window.addEventListener("beforeunload", e => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
});
