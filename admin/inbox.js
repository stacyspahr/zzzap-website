// Admin console → Inbox (Stacy 2026-11-04). "Someone is waiting on us":
// Reports (comments and zzzaps people reported) and Data Requests (Me →
// Request My Data). A dot on the tab while anything needs action.
//
// Reading and the buttons need Zak's server half (BACKLOG → "Inbox on the
// admin site: Reports + Data Requests"):
//   read rule on reports + dataExportRequests for admins
//   reviewReport({ reportId, action })   action: dismiss | removeContent | warn | suspend;
//                                        writes reviewed, reviewAction, reviewedAt, reviewedBy(Name)
//   markDataExportSent({ requestId })    status → "fulfilled", fulfilledAt, fulfilledBy(Name)
// Accounts that can't read reports (not in admins) see a plain message.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, orderBy, limit, getDocs, getDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const REPORT_GOAL_MS = DAY;        // reports: looked at within 24 hours
const DATA_REQUEST_DUE_MS = 30 * DAY; // data requests: answered within 30 days

const els = {
    tab: document.querySelector('.admin-tab[data-tab="inbox"]'),
    status: document.getElementById("inbox-status"),
    refresh: document.getElementById("inbox-refresh"),
    reportsOpen: document.getElementById("reports-open"),
    reportsDone: document.getElementById("reports-done"),
    requestsOpen: document.getElementById("requests-open"),
    requestsDone: document.getElementById("requests-done"),
    feedbackOpen: document.getElementById("feedback-open"),
    feedbackDone: document.getElementById("feedback-done"),
    sectionButtons: [...document.querySelectorAll(".admin-tab[data-inbox-section]")],
    sections: [...document.querySelectorAll(".inbox-section")],
};

const ACTION_DONE = {
    dismiss: "Dismissed",
    removeContent: "Removed",
    warn: "Removed and warned",
    suspend: "Removed and suspended",
};

// ---------- Small helpers (text only, never HTML from data) ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function setStatus(message, kind = "") {
    els.status.textContent = message;
    els.status.className = `status-message ${kind}`;
}

function serverNotReady(err) {
    return err && (err.code === "functions/not-found" || err.code === "not-found");
}

function denied(err) {
    return err && (err.code === "permission-denied" || err.code === "firestore/permission-denied");
}

function toMillis(t) {
    if (!t) return 0;
    if (typeof t.toMillis === "function") return t.toMillis();
    if (t instanceof Date) return t.getTime();
    return Number(t) || 0;
}

/// "3 hours", "2 days". Rounds down, never below 1 minute.
function span(ms) {
    const minutes = Math.max(1, Math.floor(ms / 60000));
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"}`;
}

function shortDate(ms) {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dateTime(ms) {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Accounts by id, looked up once each: name, and whether already suspended.
const accountCache = new Map();
async function accountFor(uid) {
    if (!uid || uid === "system") return null;
    if (accountCache.has(uid)) return accountCache.get(uid);
    const account = { name: `Account ${uid.slice(0, 6)}`, banned: false };
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            account.name = snap.data().displayName || snap.data().realName || account.name;
            account.banned = snap.data().isBanned === true;
        } else {
            account.name = `${account.name} (deleted)`;
        }
    } catch (_) { /* keep the short id */ }
    accountCache.set(uid, account);
    return account;
}

async function nameFor(uid) {
    return (await accountFor(uid))?.name || null;
}

// Admin-site accounts have no users doc and no name on the account, so the
// server stamps their email as the reviewer. Show a first name instead.
const ADMIN_NAMES = {
    "N0VsgL5S59edhJsKi3lxuXV6bzj1": "Stacy",
    "QhHvgTWnm3aweG6OckJ97ZZLthB2": "Zak",
};

async function reviewerName(uid, stamped) {
    return ADMIN_NAMES[uid] || stamped || await nameFor(uid);
}

// ---------- Sections: Reports · Data Requests ----------

function showSection(name) {
    els.sectionButtons.forEach(b => {
        const on = b.dataset.inboxSection === name;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    els.sections.forEach(s => { s.hidden = s.dataset.inboxSection !== name; });
    localStorage.setItem("inboxSection", name);
}
els.sectionButtons.forEach(b => b.addEventListener("click", () => showSection(b.dataset.inboxSection)));
showSection(["requests", "feedback"].includes(localStorage.getItem("inboxSection")) ? localStorage.getItem("inboxSection") : "reports");

/// Count shown on a section button, e.g. "Reports 2".
function setSectionCount(name, count) {
    const button = els.sectionButtons.find(b => b.dataset.inboxSection === name);
    if (!button) return;
    button.querySelector(".inbox-count")?.remove();
    if (count > 0) button.append(el("span", "inbox-count", String(count)));
}

function setTabDot(waiting) {
    if (!els.tab) return;
    els.tab.querySelector(".tab-due")?.remove();
    if (waiting > 0) {
        const dot = el("span", "tab-due");
        dot.title = `${waiting} waiting`;
        els.tab.append(dot);
    }
}

// ---------- Reports ----------

async function loadReports() {
    try {
        const snap = await getDocs(query(collection(db, "reports"), orderBy("timestamp", "desc"), limit(200)));
        const rows = await Promise.all(snap.docs.map(async d => {
            const x = d.data();
            const type = x.type === "comment" ? "comment" : (x.reporterId === "system" ? "system" : "zzzap");
            // The person the report is about: a comment's writer, else the zzzap's creator.
            const offenderId = (type === "comment" ? x.commentAuthorId : x.pollCreatorId) || null;
            const offender = await accountFor(offenderId);
            return {
                id: d.id, ...x, type,
                // The server's own reports are already handled; older ones
                // (before ZZZ-232) were saved without reviewed: true.
                reviewed: x.reviewed === true || type === "system",
                at: toMillis(x.timestamp),
                offenderId,
                offenderBanned: offender?.banned === true,
                authorName: offender?.name || null,
                reporterName: await nameFor(x.reporterId),
                reviewedByName: await reviewerName(x.reviewedBy, x.reviewedByName),
                reviewedAt: toMillis(x.reviewedAt),
            };
        }));
        return { rows, sample: false };
    } catch (err) {
        if (denied(err)) { setStatus("This account can't see reports.", "error"); return { rows: [], sample: false }; }
        throw err;
    }
}

// Claude's suggestion (functions/reportAdvice.js): help thinking, never deciding.
const SUGGESTED = { dismiss: "Dismiss", removeContent: "Remove", warn: "Warn", suspend: "Suspend" };
function suggestionBlock(r) {
    const s = r.aiSuggestion;
    const box = el("div", "inbox-suggestion");
    box.append(el("div", "inbox-suggestion-label", "Suggested by Claude"));
    box.append(el("div", "inbox-suggestion-action",
        `${SUGGESTED[s.action] || s.action}${s.judgmentCall ? " · judgment call" : ""}`));
    box.append(el("div", "inbox-suggestion-reason", s.reason || ""));
    return box;
}

function reportCard(r, history = []) {
    const card = el("div", "inbox-item");
    card.dataset.reportId = r.id;
    const top = el("div", "inbox-item-top");
    const kind = r.type === "comment" ? "Comment" : r.type === "system" ? "Automatic" : "Zzzap";
    top.append(el("span", "inbox-kind", `${kind} · ${r.reason === "auto_moderation" ? "Photo check" : r.reason || "No reason"}`));
    if (!r.reviewed && isRepeat(history)) top.append(el("span", "inbox-repeat", "Repeat"));

    const age = Date.now() - r.at;
    if (!r.reviewed) {
        const late = age > REPORT_GOAL_MS;
        top.append(el("span", late ? "inbox-when inbox-late" : "inbox-when",
            late ? `Waiting ${span(age)}, past the 24 hour goal` : `Waiting ${span(age)}`));
    } else {
        top.append(el("span", "inbox-when", dateTime(r.at)));
    }
    card.append(top);

    if (r.type === "comment") {
        card.append(el("div", "inbox-quote", `“${r.commentText || ""}”`));
        card.append(el("div", "surge-meta", `On “${r.question || "a zzzap"}”`));
    } else if (r.type === "zzzap") {
        card.append(el("div", "inbox-quote", r.question || "No question saved"));
        const extra = [r.isPhotoPoll ? "Photo zzzap" : null, r.alsoBlocked ? "They also blocked the creator" : null].filter(Boolean);
        if (extra.length) card.append(el("div", "surge-meta", extra.join(" · ")));
    } else {
        card.append(el("div", "inbox-quote", r.note || "Handled by the server"));
    }
    if (r.note && r.type !== "system") card.append(el("div", "surge-meta", `Their note: ${r.note}`));

    const who = [];
    if (r.authorName) who.push(`${r.type === "comment" ? "Written by" : "Zzzap by"} ${r.authorName}`);
    if (r.reporterName) who.push(`Reported by ${r.reporterName}`);
    if (who.length) card.append(el("div", "surge-meta", who.join(" · ")));

    if (!r.reviewed && r.aiSuggestion) card.append(suggestionBlock(r));
    if (!r.reviewed) card.append(historyBlock(r, history));
    if (!r.reviewed && r.reporterHistoryText) {
        const line = el("div", r.reportsALot ? "inbox-history-line inbox-late" : "inbox-history-line",
            `${r.reportsALot ? "Reports a lot. " : ""}${r.reporterName || "The reporter"}: ${r.reporterHistoryText}`);
        card.append(line);
    }

    if (r.reviewed) {
        const what = r.type === "system" && !r.reviewAction
            ? "Handled automatically"
            : `${ACTION_DONE[r.reviewAction] || "Reviewed"}${r.reviewedByName ? ` by ${r.reviewedByName}` : ""}${r.reviewedAt ? `, ${dateTime(r.reviewedAt)}` : ""}`
              + (r.reviewAction === "warn" ? (r.warningSeenAt ? ` · seen ${shortDate(toMillis(r.warningSeenAt))}` : " · not seen yet") : "");
        card.append(el("div", "inbox-done-line", what));
        return card;
    }

    const actions = el("div", "inbox-actions");
    const removeLabel = r.type === "comment" ? "Remove Comment" : "Remove Zzzap";
    const buttons = [
        ["Dismiss", "dismiss", "btn-secondary"],
        [removeLabel, "removeContent", "btn-secondary"],
        ["Warn", "warn", "btn-secondary"],
        ["Suspend Account", "suspend", "btn-danger"],
    ];
    for (const [label, action, style] of buttons) {
        const b = el("button", style, label);
        b.type = "button";
        b.addEventListener("click", () => actOnReport(r, action, label, b));
        actions.append(b);
    }
    card.append(actions);
    return card;
}

// ---------- History: every other report about the same person ----------

/// What happened to a report, in a word or two.
function outcome(r) {
    if (!r.reviewed) return "Waiting";
    if (r.type === "system" && !r.reviewAction) return "Removed automatically";
    return ACTION_DONE[r.reviewAction] || "Reviewed";
}

/// Reports that count against someone: content removed, a warning, a
/// suspension, or the server's photo check pulling their photo.
function countsAgainst(r) {
    return r.type === "system" || ["removeContent", "warn", "suspend"].includes(r.reviewAction);
}

/// Repeat offender: anything held against them before, or 2+ other reports.
function isRepeat(history) {
    return history.some(countsAgainst) || history.length >= 2;
}

function historyBlock(r, history) {
    const box = el("div", "inbox-history");
    if (!r.offenderId) return box;
    if (r.offenderBanned) box.append(el("div", "inbox-history-line inbox-late", "This account is already suspended."));
    if (!history.length) {
        box.append(el("div", "inbox-history-line", "First report about them."));
        return box;
    }
    const tally = {};
    for (const h of history) tally[outcome(h)] = (tally[outcome(h)] || 0) + 1;
    const parts = Object.entries(tally).map(([what, n]) => `${n} ${what.toLowerCase()}`);
    const n = history.length;
    box.append(el("div", "inbox-history-line",
        `${n} other report${n === 1 ? "" : "s"} about them: ${parts.join(", ")}`));

    const toggle = el("button", "inbox-link", "See History");
    toggle.type = "button";
    const list = el("div", "inbox-history-list");
    list.hidden = true;
    for (const h of [...history].sort((a, b) => b.at - a.at)) {
        const what = h.type === "comment" ? `“${h.commentText || ""}”`
            : h.type === "zzzap" ? (h.question || "A zzzap")
            : (h.note || "Photo check");
        const kind = h.type === "comment" ? "Comment" : h.type === "zzzap" ? "Zzzap" : "Photo check";
        const reason = h.type === "system" ? "" : ` · ${h.reason || "No reason"}`;
        const row = el("div", "inbox-history-row");
        row.append(el("span", "inbox-history-when", shortDate(h.at)));
        row.append(el("span", "inbox-history-what", `${kind}${reason} · ${outcome(h)}`));
        row.append(el("span", "inbox-history-text", what));
        list.append(row);
    }
    toggle.addEventListener("click", () => {
        list.hidden = !list.hidden;
        toggle.textContent = list.hidden ? "See History" : "Hide History";
    });
    box.append(toggle, list);
    return box;
}

// The server call can take a few seconds (a cold function), so the tapped
// button says it's working and the card's other buttons lock until it's done.
// Without this a tap looked ignored and a second tap went to another button.
const WORKING = {
    dismiss: "Dismissing…", removeContent: "Removing…", warn: "Warning…",
    suspend: "Suspending…", sent: "Saving…",
};

function lockButtons(button, text) {
    const all = [...button.parentElement.querySelectorAll("button")];
    const label = button.textContent;
    all.forEach(b => { b.disabled = true; });
    button.textContent = text;
    button.classList.add("working");
    setStatus(text, "");
    return () => {
        all.forEach(b => { b.disabled = false; });
        button.classList.remove("working");
        button.textContent = label;
    };
}

async function actOnReport(r, action, label, button) {
    const what = r.type === "comment" ? "comment" : "zzzap";
    if (action === "suspend" && !confirm(`Suspend ${r.authorName || "this account"}? The ${what} is removed too, and they won't be able to send, vote or comment.`)) return;
    if (action === "removeContent" && !confirm(`${label}? It disappears for everyone.`)) return;
    if (action === "warn" && !confirm(`Warn ${r.authorName || "them"}? The ${what} is removed, and they get a note on Home saying why, with a link to the guidelines. It never says who reported it.`)) return;
    const unlock = lockButtons(button, WORKING[action]);
    try {
        await httpsCallable(functions, "reviewReport")({ reportId: r.id, action });
        setStatus(`${ACTION_DONE[action]}.`, "success");
        await refresh();
    } catch (err) {
        unlock();
        setStatus(serverNotReady(err)
            ? "This button works once Zak's server piece is in."
            : `Couldn't save: ${err.message}`, "error");
    }
}

function renderReports({ rows, sample }) {
    const open = rows.filter(r => !r.reviewed).sort((a, b) => a.at - b.at); // oldest first
    const done = rows.filter(r => r.reviewed).sort((a, b) => (b.reviewedAt || b.at) - (a.reviewedAt || a.at)).slice(0, 30);
    // Every report about the same person, for each card's history line.
    // (Covers the 200 newest reports the page loads; plenty for now.)
    const byOffender = new Map();
    for (const r of rows) {
        if (!r.offenderId) continue;
        if (!byOffender.has(r.offenderId)) byOffender.set(r.offenderId, []);
        byOffender.get(r.offenderId).push(r);
    }
    const historyOf = r => (byOffender.get(r.offenderId) || []).filter(h => h.id !== r.id);
    // What each reporter has filed: reporting someone over and over for
    // nothing is harassment too (Stacy, 11/6). Same rule as the server email.
    const byReporter = new Map();
    for (const r of rows) {
        if (!r.reporterId || r.type === "system") continue;
        if (!byReporter.has(r.reporterId)) byReporter.set(r.reporterId, []);
        byReporter.get(r.reporterId).push(r);
    }
    for (const r of open) {
        const filed = (byReporter.get(r.reporterId) || []).filter(h => h.id !== r.id);
        if (!filed.length) { r.reporterHistoryText = "first report they've filed"; continue; }
        const tally = {};
        let dismissed = 0, aboutThem = 0, dismissedAboutThem = 0;
        for (const h of filed) {
            const o = outcome(h).toLowerCase();
            tally[o] = (tally[o] || 0) + 1;
            if (h.reviewAction === "dismiss") dismissed++;
            if (h.offenderId && h.offenderId === r.offenderId) {
                aboutThem++;
                if (h.reviewAction === "dismiss") dismissedAboutThem++;
            }
        }
        const n = filed.length;
        r.reporterHistoryText = `${n} other report${n === 1 ? "" : "s"} filed: `
            + Object.entries(tally).map(([o, c]) => `${c} ${o}`).join(", ")
            + (aboutThem ? `. ${aboutThem} about this same person` : "");
        r.reportsALot = (n >= 3 && dismissed / n >= 0.6) || dismissedAboutThem >= 2;
    }
    els.reportsOpen.replaceChildren(...(open.length ? open.map(r => reportCard(r, historyOf(r))) : [el("p", "surge-muted", "Nothing waiting.")]));
    els.reportsDone.replaceChildren(...(done.length ? done.map(r => reportCard(r)) : [el("p", "surge-muted", "None yet.")]));
    if (!sample) focusLinkedReport(rows);
    return sample ? 0 : open.length;
}

// ---------- Opening one report from the email (#inbox/<reportId>) ----------

/// The report id in "#inbox/<id>", or null.
function linkedReportId() {
    const [tab, id] = location.hash.replace("#", "").split("/");
    return tab === "inbox" && id && id !== "feedback" ? decodeURIComponent(id) : null;
}

/// The feedback id in "#inbox/feedback/<id>" (the feedback email's link).
function linkedFeedbackId() {
    const [tab, section, id] = location.hash.replace("#", "").split("/");
    return tab === "inbox" && section === "feedback" && id ? decodeURIComponent(id) : null;
}
let focusedId = null;

/// Outlines the linked report and scrolls to it, once per link. If it was
/// already handled (maybe from another phone), says by whom.
function focusLinkedReport(rows) {
    const id = linkedReportId();
    if (!id || id === focusedId) return;
    focusedId = id;
    showSection("reports");
    const card = document.querySelector(`.inbox-item[data-report-id="${CSS.escape(id)}"]`);
    const r = rows.find(x => x.id === id);
    if (!card || !r) {
        setStatus("That report isn't in the list anymore.", "");
        return;
    }
    card.classList.add("inbox-focus");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    if (r.reviewed) {
        setStatus(`Already handled: ${ACTION_DONE[r.reviewAction] || "Reviewed"}${r.reviewedByName ? ` by ${r.reviewedByName}` : ""}.`, "success");
    }
}

// Tapping another report email while the page is open changes only the hash.
window.addEventListener("hashchange", () => {
    if (!linkedReportId() && !linkedFeedbackId()) return;
    els.tab?.click();
    if (auth.currentUser) refresh();
});

// ---------- Data Requests ----------

async function loadRequests() {
    try {
        const snap = await getDocs(query(collection(db, "dataExportRequests"), orderBy("requestedAt", "desc"), limit(200)));
        const rows = await Promise.all(snap.docs.map(async d => {
            const x = d.data();
            return {
                id: d.id, ...x,
                at: toMillis(x.requestedAt),
                name: await nameFor(x.uid),
                fulfilledAt: toMillis(x.fulfilledAt),
                fulfilledByName: await reviewerName(x.fulfilledBy, x.fulfilledByName),
            };
        }));
        return { rows, sample: false };
    } catch (err) {
        if (denied(err)) { setStatus("This account can't see data requests.", "error"); return { rows: [], sample: false }; }
        throw err;
    }
}

function requestCard(r) {
    const card = el("div", "inbox-item");
    const top = el("div", "inbox-item-top");
    top.append(el("span", "inbox-kind", r.name || "Unknown account"));
    const open = r.status !== "fulfilled";
    if (open) {
        const left = r.at + DATA_REQUEST_DUE_MS - Date.now();
        top.append(el("span", left < 7 * DAY ? "inbox-when inbox-late" : "inbox-when",
            left > 0 ? `Due ${shortDate(r.at + DATA_REQUEST_DUE_MS)}, ${span(left)} left` : `Past due by ${span(-left)}`));
    }
    card.append(top);
    card.append(el("div", "surge-meta", `Asked ${dateTime(r.at)} · Goes to ${r.sentToMasked || "their account email"}`));

    if (!open) {
        card.append(el("div", "inbox-done-line",
            `Sent${r.fulfilledByName ? ` by ${r.fulfilledByName}` : ""}${r.fulfilledAt ? `, ${dateTime(r.fulfilledAt)}` : ""}`));
        return card;
    }
    card.append(el("div", "surge-meta", "Zak runs the export for now. Tap Mark Sent once it's gone out."));
    const actions = el("div", "inbox-actions");
    const sent = el("button", "btn-primary", "Mark Sent");
    sent.type = "button";
    sent.addEventListener("click", () => markSent(r, sent));
    actions.append(sent);
    card.append(actions);
    return card;
}

async function markSent(r, button) {
    if (!confirm(`Mark ${r.name || "this request"} as sent? Only do this once the export email has gone out.`)) return;
    const unlock = lockButtons(button, WORKING.sent);
    try {
        await httpsCallable(functions, "markDataExportSent")({ requestId: r.id });
        setStatus("Marked sent.", "success");
        await refresh();
    } catch (err) {
        unlock();
        setStatus(serverNotReady(err)
            ? "This button works once Zak's server piece is in."
            : `Couldn't save: ${err.message}`, "error");
    }
}

function renderRequests({ rows, sample }) {
    const open = rows.filter(r => r.status !== "fulfilled").sort((a, b) => a.at - b.at);
    const done = rows.filter(r => r.status === "fulfilled").slice(0, 30);
    els.requestsOpen.replaceChildren(...(open.length ? open.map(requestCard) : [el("p", "surge-muted", "Nothing waiting.")]));
    els.requestsDone.replaceChildren(...(done.length ? done.map(requestCard) : [el("p", "surge-muted", "None yet.")]));
    return sample ? 0 : open.length;
}

// ---------- Feedback (Contact Us in the app, Stacy 11/6) ----------

const FEEDBACK_KIND = { bug: "Bug", idea: "Feature idea", feedback: "Feedback", account: "Account help" };

async function loadFeedback() {
    try {
        const snap = await getDocs(query(collection(db, "feedback"), orderBy("createdAt", "desc"), limit(200)));
        const rows = await Promise.all(snap.docs.map(async d => {
            const x = d.data();
            return { id: d.id, ...x, at: toMillis(x.createdAt), handledByName: await reviewerName(x.handledBy, null), handledAt: toMillis(x.handledAt) };
        }));
        return rows;
    } catch (err) {
        if (denied(err)) { setStatus("This account can't see feedback.", "error"); return []; }
        throw err;
    }
}

function feedbackCard(f) {
    const card = el("div", "inbox-item");
    card.dataset.feedbackId = f.id;
    const top = el("div", "inbox-item-top");
    top.append(el("span", "inbox-kind", FEEDBACK_KIND[f.category] || "Feedback"));
    top.append(el("span", "inbox-when", dateTime(f.at)));
    card.append(top);
    card.append(el("div", "inbox-message", f.message || ""));
    const dv = f.device || {};
    card.append(el("div", "surge-meta",
        `From ${f.name || "Unknown"} · Zzzap ${dv.appVersion || "?"} (${dv.build || "?"}), ${dv.channel || "?"} · ${dv.model || "?"} · iOS ${dv.iosVersion || "?"}`));
    if (!f.replyTo) card.append(el("div", "surge-meta", "No reply address on their account."));

    if (f.status === "done") {
        card.append(el("div", "inbox-done-line",
            `Done${f.handledByName ? ` by ${f.handledByName}` : ""}${f.handledAt ? `, ${dateTime(f.handledAt)}` : ""}`));
        return card;
    }
    const actions = el("div", "inbox-actions");
    if (f.replyTo) {
        const reply = el("a", "btn-secondary", "Reply");
        const firstLine = (f.message || "").split("\n")[0].slice(0, 50);
        reply.href = `mailto:${f.replyTo}?subject=${encodeURIComponent(`Re: ${firstLine}`)}`;
        reply.style.textDecoration = "none";
        reply.style.textAlign = "center";
        reply.style.borderRadius = "12px";
        reply.style.padding = "10px 18px";
        reply.style.fontWeight = "600";
        actions.append(reply);
    }
    const done = el("button", "btn-secondary", "Mark Done");
    done.type = "button";
    done.addEventListener("click", () => markFeedbackDone(f, done));
    actions.append(done);
    card.append(actions);
    return card;
}

async function markFeedbackDone(f, button) {
    const unlock = lockButtons(button, "Saving…");
    try {
        await updateDoc(doc(db, "feedback", f.id), {
            status: "done", handledBy: auth.currentUser.uid, handledAt: serverTimestamp(),
        });
        setStatus("Marked done.", "success");
        await refresh();
    } catch (err) {
        unlock();
        setStatus(denied(err) ? "This works once the feedback rule is deployed." : `Couldn't save: ${err.message}`, "error");
    }
}

let focusedFeedbackId = null;

function renderFeedback(rows) {
    const open = rows.filter(f => f.status !== "done");
    const done = rows.filter(f => f.status === "done").slice(0, 30);
    els.feedbackOpen.replaceChildren(...(open.length ? open.map(feedbackCard) : [el("p", "surge-muted", "Nothing new.")]));
    els.feedbackDone.replaceChildren(...(done.length ? done.map(feedbackCard) : [el("p", "surge-muted", "None yet.")]));
    const id = linkedFeedbackId();
    if (id && id !== focusedFeedbackId) {
        focusedFeedbackId = id;
        showSection("feedback");
        const card = document.querySelector(`.inbox-item[data-feedback-id="${CSS.escape(id)}"]`);
        if (card) {
            card.classList.add("inbox-focus");
            card.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }
    return open.length;
}

// ---------- Load ----------

async function refresh() {
    const [reports, requests, feedback] = await Promise.all([
        loadReports().catch(err => { setStatus(`Couldn't load reports: ${err.message}`, "error"); return null; }),
        loadRequests().catch(err => { setStatus(`Couldn't load data requests: ${err.message}`, "error"); return null; }),
        loadFeedback().catch(err => { setStatus(`Couldn't load feedback: ${err.message}`, "error"); return null; }),
    ]);
    const waitingReports = reports ? renderReports(reports) : 0;
    const waitingRequests = requests ? renderRequests(requests) : 0;
    const newFeedback = feedback ? renderFeedback(feedback) : 0;
    setSectionCount("reports", waitingReports);
    setSectionCount("requests", waitingRequests);
    setSectionCount("feedback", newFeedback);
    setTabDot(waitingReports + waitingRequests + newFeedback);
}

els.refresh.addEventListener("click", () => { setStatus(""); refresh(); });

onAuthStateChanged(auth, user => {
    if (!user) return;
    // A limited role (Marketing) doesn't see the Inbox tab; its reads are
    // refused by the rules and the page says so.
    refresh();
});
