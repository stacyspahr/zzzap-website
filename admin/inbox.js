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
// Until the read rule is in, each section shows sample items marked Sample.
// Until the functions are in, the buttons say so instead of failing quietly.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, orderBy, limit, getDocs, getDoc, doc
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
    reportsSample: document.getElementById("reports-sample"),
    requestsSample: document.getElementById("requests-sample"),
    sectionButtons: [...document.querySelectorAll(".admin-tab[data-inbox-section]")],
    sections: [...document.querySelectorAll(".inbox-section")],
};

const ACTION_DONE = {
    dismiss: "Dismissed",
    removeContent: "Removed",
    warn: "Warned",
    suspend: "Account suspended",
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

// Names for account ids, looked up once each.
const nameCache = new Map();
async function nameFor(uid) {
    if (!uid || uid === "system") return null;
    if (nameCache.has(uid)) return nameCache.get(uid);
    let name = `Account ${uid.slice(0, 6)}`;
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) name = snap.data().displayName || snap.data().realName || name;
        else name = `${name} (deleted)`;
    } catch (_) { /* keep the short id */ }
    nameCache.set(uid, name);
    return name;
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
showSection(localStorage.getItem("inboxSection") === "requests" ? "requests" : "reports");

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

// ---------- Sample items (until admins can read the real ones) ----------

function sampleReports() {
    const now = Date.now();
    return [
        { id: "sample-1", sample: true, type: "comment", reason: "Rude or Mean", note: "",
          commentText: "This is the dumbest question I've seen all week.", question: "Tacos or pizza tonight?",
          authorName: "Sample Writer", reporterName: "Sample Reporter", at: now - 30 * HOUR, reviewed: false },
        { id: "sample-2", sample: true, type: "zzzap", reason: "Spam", note: "Same link sent to everyone",
          question: "Win a free phone, tap here", isPhotoPoll: false, alsoBlocked: true,
          authorName: "Sample Creator", reporterName: "Sample Reporter", at: now - 3 * HOUR, reviewed: false },
        { id: "sample-3", sample: true, type: "comment", reason: "Harassment", note: "",
          commentText: "Nobody wants you here.", question: "Which color for the front door?",
          authorName: "Sample Writer", reporterName: "Sample Reporter", at: now - 4 * DAY, reviewed: true,
          reviewAction: "removeContent", reviewedByName: "Stacy", reviewedAt: now - 3 * DAY },
    ];
}

function sampleRequests() {
    const now = Date.now();
    return [
        { id: "sample-r1", sample: true, name: "Sample Person", sentToMasked: "s•••@privaterelay.appleid.com",
          at: now - 2 * DAY, status: "pending" },
        { id: "sample-r2", sample: true, name: "Sample Person", sentToMasked: "j•••@gmail.com",
          at: now - 40 * DAY, status: "fulfilled", fulfilledAt: now - 38 * DAY, fulfilledByName: "Stacy" },
    ];
}

// ---------- Reports ----------

async function loadReports() {
    try {
        const snap = await getDocs(query(collection(db, "reports"), orderBy("timestamp", "desc"), limit(200)));
        const rows = await Promise.all(snap.docs.map(async d => {
            const x = d.data();
            const type = x.type === "comment" ? "comment" : (x.reporterId === "system" ? "system" : "zzzap");
            return {
                id: d.id, ...x, type,
                at: toMillis(x.timestamp),
                authorName: await nameFor(type === "comment" ? x.commentAuthorId : x.pollCreatorId),
                reporterName: await nameFor(x.reporterId),
                reviewedByName: x.reviewedByName || await nameFor(x.reviewedBy),
                reviewedAt: toMillis(x.reviewedAt),
            };
        }));
        return { rows, sample: false };
    } catch (err) {
        if (denied(err)) return { rows: sampleReports(), sample: true };
        throw err;
    }
}

function reportCard(r) {
    const card = el("div", "inbox-item");
    const top = el("div", "inbox-item-top");
    const kind = r.type === "comment" ? "Comment" : r.type === "system" ? "Automatic" : "Zzzap";
    top.append(el("span", "inbox-kind", `${kind} · ${r.reason === "auto_moderation" ? "Photo check" : r.reason || "No reason"}`));
    if (r.sample) top.append(el("span", "inbox-sample", "Sample"));

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

    if (r.reviewed) {
        const what = r.type === "system" && !r.reviewAction
            ? "Handled automatically"
            : `${ACTION_DONE[r.reviewAction] || "Reviewed"}${r.reviewedByName ? ` by ${r.reviewedByName}` : ""}${r.reviewedAt ? `, ${dateTime(r.reviewedAt)}` : ""}`;
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
        b.addEventListener("click", () => actOnReport(r, action, label));
        actions.append(b);
    }
    card.append(actions);
    return card;
}

async function actOnReport(r, action, label) {
    if (r.sample) { setStatus("That's a sample. Real reports show here once Zak's piece is in.", ""); return; }
    if (action === "suspend" && !confirm(`Suspend ${r.authorName || "this account"}? They won't be able to send, vote or comment.`)) return;
    if (action === "removeContent" && !confirm(`${label}? It disappears for everyone.`)) return;
    try {
        await httpsCallable(functions, "reviewReport")({ reportId: r.id, action });
        setStatus(`${ACTION_DONE[action]}.`, "success");
        await refresh();
    } catch (err) {
        setStatus(serverNotReady(err)
            ? "This button works once Zak's server piece is in."
            : `Couldn't save: ${err.message}`, "error");
    }
}

function renderReports({ rows, sample }) {
    els.reportsSample.hidden = !sample;
    const open = rows.filter(r => !r.reviewed).sort((a, b) => a.at - b.at); // oldest first
    const done = rows.filter(r => r.reviewed).sort((a, b) => (b.reviewedAt || b.at) - (a.reviewedAt || a.at)).slice(0, 30);
    els.reportsOpen.replaceChildren(...(open.length ? open.map(reportCard) : [el("p", "surge-muted", "Nothing waiting.")]));
    els.reportsDone.replaceChildren(...(done.length ? done.map(reportCard) : [el("p", "surge-muted", "None yet.")]));
    return sample ? 0 : open.length;
}

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
                fulfilledByName: x.fulfilledByName || await nameFor(x.fulfilledBy),
            };
        }));
        return { rows, sample: false };
    } catch (err) {
        if (denied(err)) return { rows: sampleRequests(), sample: true };
        throw err;
    }
}

function requestCard(r) {
    const card = el("div", "inbox-item");
    const top = el("div", "inbox-item-top");
    top.append(el("span", "inbox-kind", r.name || "Unknown account"));
    if (r.sample) top.append(el("span", "inbox-sample", "Sample"));
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
    sent.addEventListener("click", () => markSent(r));
    actions.append(sent);
    card.append(actions);
    return card;
}

async function markSent(r) {
    if (r.sample) { setStatus("That's a sample. Real requests show here once Zak's piece is in.", ""); return; }
    if (!confirm(`Mark ${r.name || "this request"} as sent? Only do this once the export email has gone out.`)) return;
    try {
        await httpsCallable(functions, "markDataExportSent")({ requestId: r.id });
        setStatus("Marked sent.", "success");
        await refresh();
    } catch (err) {
        setStatus(serverNotReady(err)
            ? "This button works once Zak's server piece is in."
            : `Couldn't save: ${err.message}`, "error");
    }
}

function renderRequests({ rows, sample }) {
    els.requestsSample.hidden = !sample;
    const open = rows.filter(r => r.status !== "fulfilled").sort((a, b) => a.at - b.at);
    const done = rows.filter(r => r.status === "fulfilled").slice(0, 30);
    els.requestsOpen.replaceChildren(...(open.length ? open.map(requestCard) : [el("p", "surge-muted", "Nothing waiting.")]));
    els.requestsDone.replaceChildren(...(done.length ? done.map(requestCard) : [el("p", "surge-muted", "None yet.")]));
    return sample ? 0 : open.length;
}

// ---------- Load ----------

async function refresh() {
    const [reports, requests] = await Promise.all([
        loadReports().catch(err => { setStatus(`Couldn't load reports: ${err.message}`, "error"); return null; }),
        loadRequests().catch(err => { setStatus(`Couldn't load data requests: ${err.message}`, "error"); return null; }),
    ]);
    const waitingReports = reports ? renderReports(reports) : 0;
    const waitingRequests = requests ? renderRequests(requests) : 0;
    setSectionCount("reports", waitingReports);
    setSectionCount("requests", waitingRequests);
    setTabDot(waitingReports + waitingRequests);
}

els.refresh.addEventListener("click", () => { setStatus(""); refresh(); });

onAuthStateChanged(auth, user => {
    if (!user) return;
    // A limited role (Marketing) doesn't see the Inbox tab; its reads are
    // refused by the rules and it just falls back to samples nobody sees.
    refresh();
});
