// Admin console → Today (Stacy 2026-11-06). The home page: what needs you
// right now, who handled what lately, and the one list of things waiting on
// Zak (instead of samples scattered across tabs). Built for the phone.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// What's built on our side and waiting on Zak's server half. Claude keeps
// this current: when Zak finishes one, it comes off and its switch goes on.
const WAITING_ON_ZAK = [
    { what: "Surge: add people and categories", where: "Surge tab buttons" },
    { what: "Roles: refusing admin sign-in without one, and moving Haley to a role", where: "Who can use this site" },
    { what: "See results without voting on the web page", where: "vote.zzzap-app.com" },
    { what: "Counts: new signups, total accounts, invites, Power purchases, rating asks (one server count, getAdminStats)", where: "Numbers" },
];

const ACTION_DONE = {
    dismiss: "Dismissed", removeContent: "Removed", warn: "Removed and warned", suspend: "Removed and suspended",
};
const ADMIN_NAMES = {
    "N0VsgL5S59edhJsKi3lxuXV6bzj1": "Stacy",
    "QhHvgTWnm3aweG6OckJ97ZZLthB2": "Zak",
};

const els = {
    needs: document.getElementById("today-needs"),
    recent: document.getElementById("today-recent"),
    waiting: document.getElementById("today-waiting"),
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function toMillis(t) {
    if (!t) return 0;
    if (typeof t.toMillis === "function") return t.toMillis();
    return Number(t) || 0;
}

function span(ms) {
    const minutes = Math.max(1, Math.floor(ms / 60000));
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"}`;
}

/// One tappable row that opens a tab.
function row(title, detail, tab, late = false) {
    const r = el("button", "today-row");
    r.type = "button";
    r.append(el("span", late ? "today-row-title inbox-late" : "today-row-title", title));
    if (detail) r.append(el("span", "today-row-detail", detail));
    r.addEventListener("click", () => document.querySelector(`.admin-tab[data-tab="${tab}"]`)?.click());
    return r;
}

async function loadNeeds() {
    const rows = [];
    try {
        const snap = await getDocs(query(collection(db, "reports"), where("reviewed", "==", false), limit(100)));
        const people = snap.docs.filter(d => d.data().reporterId !== "system");
        if (people.length) {
            const oldest = Math.min(...people.map(d => toMillis(d.data().timestamp) || Date.now()));
            const age = Date.now() - oldest;
            rows.push(row(`${people.length} report${people.length === 1 ? "" : "s"} waiting`,
                `Oldest ${span(age)}${age > DAY ? ", past the 24 hour goal" : ""}`, "inbox", age > DAY));
        }
    } catch (_) { /* not allowed for this role */ }
    try {
        const snap = await getDocs(query(collection(db, "dataExportRequests"), orderBy("requestedAt", "desc"), limit(100)));
        const open = snap.docs.map(d => d.data()).filter(r => r.status !== "fulfilled");
        if (open.length) {
            const due = Math.min(...open.map(r => toMillis(r.requestedAt) + 30 * DAY));
            const left = due - Date.now();
            rows.push(row(`${open.length} data request${open.length === 1 ? "" : "s"}`,
                left > 0 ? `Next one due in ${span(left)}` : `Past due by ${span(-left)}`, "inbox", left < 7 * DAY));
        }
    } catch (_) { /* not allowed for this role */ }
    try {
        const snap = await getDocs(query(collection(db, "feedback"), where("status", "==", "new"), limit(100)));
        if (snap.size) rows.push(row(`${snap.size} new feedback`, "From Contact Us in the app", "inbox"));
    } catch (_) { /* not allowed for this role, or the rule isn't in yet */ }
    els.needs.replaceChildren(...(rows.length ? rows : [el("p", "surge-muted", "Nothing needs you right now.")]));
}

/// Who did what lately: the last handled reports, with who handled them.
async function loadRecent() {
    try {
        const snap = await getDocs(query(collection(db, "reports"), orderBy("reviewedAt", "desc"), limit(5)));
        const items = snap.docs.map(d => d.data()).filter(r => r.reviewedAt);
        if (!items.length) { els.recent.replaceChildren(el("p", "surge-muted", "Nothing handled yet.")); return; }
        els.recent.replaceChildren(...items.map(r => {
            const who = ADMIN_NAMES[r.reviewedBy] || r.reviewedByName || "Someone";
            const what = r.type === "comment" ? `a comment on “${r.question || "a zzzap"}”` : `“${r.question || "a zzzap"}”`;
            const line = el("div", "today-recent-row");
            line.append(el("span", "today-row-title", `${ACTION_DONE[r.reviewAction] || "Reviewed"} ${what}`));
            line.append(el("span", "today-row-detail", `${who}, ${span(Date.now() - toMillis(r.reviewedAt))} ago`));
            return line;
        }));
    } catch (_) {
        els.recent.replaceChildren(el("p", "surge-muted", "Not available for this account."));
    }
}

function renderWaiting() {
    els.waiting.replaceChildren(...WAITING_ON_ZAK.map(w => {
        const item = el("li");
        item.append(el("span", "today-row-title", w.what));
        item.append(el("span", "today-row-detail", w.where));
        return item;
    }));
}

renderWaiting();
onAuthStateChanged(auth, user => {
    if (!user) return;
    loadNeeds();
    loadRecent();
});
document.getElementById("today-refresh")?.addEventListener("click", () => { loadNeeds(); loadRecent(); });
