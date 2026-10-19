// Admin console → Stats (Stacy 2026-10-19).
// Totals only, never names. Live boxes are worked out from the last 30 days
// of zzzaps, which admins can already read. Sample boxes show made-up numbers
// and say what each one needs before it can go live.
//
// Left out of every live number: demo zzzaps, Zzzap Official (it has its own
// Recent card and would swamp everything), tiebreakers (they ride on another
// zzzap), and anything scheduled but not sent yet or blocked by the server.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, where, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const DAY = 24 * 60 * 60 * 1000;
const OFFICIAL_ID = "zzzap_official";

const els = {
    panel: document.querySelector('.admin-panel[data-panel="stats"]'),
    live: document.getElementById("stats-live"),
    sample: document.getElementById("stats-sample"),
    status: document.getElementById("stats-status"),
    refresh: document.getElementById("stats-refresh"),
};

// Boxes that aren't live yet. Numbers are made up; `needs` says what's missing.
const SAMPLE_BOXES = [
    { title: "New signups", value: "24", detail: "this week", needs: "Zak: a server count of new accounts" },
    { title: "Total accounts", value: "1,310", detail: "all time", needs: "Zak: a server count of all accounts" },
    { title: "Rating asks", value: "38", detail: "this week. Apple never says who rated.", needs: "App build to count each ask, plus a rule from Zak" },
    { title: "Invites", value: "52 opened", detail: "17 joined", needs: "Zak: invite links are server only" },
    { title: "Power purchases", value: "6", detail: "this month", needs: "Zak: a purchase count, or App Store Connect for now" },
    { title: "Reports waiting", value: "2", detail: "oldest 5 hours", needs: "Zak: the reports rule (Moderator role)" },
];

let loaded = false;
let loading = false;

// ---------- Small helpers (text only, never HTML from data) ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function box({ title, value, detail, needs }) {
    const card = el("div", needs ? "stat-box stat-sample" : "stat-box");
    const head = el("div", "stat-head");
    head.append(el("div", "stat-title", title));
    if (needs) head.append(el("span", "stat-tag", "Sample"));
    card.append(head, el("div", "stat-value", value));
    if (detail) card.append(el("div", "stat-detail", detail));
    if (needs) card.append(el("div", "stat-needs", `Needs: ${needs}`));
    return card;
}

function setStatus(message, kind = "") {
    els.status.textContent = message;
    els.status.className = `status-message ${kind}`;
}

function percent(part, whole) {
    return whole ? `${Math.round((part / whole) * 100)}%` : "None yet";
}

function change(now, before) {
    if (!before) return now ? "None the 7 days before" : "Same as the 7 days before";
    const diff = Math.round(((now - before) / before) * 100);
    if (diff === 0) return "Same as the 7 days before";
    return `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)}% from the 7 days before (${before})`;
}

// ---------- Reading zzzaps ----------

function toDate(value) {
    return value && typeof value.toDate === "function" ? value.toDate() : null;
}

// Same idea as the app's Poll.expiresAt: start time plus the time limit,
// or earlier if it was closed early.
function endTime(p) {
    const start = toDate(p.scheduledFor) || toDate(p.createdAt);
    if (!start) return null;
    const end = new Date(start.getTime() + (p.timeLimitMinutes || 15) * 60 * 1000);
    const closed = toDate(p.closedAt) || toDate(p.endedEarlyAt);
    return closed && closed < end ? closed : end;
}

async function loadZzzaps() {
    const since = Timestamp.fromDate(new Date(Date.now() - 30 * DAY));
    const snap = await getDocs(query(collection(db, "polls"), where("createdAt", ">=", since)));
    return snap.docs
        .map(d => d.data())
        .filter(p =>
            !p.isDemo &&
            p.creatorId &&
            p.creatorId !== OFFICIAL_ID &&
            !p.tiebreakerFor &&
            !["scheduled", "rejected"].includes(p.status) &&
            toDate(p.createdAt)
        );
}

// Everyone who sent or voted on a zzzap.
function activePeople(polls) {
    const people = new Set();
    for (const p of polls) {
        people.add(p.creatorId);
        Object.keys(p.voters || {}).forEach(uid => people.add(uid));
    }
    return people;
}

function buildLiveBoxes(polls) {
    const now = Date.now();
    const created = p => toDate(p.createdAt).getTime();
    const lastWeek = polls.filter(p => created(p) >= now - 7 * DAY);
    const weekBefore = polls.filter(p => created(p) < now - 7 * DAY && created(p) >= now - 14 * DAY);
    const sent = polls.filter(p => p.status !== "cancelled");

    // Active people, and how many of last week's came back this week.
    const activeNow = activePeople(lastWeek.filter(p => p.status !== "cancelled"));
    const activeBefore = activePeople(weekBefore.filter(p => p.status !== "cancelled"));
    const cameBack = [...activeBefore].filter(uid => activeNow.has(uid)).length;

    // Vote rate: of the people asked on finished zzzaps, how many answered.
    let asked = 0;
    let answered = 0;
    for (const p of sent) {
        const end = endTime(p);
        if (!end || end.getTime() > now) continue;
        const recipients = (p.recipients || []).filter(uid => uid !== p.creatorId);
        const voters = p.voters || {};
        asked += recipients.length;
        answered += recipients.filter(uid => voters[uid] !== undefined).length;
    }

    const storms = sent.filter(p => p.pollType === "storm" || p.pollType === "buzz").length;
    const photos = sent.filter(p => p.isPhotoPoll).length;
    const cancelled = polls.length - sent.length;
    const avgAsked = sent.length
        ? (sent.reduce((n, p) => n + (p.recipients || []).filter(uid => uid !== p.creatorId).length, 0) / sent.length).toFixed(1)
        : "0";

    const sentNow = lastWeek.filter(p => p.status !== "cancelled").length;
    const sentBefore = weekBefore.filter(p => p.status !== "cancelled").length;

    return [
        { title: "Zzzaps sent", value: String(sentNow), detail: `Last 7 days. ${change(sentNow, sentBefore)}` },
        { title: "Active people", value: String(activeNow.size), detail: "Sent or voted in the last 7 days" },
        { title: "Came back", value: percent(cameBack, activeBefore.size), detail: `${cameBack} of ${activeBefore.size} active the week before were active again this week` },
        { title: "Vote rate", value: percent(answered, asked), detail: `${answered} of ${asked} people asked voted. Finished zzzaps, last 30 days` },
        { title: "Strike vs Storm", value: `${sent.length - storms} / ${storms}`, detail: `Last 30 days. ${photos} with photos` },
        { title: "People per zzzap", value: avgAsked, detail: `Average sent to, last 30 days. ${cancelled} cancelled` },
    ];
}

// ---------- Render ----------

function renderSample() {
    els.sample.replaceChildren(...SAMPLE_BOXES.map(box));
}

async function load() {
    if (loading) return;
    loading = true;
    els.refresh.disabled = true;
    setStatus("Loading…");
    try {
        const polls = await loadZzzaps();
        els.live.replaceChildren(...buildLiveBoxes(polls).map(box));
        loaded = true;
        const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        setStatus(`Updated ${time}. ${polls.length} zzzaps in the last 30 days.`);
    } catch (err) {
        console.error("[STATS]", err);
        setStatus(`Couldn't load stats: ${err.message}`, "error");
    } finally {
        loading = false;
        els.refresh.disabled = false;
    }
}

// Only read zzzaps once the Stats tab is actually open.
function loadIfShowing() {
    if (auth.currentUser && !loaded && !els.panel.hidden) load();
}

renderSample();
els.refresh.addEventListener("click", load);
document.querySelectorAll(".admin-tab").forEach(t => t.addEventListener("click", () => setTimeout(loadIfShowing)));
onAuthStateChanged(auth, user => {
    if (user) {
        loadIfShowing();
    } else {
        loaded = false;
        els.live.replaceChildren();
        setStatus("");
    }
});
