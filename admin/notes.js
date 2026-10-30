// Admin console → Zzzap Official → Notes (1.1.x, Stacy 2026-10-30).
// Write a "From Zzzap" note (a Home card, no push), pick who gets it,
// check who'll be skipped, then send, schedule, save a draft, or test.
//
// Everything goes through three admin-only server functions (Zak's half,
// spec: backend/OFFICIAL-NOTES-SPEC.md in the app repo):
//   previewOfficialNote({ audience })          who would get it, who's skipped
//   saveOfficialNote({ noteId?, ..., action }) draft / schedule / send / test
//   deleteOfficialNote({ noteId })             delete a draft, cancel a scheduled one
// Until they're deployed, the screen shows sample numbers and says so.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, where, orderBy, limit, getDocs, getDoc, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { loadVoice, renderVoice } from "./voice-view.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

const $ = id => document.getElementById(id);
const els = {
    form: $("note-form"),
    title: $("note-title"),
    body: $("note-body"),
    action: $("note-action"),
    buttonRow: $("note-button-row"),
    buttonLabel: $("note-button-label"),
    linkRow: $("note-link-row"),
    link: $("note-link"),
    peopleRow: $("note-people-row"),
    search: $("note-people-search"),
    results: $("note-people-results"),
    chips: $("note-people-chips"),
    scheduleToggle: $("note-schedule-toggle"),
    scheduleRow: $("note-schedule-row"),
    sendAt: $("note-send-at"),
    check: $("note-check"),
    checkBtn: $("note-check-btn"),
    testBtn: $("note-test-btn"),
    draftBtn: $("note-draft-btn"),
    sendBtn: $("note-send-btn"),
    status: $("note-status"),
    drafts: $("note-drafts"),
    sent: $("note-sent"),
    previewTitle: $("note-preview-title"),
    previewBody: $("note-preview-body"),
    previewButton: $("note-preview-button"),
};

const DEFAULT_BUTTON_WORDS = { "screen:feedback": "Send Feedback" };
const ACTION_NAMES = {
    "tab:home": "Home tab", "tab:zzzaps": "Zzzaps tab", "tab:create": "New tab",
    "tab:people": "People tab", "tab:me": "Me tab", "screen:feedback": "Send Feedback",
};

let picked = new Map();       // uid -> name, for "Everyone except" / "Only"
let editingNoteId = null;     // set while editing a draft or scheduled note
let checkedFingerprint = null; // the payload the last check was for
let checkedCount = 0;
let unsubNotes = null;
const nameCache = new Map();

// ---------- Small helpers (text only, never HTML from data) ----------

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

function setStatus(message, kind = "") {
    els.status.textContent = message;
    els.status.className = `status-message ${kind}`;
}

function serverNotReady(err) {
    return err && (err.code === "functions/not-found" || err.code === "not-found");
}

const WAITING = "This works once Zak's server piece is in (backend/OFFICIAL-NOTES-SPEC.md).";

function audienceMode() {
    return els.form.querySelector('input[name="note-audience"]:checked').value;
}

function formatWhen(date) {
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function nameFor(uid) {
    if (!uid) return "Unknown";
    if (nameCache.has(uid)) return nameCache.get(uid);
    let name = "Unknown";
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) name = snap.data().displayName || name;
    } catch { /* hidden or not readable */ }
    nameCache.set(uid, name);
    return name;
}

// ---------- The note being written ----------

/// What gets sent to the server. Throws a plain message if something's missing.
function buildNote() {
    const title = els.title.value.trim();
    const body = els.body.value.trim();
    if (!title) throw new Error("Add a title.");
    if (!body) throw new Error("Add some text.");

    let btn = null;
    const choice = els.action.value;
    if (choice) {
        const label = els.buttonLabel.value.trim();
        if (!label) throw new Error("Add the button words, or pick No button.");
        let action;
        if (choice === "link") {
            const url = els.link.value.trim();
            if (!/^https:\/\/\S+$/.test(url)) throw new Error("The link has to start with https://");
            action = { type: "link", url };
        } else {
            const [type, value] = choice.split(":");
            action = type === "tab" ? { type, tab: value } : { type, screen: value };
        }
        btn = { label, action };
    }

    const mode = audienceMode();
    const audience = mode === "everyone" ? { mode } : { mode, uids: [...picked.keys()] };
    if (mode === "only" && !audience.uids.length) throw new Error("Pick at least one person.");

    return { title, body, button: btn, audience };
}

/// Milliseconds since 1970 for a scheduled send, or null.
function sendAtMillis() {
    if (!els.scheduleToggle.checked) return null;
    const ms = new Date(els.sendAt.value).getTime();
    if (!els.sendAt.value || Number.isNaN(ms)) throw new Error("Pick when to send it.");
    if (ms < Date.now() + 60 * 1000) throw new Error("Pick a time in the future.");
    return ms;
}

function fingerprint() {
    try { return JSON.stringify([buildNote(), sendAtMillis()]); } catch { return null; }
}

// Any change means the check is stale, so Send turns off again.
function changed() {
    updateCounts();
    updatePreview();
    if (checkedFingerprint && fingerprint() !== checkedFingerprint) {
        checkedFingerprint = null;
        els.check.className = "note-check";
        els.check.replaceChildren(el("p", "surge-muted", "Something changed. Check who gets it again."));
    }
    updateSendButton();
}

function updateSendButton() {
    const ready = checkedFingerprint !== null && checkedFingerprint === fingerprint();
    els.sendBtn.disabled = !ready;
    const scheduled = els.scheduleToggle.checked;
    if (!ready) els.sendBtn.textContent = scheduled ? "Schedule" : "Send";
    else els.sendBtn.textContent = `${scheduled ? "Schedule for" : "Send to"} ${checkedCount} ${checkedCount === 1 ? "Person" : "People"}`;
}

function updateCounts() {
    document.querySelectorAll(".note-count").forEach(span => {
        const input = $(span.dataset.for);
        span.textContent = `${input.value.length}/${input.maxLength}`;
    });
}

function updatePreview() {
    const title = els.title.value.trim();
    const body = els.body.value.trim();
    els.previewTitle.textContent = title || "Title";
    els.previewTitle.classList.toggle("note-placeholder", !title);
    els.previewBody.textContent = body || "Your text shows here.";
    els.previewBody.classList.toggle("note-placeholder", !body);
    const label = els.buttonLabel.value.trim();
    els.previewButton.hidden = !els.action.value;
    els.previewButton.textContent = label || "Button";
}

function applyAction() {
    const choice = els.action.value;
    els.buttonRow.classList.toggle("hidden", !choice);
    els.linkRow.classList.toggle("hidden", choice !== "link");
    if (choice && !els.buttonLabel.value.trim() && DEFAULT_BUTTON_WORDS[choice]) {
        els.buttonLabel.value = DEFAULT_BUTTON_WORDS[choice];
    }
}

function applyAudience() {
    els.peopleRow.classList.toggle("hidden", audienceMode() === "everyone");
}

els.form.addEventListener("input", changed);
els.form.addEventListener("change", changed);
els.action.addEventListener("change", () => { applyAction(); changed(); });
els.form.querySelectorAll('input[name="note-audience"]').forEach(r =>
    r.addEventListener("change", () => { applyAudience(); changed(); }));
els.scheduleToggle.addEventListener("change", () => {
    els.scheduleRow.classList.toggle("hidden", !els.scheduleToggle.checked);
    changed();
});

// ---------- Picking people ----------

function renderChips() {
    els.chips.replaceChildren(...[...picked].map(([uid, name]) => {
        const chip = el("span", "surge-chip", name);
        chip.append(button("✕", "note-chip-x", () => { picked.delete(uid); renderChips(); changed(); }));
        return chip;
    }));
}

let searchTimer = null;
els.search.addEventListener("input", (e) => {
    e.stopPropagation(); // typing a search isn't a change to the note
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 300);
});

async function runSearch() {
    const text = els.search.value.trim().toLowerCase();
    if (text.length < 2) { els.results.replaceChildren(); return; }
    // Same prefix search the app uses (discoverable accounts only).
    const snap = await getDocs(query(
        collection(db, "users"),
        where("discoverable", "==", true),
        where("displayNameLower", ">=", text),
        where("displayNameLower", "<=", text + "\uf8ff"),
        limit(8)
    ));
    const rows = snap.docs.filter(d => !picked.has(d.id)).map(d => {
        const u = d.data();
        const row = el("div", "surge-row");
        const info = el("div", "surge-info");
        info.append(el("div", "surge-name", u.displayName || "Unnamed"));
        if (u.realName) info.append(el("div", "surge-meta", u.realName));
        row.append(info, button("Add", "btn-secondary", () => {
            picked.set(d.id, u.displayName || "Unnamed");
            nameCache.set(d.id, u.displayName || "Unnamed");
            els.search.value = "";
            els.results.replaceChildren();
            renderChips();
            changed();
        }));
        return row;
    });
    els.results.replaceChildren(...(rows.length ? rows : [el("p", "surge-muted", "No match.")]));
}

// ---------- Check who gets it ----------

els.checkBtn.addEventListener("click", async () => {
    let note;
    try { note = buildNote(); sendAtMillis(); } catch (err) { setStatus(err.message, "error"); return; }
    setStatus("");
    els.checkBtn.disabled = true;
    els.check.className = "note-check";
    els.check.replaceChildren(el("p", "surge-muted", "Checking…"));
    try {
        const { data } = await httpsCallable(functions, "previewOfficialNote")({ audience: note.audience });
        showCheck(data);
        checkedCount = data.willGet;
        checkedFingerprint = data.willGet > 0 ? fingerprint() : null;
    } catch (err) {
        checkedFingerprint = null;
        if (serverNotReady(err)) await showSampleCheck(note.audience);
        else els.check.replaceChildren(el("p", "status-message error", `Couldn't check: ${err.message}`));
    } finally {
        els.checkBtn.disabled = false;
        updateSendButton();
    }
});

function showCheck(data) {
    const skipped = data.skippedCount ?? data.skipped.length;
    const line = el("p");
    line.append(el("strong", "", `${data.willGet} will get this.`));
    line.append(document.createTextNode(skipped
        ? ` ${skipped} skipped because they already got a note or Official zzzap this week.`
        : " Nobody skipped."));
    const parts = [line];
    if (data.skipped.length) {
        const more = el("details");
        more.append(el("summary", "", "Who's skipped"));
        more.append(el("p", "", data.skipped.map(s => s.name || "Unnamed").join(", ")
            + (skipped > data.skipped.length ? `, and ${skipped - data.skipped.length} more` : "")));
        parts.push(more);
    }
    if (!data.willGet) parts.push(el("p", "surge-muted", "Nobody to send to, so Send stays off."));
    els.check.className = `note-check${data.willGet ? " ready" : ""}`;
    els.check.replaceChildren(...parts);
}

// Before Zak's piece is in: a rough count so the screen can be tried out.
async function showSampleCheck(audience) {
    let total = 0;
    try {
        const snap = await getDoc(doc(db, "users", "zzzap_official"));
        total = (snap.data()?.followers || []).length;
    } catch { /* leave at 0 */ }
    let estimate = total;
    if (audience.mode === "only") estimate = audience.uids.length;
    if (audience.mode === "everyoneExcept") estimate = Math.max(0, total - audience.uids.length);
    els.check.className = "note-check";
    els.check.replaceChildren(
        el("p", "", `Sample: about ${estimate} would get this. Who's skipped for the weekly limit shows once Zak's piece is in.`),
        el("p", "surge-muted", "Send stays off until then."),
    );
}

// ---------- Send, schedule, draft, test ----------

async function save(action) {
    let note, sendAt = null;
    try {
        note = buildNote();
        if (action === "send") sendAt = sendAtMillis();
    } catch (err) { setStatus(err.message, "error"); return; }

    const scheduling = action === "send" && sendAt !== null;
    if (action === "send") {
        const who = `${checkedCount} ${checkedCount === 1 ? "person" : "people"}`;
        const ask = scheduling
            ? `Schedule "${note.title}" for ${formatWhen(new Date(sendAt))}? About ${who} (the weekly limit is checked again when it sends).`
            : `Send "${note.title}" to ${who} now? This can't be taken back.`;
        if (!confirm(ask)) return;
    }

    const buttons = [els.testBtn, els.draftBtn, els.sendBtn];
    buttons.forEach(b => { b.disabled = true; });
    setStatus(action === "draft" ? "Saving…" : "Sending…");
    try {
        const { data } = await httpsCallable(functions, "saveOfficialNote")({
            ...note,
            noteId: editingNoteId,
            action: scheduling ? "schedule" : action,
            sendAt,
        });
        if (action === "draft") {
            editingNoteId = data.noteId;
            setStatus("Draft saved.", "success");
        } else if (action === "test") {
            setStatus("Sent to you. Open Zzzap to see it on Home.", "success");
        } else {
            setStatus(scheduling
                ? `Scheduled for ${formatWhen(new Date(sendAt))}.`
                : `Sent to ${data.delivered}. ${data.skipped ? `${data.skipped} skipped.` : ""}`, "success");
            clearForm();
        }
    } catch (err) {
        // The website login isn't the app login, so a test needs the
        // admin's app account linked on their admins doc (appUid).
        const notLinked = action === "test" && err.code === "functions/failed-precondition";
        setStatus(serverNotReady(err) ? WAITING
            : notLinked ? "Your app account isn't linked yet. Ask Zak to add it."
            : `Couldn't ${action === "draft" ? "save" : "send"}: ${err.message}`, "error");
    } finally {
        els.testBtn.disabled = false;
        els.draftBtn.disabled = false;
        updateSendButton();
    }
}

els.testBtn.addEventListener("click", () => save("test"));
els.draftBtn.addEventListener("click", () => save("draft"));
els.form.addEventListener("submit", (e) => { e.preventDefault(); save("send"); });

function clearForm() {
    els.form.reset();
    picked = new Map();
    editingNoteId = null;
    checkedFingerprint = null;
    els.results.replaceChildren();
    renderChips();
    applyAction();
    applyAudience();
    els.scheduleRow.classList.add("hidden");
    els.check.className = "note-check";
    els.check.replaceChildren(el("p", "surge-muted", "Check who gets it first. Send stays off until you do, and again after any change."));
    changed();
}

// ---------- Drafts, scheduled, sent ----------

async function loadIntoForm(id, n) {
    clearForm();
    editingNoteId = id;
    els.title.value = n.title || "";
    els.body.value = n.body || "";
    const a = n.button?.action;
    els.action.value = !a ? "" : a.type === "link" ? "link" : `${a.type}:${a.tab || a.screen}`;
    els.buttonLabel.value = n.button?.label || "";
    els.link.value = a?.type === "link" ? a.url : "";
    const mode = n.audience?.mode || "everyone";
    els.form.querySelector(`input[name="note-audience"][value="${mode}"]`).checked = true;
    for (const uid of n.audience?.uids || []) picked.set(uid, await nameFor(uid));
    if (n.status === "scheduled" && n.sendAt?.toDate) {
        els.scheduleToggle.checked = true;
        els.scheduleRow.classList.remove("hidden");
        const d = n.sendAt.toDate();
        els.sendAt.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    renderChips();
    applyAction();
    applyAudience();
    changed();
    setStatus(`Editing "${n.title}". Save Draft or Send when ready.`);
    els.form.scrollIntoView({ behavior: "smooth" });
}

async function removeNote(id, n) {
    const ask = n.status === "scheduled" ? `Cancel "${n.title}"? It won't send.` : `Delete the draft "${n.title}"?`;
    if (!confirm(ask)) return;
    try {
        await httpsCallable(functions, "deleteOfficialNote")({ noteId: id });
        if (editingNoteId === id) clearForm();
    } catch (err) {
        setStatus(serverNotReady(err) ? WAITING : `Couldn't remove it: ${err.message}`, "error");
    }
}

function actionSummary(btn) {
    if (!btn) return "No button";
    const a = btn.action || {};
    const where = a.type === "link" ? a.url : ACTION_NAMES[`${a.type}:${a.tab || a.screen}`] || "unknown";
    return `Button "${btn.label}" opens ${where}`;
}

function audienceSummary(aud) {
    const n = aud?.uids?.length || 0;
    if (aud?.mode === "everyoneExcept") return `Everyone except ${n}`;
    if (aud?.mode === "only") return `Only ${n} ${n === 1 ? "person" : "people"}`;
    return "Everyone";
}

async function noteRow(id, n) {
    const row = el("div", "surge-row");
    const info = el("div", "surge-info");
    info.append(el("div", "surge-name", n.title || "Untitled"));
    info.append(el("div", "surge-meta", n.body || ""));
    const by = await nameFor(n.sentBy || n.updatedBy || n.createdBy);
    let meta;
    if (n.status === "sent") {
        const c = n.counts || {};
        const when = n.sentAt?.toDate ? formatWhen(n.sentAt.toDate()) : "";
        meta = [`Sent ${when} by ${by}`, `${c.delivered ?? 0} got it`,
            c.skipped ? `${c.skipped} skipped` : null,
            c.tapped !== undefined ? `${c.tapped} tapped` : null,
            c.dismissed !== undefined ? `${c.dismissed} closed it` : null].filter(Boolean).join(" · ");
    } else if (n.status === "scheduled") {
        const when = n.sendAt?.toDate ? formatWhen(n.sendAt.toDate()) : "";
        meta = `Scheduled for ${when} · ${audienceSummary(n.audience)} · by ${by}`;
    } else if (n.status === "cancelled") {
        meta = `Cancelled · by ${by}`;
    } else {
        meta = `Draft · ${audienceSummary(n.audience)} · by ${by}`;
    }
    info.append(el("div", "surge-meta", meta));
    info.append(el("div", "surge-meta", actionSummary(n.button)));
    row.append(info);

    if (n.status === "draft" || n.status === "scheduled") {
        const actions = el("div", "note-row-actions");
        actions.append(
            button("Edit", "btn-secondary", () => loadIntoForm(id, n)),
            button(n.status === "scheduled" ? "Cancel" : "Delete", "btn-danger", () => removeNote(id, n)),
        );
        row.append(actions);
    }
    return row;
}

function startNotesListener() {
    const q = query(collection(db, "officialNotes"), orderBy("createdAt", "desc"), limit(40));
    unsubNotes = onSnapshot(q, async (snap) => {
        const docs = snap.docs.map(d => [d.id, d.data()]);
        const open = docs.filter(([, n]) => n.status === "draft" || n.status === "scheduled");
        const done = docs.filter(([, n]) => n.status === "sent" || n.status === "cancelled");
        els.drafts.replaceChildren(...(open.length
            ? await Promise.all(open.map(([id, n]) => noteRow(id, n)))
            : [el("p", "surge-muted", "None.")]));
        els.sent.replaceChildren(...(done.length
            ? await Promise.all(done.map(([id, n]) => noteRow(id, n)))
            : [el("p", "surge-muted", "No notes sent yet.")]));
    }, () => {
        // Rules or the collection aren't there yet.
        const waiting = el("p", "surge-muted", "Shows up once Zak's server piece is in.");
        els.drafts.replaceChildren(waiting);
        els.sent.replaceChildren(waiting.cloneNode(true));
    });
}

// ---------- The Zzzap voice, open while writing ----------

const voiceDialog = $("note-voice");
$("note-voice-btn").addEventListener("click", async () => {
    voiceDialog.showModal();
    try {
        $("note-voice-body").replaceChildren(...renderVoice(await loadVoice()));
    } catch (err) {
        $("note-voice-body").replaceChildren(el("p", "status-message error", `Couldn't load the voice guide: ${err.message}`));
    }
});
$("note-voice-close").addEventListener("click", () => voiceDialog.close());

// ---------- Start once signed in ----------

onAuthStateChanged(auth, user => {
    if (unsubNotes) { unsubNotes(); unsubNotes = null; }
    if (!user) { clearForm(); nameCache.clear(); return; }
    startNotesListener();
});

clearForm();
