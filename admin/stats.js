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
    infoDialog: document.getElementById("stats-info"),
    infoTitle: document.getElementById("stats-info-title"),
    infoBody: document.getElementById("stats-info-body"),
    infoClose: document.getElementById("stats-info-close"),
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

// Shared note for every live box.
const LEFT_OUT = "Demo zzzaps, Zzzap Official, tiebreakers, scheduled zzzaps that haven't gone out yet, and zzzaps the server blocked.";

// What opens when a box is clicked, by box title. Each entry is a list of
// [heading, text] pairs, shown in order.
const INFO = {
    "Zzzaps sent": [
        ["What it is", "How many zzzaps people sent in the last 7 days, and how that compares with the 7 days before."],
        ["Where the numbers come from", "Every zzzap sent in the last 14 days, counted by the moment it went out. A scheduled zzzap counts when it sends, not when it was written."],
        ["Left out", `${LEFT_OUT} Cancelled zzzaps are also left out here (they're counted in People per zzzap).`],
        ["Good to know", "Using 7 days at a time evens out weekday and weekend swings. While the numbers are small, the percent jumps a lot: going from 4 to 8 reads as up 100%."],
    ],
    "Active people": [
        ["What it is", "How many different people sent a zzzap or voted on one in the last 7 days. Each person counts once, however much they did."],
        ["Where the numbers come from", "The sender and everyone who voted on each zzzap sent in the last 7 days. Storm answers count as votes."],
        ["Left out", `${LEFT_OUT} People who only opened the app or only looked at results, since the app doesn't record that.`],
        ["Good to know", "This is the closest thing to weekly active users until Zak can count sign-ins. A vote counts toward the week the zzzap was sent, so a late vote on an older zzzap can land in the earlier week."],
    ],
    "Came back": [
        ["What it is", "Of the people who were active 8 to 14 days ago, how many were active again in the last 7 days. Active means sent or voted, same as Active people."],
        ["Where the numbers come from", "Zzzaps sent in the last 14 days, split into two weeks, then matching people across the two weeks. Names are never shown, only the count."],
        ["Left out", LEFT_OUT],
        ["Good to know", "This is the best sign of whether Zzzap is becoming a habit. With fewer than about 20 people, one person changes it a lot, so watch the trend over several weeks, not one reading."],
    ],
    "Vote rate": [
        ["What it is", "Of everyone asked on finished zzzaps, how many voted or answered."],
        ["Where the numbers come from", "Finished zzzaps sent in the last 30 days: time ran out, the sender ended it early, or everyone voted. For each one, the people it went to (not the sender) and which of them voted."],
        ["Left out", `${LEFT_OUT} Zzzaps still running, since they'd make the rate look low. Cancelled zzzaps.`],
        ["Good to know", "Bigger zzzaps weigh more: one sent to 40 people counts 40 times as much as one sent to 1. People who passed on a zzzap count as not voting."],
    ],
    "Strike vs Storm": [
        ["What it is", "How many Strikes (pick an answer) and Storms (write an answer) were sent in the last 30 days, Strike first. Plus how many had photo answers."],
        ["Where the numbers come from", "The type saved on each zzzap. Older zzzaps saved under the old names (Bolt and Buzz) count as Strike and Storm. A zzzap with no type counts as Strike, the same as the app."],
        ["Left out", `${LEFT_OUT} Cancelled zzzaps.`],
        ["Good to know", "The photo count is zzzaps where the answers are photos. A zzzap with only a photo on the question isn't counted as a photo zzzap."],
    ],
    "People per zzzap": [
        ["What it is", "On average, how many people each zzzap went to in the last 30 days, not counting the sender. Also how many zzzaps were cancelled."],
        ["Where the numbers come from", "The people list on each zzzap sent in the last 30 days."],
        ["Left out", `${LEFT_OUT} Zzzap Official especially, since it goes to everyone who follows it and would swamp the average. Cancelled zzzaps aren't in the average.`],
        ["Good to know", "One very big zzzap can pull the average up. Bigger groups usually mean more people seeing Zzzap. Cancelled means the sender cancelled it before it ended."],
    ],
    "New signups": [
        ["What it will show", "How many new accounts were made each week."],
        ["Why it isn't live", "The site can only see people who turned on findable in search, so any count here would be too low. Zak would need to keep a count on the server."],
        ["Why it matters", "It's the top of the funnel. Read it next to Came back: lots of signups with few coming back means people try it and leave."],
    ],
    "Total accounts": [
        ["What it will show", "How many accounts exist, all time."],
        ["Why it isn't live", "Same reason as New signups: the site can't see every account. Zak would keep the count on the server."],
        ["Why it matters", "Good for pitches and press. Active people says more about health, since it only counts people actually using the app."],
    ],
    "Rating asks": [
        ["What it will show", "How many times the app asked Apple to show the rating popup each week."],
        ["How the app asks today", "After someone has seen the results of 3 finished zzzaps, at most once per app version. Apple shows the popup at most 3 times a year per person and sometimes skips it."],
        ["What we can't know", "Whether Apple actually showed it, or whether the person rated. Apple never tells the app, on purpose. Compare this with new ratings per week in App Store Connect for a rough idea."],
        ["Why it isn't live", "The app needs a build that counts each ask (no names), plus a rule from Zak so the count can be saved where this page can read it."],
    ],
    "Invites": [
        ["What it will show", "How many invite links and QR codes were opened, and how many of those people made an account."],
        ["Why it isn't live", "Invite links are stored on the server only, and this page isn't allowed to read them. Zak would need to add a count."],
        ["Why it matters", "It shows whether people are bringing friends, which is how Zzzap grows."],
    ],
    "Power purchases": [
        ["What it will show", "How many Power purchases happened this month."],
        ["Where to look for now", "App Store Connect, under Sales and Trends, already has this."],
        ["Why it isn't live", "Zak would need to keep a count on the server for it to show here."],
    ],
    "Reports waiting": [
        ["What it will show", "How many reported zzzaps and comments haven't been reviewed yet, and how long the oldest one has waited."],
        ["What already works", "Admins get a push for every new report, and a daily digest flags anything waiting more than 24 hours."],
        ["Why it isn't live", "This page can't read reports yet. Zak needs to add the reports rule and the Moderator role."],
    ],
};

let loaded = false;
let loading = false;

// ---------- Small helpers (text only, never HTML from data) ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// The whole box is a button that opens its explanation.
function box({ title, value, detail, needs }) {
    const card = el("button", needs ? "stat-box stat-sample" : "stat-box");
    card.type = "button";
    const head = el("div", "stat-head");
    head.append(el("div", "stat-title", title));
    const tags = el("div", "stat-tags");
    if (needs) tags.append(el("span", "stat-tag", "Sample"));
    tags.append(el("span", "stat-info", "Info"));
    head.append(tags);
    card.append(head, el("div", "stat-value", value));
    if (detail) card.append(el("div", "stat-detail", detail));
    if (needs) card.append(el("div", "stat-needs", `Needs: ${needs}`));
    card.addEventListener("click", () => showInfo(title, Boolean(needs)));
    return card;
}

function showInfo(title, isSample) {
    els.infoTitle.textContent = title;
    const parts = (INFO[title] || []).map(([heading, text]) => {
        const section = el("div", "stat-info-section");
        section.append(el("h4", "", heading), el("p", "", text));
        return section;
    });
    if (isSample) parts.push(el("p", "stat-info-sample", "The number in this box is made up, just to show what it will look like."));
    els.infoBody.replaceChildren(...parts);
    els.infoDialog.showModal();
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
els.infoClose.addEventListener("click", () => els.infoDialog.close());
// Clicking the dimmed area outside the box closes it too.
els.infoDialog.addEventListener("click", e => { if (e.target === els.infoDialog) els.infoDialog.close(); });
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
