// Admin console → Stats (Stacy 2026-10-19).
// Totals only, never names (one exception: Devices → Each person, so people
// on old versions can be found; Stacy 2026-11-03). Live boxes are worked out from the last 30 days
// of zzzaps, which admins can already read. Sample boxes show made-up numbers
// and say what each one needs before it can go live.
//
// Left out of every live number: demo zzzaps, Zzzap Official (it has its own
// Recent card and would swamp everything), tiebreakers (they ride on another
// zzzap), and anything scheduled but not sent yet or blocked by the server.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, where, getDocs, getDoc, doc, Timestamp,
    orderBy, limit, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const DAY = 24 * 60 * 60 * 1000;
const OFFICIAL_ID = "zzzap_official";

const els = {
    panel: document.querySelector('.admin-panel[data-panel="stats"]'),
    live: document.getElementById("stats-live"),
    trend: document.getElementById("stats-trend"),
    trendNote: document.getElementById("stats-trend-note"),
    devices: document.getElementById("stats-devices"),
    status: document.getElementById("stats-status"),
    refresh: document.getElementById("stats-refresh"),
    infoDialog: document.getElementById("stats-info"),
    infoTitle: document.getElementById("stats-info-title"),
    infoBody: document.getElementById("stats-info-body"),
    infoClose: document.getElementById("stats-info-close"),
    tab: document.querySelector('.admin-tab[data-tab="stats"]'),
    socialDue: document.getElementById("social-due"),
    socialBoxes: document.getElementById("social-boxes"),
    socialForm: document.getElementById("social-form"),
    socialSave: document.getElementById("social-save"),
    socialStatus: document.getElementById("social-status"),
};

// Zzzap's own social accounts. Follower counts are typed in by hand on this
// tab and saved to socialStats, one doc per update, so growth can be shown.
// A count older than SOCIAL_STALE_DAYS is due: the box says so, a note shows
// at the top of the tab, and the Stats tab gets a dot.
const SOCIAL = [
    { id: "instagram", name: "Instagram" },
    { id: "tiktok", name: "TikTok" },
    { id: "facebook", name: "Facebook" },
];
const SOCIAL_STALE_DAYS = 7;

// Goals (Stacy, 2026-11-02). Change them here; tell Claude.
// Active people grows from a fixed start so the goal never moves with the
// actual number: 29 people the week of Nov 2, 7% more each week after.
const GOALS = {
    growth: { start: new Date(2026, 10, 2), startValue: 29, weekly: 0.07, milestone: 100 },
    rates: { "Came back": 0.60, "After a month": 0.40, "Vote rate": 0.70 },
};

// Goal for the week containing `when`, or null before the goals started.
function growthGoal(when) {
    const g = GOALS.growth;
    const weeks = Math.floor((when - g.start.getTime()) / (7 * DAY));
    if (weeks < 0) return null;
    return Math.round(g.startValue * Math.pow(1 + g.weekly, weeks));
}

// The week the milestone is reached on the goal path.
function milestoneDate() {
    const g = GOALS.growth;
    const weeks = Math.ceil(Math.log(g.milestone / g.startValue) / Math.log(1 + g.weekly));
    return new Date(g.start.getTime() + weeks * 7 * DAY);
}

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
        ["What it is", "How many different people in the app sent a zzzap or voted on one in the last 7 days. Each person counts once, however much they did."],
        ["Where the numbers come from", "The sender and everyone who voted on each zzzap sent in the last 7 days. Storm answers count as votes."],
        ["Left out", `${LEFT_OUT} People who only opened the app or only looked at results, since the app doesn't record that. Web voters, who have their own box.`],
        ["Good to know", "This is the closest thing to weekly active users until Zak can count sign-ins. A vote counts toward the week the zzzap was sent, so a late vote on an older zzzap can land in the earlier week."],
    ],
    "Came back": [
        ["What it is", "Of the people who were active 8 to 14 days ago, how many were active again in the last 7 days. Active means sent or voted in the app, same as Active people."],
        ["Where the numbers come from", "Zzzaps sent in the last 14 days, split into two weeks, then matching people across the two weeks. Names are never shown, only the count."],
        ["Left out", `${LEFT_OUT} Web voters.`],
        ["Good to know", "This is the best sign of whether Zzzap is becoming a habit. With fewer than about 20 people, one person changes it a lot, so watch the trend over several weeks, not one reading."],
    ],
    "Senders": [
        ["What it is", "How many different people in the app sent at least one zzzap in the last 7 days, and how much of the sending the busiest sender did."],
        ["Where the numbers come from", "The sender of every zzzap sent in the last 14 days, split into two weeks. Each person counts once, however many they sent. The busiest sender is whoever sent the most that week; no name is shown."],
        ["Left out", `${LEFT_OUT} Cancelled zzzaps. Voting doesn't count here; that's in Active people.`],
        ["Good to know", "Zzzap grows when more people send their own zzzaps to their own people, not just when one person sends a lot. Watch two things: Senders going up, and the busiest sender's share going down. Some weeks the busiest sender will be you."],
    ],
    "Web voters": [
        ["What it is", "How many different browsers voted on vote.zzzap-app.com in the last 7 days, without the app."],
        ["Where the numbers come from", "Voters on zzzaps sent in the last 7 days who aren't in the app. Someone counts as in the app if they sent a zzzap or one was sent to them in the last 12 weeks; every other voter is a web voter."],
        ["Left out", LEFT_OUT],
        ["Good to know", "Web voting is one vote per browser, so one person on a phone and a laptop counts twice, and someone who clears their browser counts again. It's a close guess, not exact. Web voters aren't in Active people, Came back, or After a month, so those stay about the app."],
    ],
    "After a month": [
        ["What it is", "Of the people who were active in the app 4 weeks ago (28 to 35 days ago), how many were active again in the last 7 days."],
        ["Where the numbers come from", "Zzzaps sent in those two weeks, matching people across them. Active means sent or voted, same as Active people. Names are never shown, only the count."],
        ["Left out", `${LEFT_OUT} Web voters.`],
        ["Good to know", "This is the number a buyer or investor asks for first: do people stick around? Came back shows next week; this shows a month later. While the numbers are small, one person moves it a lot, so watch the trend."],
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

// Same explanation for each social box, with the account's name filled in.
for (const { name } of SOCIAL) {
    INFO[name] = [
        ["What it is", `How many followers Zzzap's ${name} account has, as of the last time someone typed it in.`],
        ["Where the number comes from", `Typed in by hand with the boxes under Social followers. Open ${name}, look at the follower count on Zzzap's profile, type it in, and Save. Only fill in the accounts you checked; empty boxes are skipped.`],
        ["When it's due", `After ${SOCIAL_STALE_DAYS} days without an update the box says Due, a note shows at the top of this tab, and the Stats tab gets a dot.`],
        ["Good to know", "Every update is kept, so the change since the last update is real. Typed a wrong number? Just save the right one; the newest one is what shows."],
    ];
}

// Why each goal is what it is, added to that box's Info.
const GOAL_INFO = {
    "Active people": () => `Grow ${Math.round(GOALS.growth.weekly * 100)}% a week, starting from ${GOALS.growth.startValue} the week of ${shortDate(GOALS.growth.start)}. That's about 50 by the end of December and ${GOALS.growth.milestone} the week of ${shortDate(milestoneDate())}. Startup advisors call 5 to 7% a week good and 10% great; Zzzap grew about 11% a week from August to November, but growth gets harder as the numbers get bigger. The goal is set from a fixed start, so it doesn't move when the real number does. The dashed marks on the 12-week chart show it week by week.`,
    "Came back": () => "60% or more. For social apps, more than half coming back the next week means Zzzap is turning into a habit.",
    "After a month": () => "40% or more. Most apps lose most people within a month, so keeping 4 in 10 is strong. It's the first number a buyer or investor asks for.",
    "Vote rate": () => "70% or more. Zzzap's promise is fast answers; below 7 in 10, senders start to feel ignored.",
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
function box({ title, value, detail, needs, due, goal }) {
    const card = el("button", needs ? "stat-box stat-sample" : due ? "stat-box stat-stale" : "stat-box");
    card.type = "button";
    const head = el("div", "stat-head");
    head.append(el("div", "stat-title", title));
    const tags = el("div", "stat-tags");
    if (needs) tags.append(el("span", "stat-tag", "Sample"));
    if (due) tags.append(el("span", "stat-due", "Due"));
    tags.append(el("span", "stat-info", "Info"));
    head.append(tags);
    card.append(head, el("div", "stat-value", value));
    if (detail) card.append(el("div", "stat-detail", detail));
    if (goal) {
        // Words, not just color: On track / Behind / Too early.
        const line = el("div", "stat-goal");
        line.append(el("span", "", goal.text));
        const kind = goal.met === null ? "wait" : goal.met ? "met" : "behind";
        line.append(el("span", `stat-goal-tag ${kind}`, goal.met === null ? "Too early" : goal.met ? "On track" : "Behind"));
        card.append(line);
    }
    if (needs) card.append(el("div", "stat-needs", `Needs: ${needs}`));
    card.addEventListener("click", () => showInfo(title, Boolean(needs)));
    return card;
}

function showInfo(title, isSample) {
    els.infoTitle.textContent = title;
    const entries = [...(INFO[title] || [])];
    if (GOAL_INFO[title]) entries.push(["The goal", GOAL_INFO[title]()]);
    const parts = entries.map(([heading, text]) => {
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

// 12 weeks, for the trend chart and After a month. The boxes that say
// "last 30 days" still only use the last 30 days.
const WEEKS = 12;

async function loadZzzaps() {
    const since = Timestamp.fromDate(new Date(Date.now() - WEEKS * 7 * DAY));
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

// Everyone in the app over the whole window: anyone who sent a zzzap or had
// one sent to them. Web voters are never recipients (they vote by link), so a
// voter outside this set is a web voter. Close, not exact.
function appPeopleIn(polls) {
    const people = new Set();
    for (const p of polls) {
        people.add(p.creatorId);
        (p.recipients || []).forEach(uid => people.add(uid));
    }
    return people;
}

// Everyone in the app who sent or voted on a zzzap.
function activePeople(polls, appPeople) {
    const people = new Set();
    for (const p of polls) {
        people.add(p.creatorId);
        Object.keys(p.voters || {}).forEach(uid => { if (appPeople.has(uid)) people.add(uid); });
    }
    return people;
}

// How many zzzaps each person sent. Callers pass zzzaps that weren't cancelled.
function senderCounts(polls) {
    const counts = new Map();
    for (const p of polls) counts.set(p.creatorId, (counts.get(p.creatorId) || 0) + 1);
    return counts;
}

// Browsers that voted on the web (see appPeopleIn).
function webVoters(polls, appPeople) {
    const voters = new Set();
    for (const p of polls) {
        Object.keys(p.voters || {}).forEach(uid => { if (!appPeople.has(uid)) voters.add(uid); });
    }
    return voters;
}

const createdMs = p => toDate(p.createdAt).getTime();

// Zzzaps sent in week `i` back from now (0 = the last 7 days).
function weekOf(polls, i, now) {
    return polls.filter(p => createdMs(p) < now - i * 7 * DAY && createdMs(p) >= now - (i + 1) * 7 * DAY);
}

function buildLiveBoxes(allPolls, appPeople) {
    const now = Date.now();
    const notCancelled = allPolls.filter(p => p.status !== "cancelled");
    const polls = allPolls.filter(p => createdMs(p) >= now - 30 * DAY);
    const lastWeek = weekOf(polls, 0, now);
    const weekBefore = weekOf(polls, 1, now);
    const sent = polls.filter(p => p.status !== "cancelled");

    // Active people, and how many of last week's came back this week.
    const activeNow = activePeople(weekOf(notCancelled, 0, now), appPeople);
    const activeBefore = activePeople(weekOf(notCancelled, 1, now), appPeople);
    const cameBack = [...activeBefore].filter(uid => activeNow.has(uid)).length;
    const activeMonthAgo = activePeople(weekOf(notCancelled, 4, now), appPeople);
    const stayed = [...activeMonthAgo].filter(uid => activeNow.has(uid)).length;
    const web = webVoters(weekOf(notCancelled, 0, now), appPeople);

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

    const rateGoal = (title, part, whole) => {
        const target = GOALS.rates[title];
        return { text: `Goal ${Math.round(target * 100)}%`, met: whole ? part / whole >= target : null };
    };
    const thisWeekGoal = growthGoal(now);
    const peopleGoal = thisWeekGoal === null ? null : {
        text: `Goal ${thisWeekGoal} this week`,
        met: activeNow.size >= thisWeekGoal,
    };

    const sentNow = lastWeek.filter(p => p.status !== "cancelled").length;
    const sentBefore = weekBefore.filter(p => p.status !== "cancelled").length;

    // Senders, and how much of this week's sending the busiest one did.
    const sendersNow = senderCounts(lastWeek.filter(p => p.status !== "cancelled"));
    const sendersBefore = senderCounts(weekBefore.filter(p => p.status !== "cancelled"));
    const topSent = Math.max(0, ...sendersNow.values());
    const sendersDetail = sendersNow.size
        ? `Sent a zzzap, last 7 days. Busiest sender sent ${topSent} of ${sentNow} (${percent(topSent, sentNow)}). ${change(sendersNow.size, sendersBefore.size)}`
        : `Sent a zzzap, last 7 days. ${change(0, sendersBefore.size)}`;

    return [
        { title: "Zzzaps sent", value: String(sentNow), detail: `Last 7 days. ${change(sentNow, sentBefore)}` },
        { title: "Active people", value: String(activeNow.size), detail: "In the app. Sent or voted in the last 7 days", goal: peopleGoal },
        { title: "Senders", value: String(sendersNow.size), detail: sendersDetail },
        { title: "Web voters", value: String(web.size), detail: "Voted on the web without the app, last 7 days" },
        { title: "Came back", value: percent(cameBack, activeBefore.size), detail: `${cameBack} of ${activeBefore.size} active the week before were active again this week`, goal: rateGoal("Came back", cameBack, activeBefore.size) },
        { title: "After a month", value: percent(stayed, activeMonthAgo.size), detail: `${stayed} of ${activeMonthAgo.size} active 4 weeks ago were active again this week`, goal: rateGoal("After a month", stayed, activeMonthAgo.size) },
        { title: "Vote rate", value: percent(answered, asked), detail: `${answered} of ${asked} people asked voted. Finished zzzaps, last 30 days`, goal: rateGoal("Vote rate", answered, asked) },
        { title: "Strike vs Storm", value: `${sent.length - storms} / ${storms}`, detail: `Last 30 days. ${photos} with photos` },
        { title: "People per zzzap", value: avgAsked, detail: `Average sent to, last 30 days. ${cancelled} cancelled` },
    ];
}

// ---------- 12-week trend ----------

// One column per week, oldest on the left. The switch above the chart picks
// which number the bars show; everything else rides along in the tooltip and
// the table, not as a second color. The current week is yellow, the rest gray.
const TREND_PLOT_PX = 120; // bar area height; matches .trend-plot in index.html

// What the chart can show. `goal` is that week's goal or null; `max` fixes
// the top of the chart (percents always run to 100).
const TREND_SERIES = [
    {
        key: "active", label: "Active people",
        note: "Active people in the app each week. The dashed mark is that week's goal (7% more each week from Nov 2).",
        value: w => w.active, show: w => String(w.active), goal: w => w.goal,
    },
    {
        key: "senders", label: "Senders",
        note: "Different people who sent at least one zzzap each week. Up is good: more people sending to their own people.",
        value: w => w.senders, show: w => String(w.senders), goal: () => null,
    },
    {
        key: "share", label: "Busiest share",
        note: "How much of each week's sending the busiest sender did. Down is good: the sending is spreading out.",
        value: w => w.share ?? 0, show: w => (w.share === null ? "None" : `${w.share}%`), goal: () => null, max: 100,
    },
    rateSeries("cameBack", "Came back", "Of the people active the week before, how many were active again that week. The dashed mark is the goal."),
    rateSeries("afterMonth", "After a month", "Of the people active 4 weeks earlier, how many were active again that week. The first 4 weeks have nothing to compare with. The dashed mark is the goal."),
    rateSeries("voteRate", "Vote rate", "Of everyone asked on finished zzzaps sent that week, how many voted. The dashed mark is the goal."),
];

// A percent series with its goal from GOALS.rates as the dashed mark.
// Each week stores { part, whole }; no whole means nothing to measure.
function rateSeries(key, label, note) {
    const pct = w => (w[key].whole ? Math.round((w[key].part / w[key].whole) * 100) : null);
    return {
        key, label, note, max: 100,
        value: w => pct(w) ?? 0,
        show: w => (pct(w) === null ? "None" : `${pct(w)}%`),
        detail: w => (w[key].whole ? `${w[key].part} of ${w[key].whole}` : null),
        goal: () => Math.round(GOALS.rates[label] * 100),
    };
}

// Of the people in `before`, how many are also in `after`.
function overlap(before, after) {
    return { part: [...before].filter(uid => after.has(uid)).length, whole: before.size };
}
let trendKey = "active";
let trendWeeks = [];

function buildTrend(allPolls, appPeople) {
    const now = Date.now();
    const notCancelled = allPolls.filter(p => p.status !== "cancelled");
    // Active people per week, 0 = the last 7 days. Weeks past the window are
    // empty, so the oldest weeks have nothing to compare with.
    const activeByWeek = [];
    for (let i = 0; i < WEEKS; i++) activeByWeek.push(activePeople(weekOf(notCancelled, i, now), appPeople));
    const none = { part: 0, whole: 0 };
    trendWeeks = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
        const inWeek = weekOf(notCancelled, i, now);
        // Vote rate counts finished zzzaps only, same as the box.
        const voteRate = { part: 0, whole: 0 };
        for (const p of inWeek) {
            const end = endTime(p);
            if (!end || end.getTime() > now) continue;
            const recipients = (p.recipients || []).filter(uid => uid !== p.creatorId);
            const voters = p.voters || {};
            voteRate.whole += recipients.length;
            voteRate.part += recipients.filter(uid => voters[uid] !== undefined).length;
        }
        const senders = senderCounts(inWeek);
        const top = Math.max(0, ...senders.values());
        trendWeeks.push({
            start: new Date(now - (i + 1) * 7 * DAY),
            active: activePeople(inWeek, appPeople).size,
            web: webVoters(inWeek, appPeople).size,
            sent: inWeek.length,
            senders: senders.size,
            share: inWeek.length ? Math.round((top / inWeek.length) * 100) : null,
            cameBack: i + 1 < WEEKS ? overlap(activeByWeek[i + 1], activeByWeek[i]) : none,
            afterMonth: i + 4 < WEEKS ? overlap(activeByWeek[i + 4], activeByWeek[i]) : none,
            voteRate,
            current: i === 0,
            goal: growthGoal(now - i * 7 * DAY),
        });
    }

    const wrap = el("div", "trend");
    const picker = el("div", "trend-switch");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "What the chart shows");
    const chartSlot = el("div");
    for (const series of TREND_SERIES) {
        const option = el("button", "trend-option", series.label);
        option.type = "button";
        option.dataset.key = series.key;
        option.addEventListener("click", () => {
            trendKey = series.key;
            drawTrend(picker, chartSlot);
        });
        picker.append(option);
    }
    wrap.append(picker, chartSlot, buildTrendTable());
    drawTrend(picker, chartSlot);
    return wrap;
}

function drawTrend(picker, chartSlot) {
    const series = TREND_SERIES.find(s => s.key === trendKey) || TREND_SERIES[0];
    picker.querySelectorAll(".trend-option").forEach(b => {
        const on = b.dataset.key === series.key;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
    });
    if (els.trendNote) els.trendNote.textContent = `${series.note} Point at a week for details.`;

    const weeks = trendWeeks;
    const max = series.max || Math.max(1, ...weeks.map(w => Math.max(series.value(w), series.goal(w) || 0)));
    const biggest = Math.max(...weeks.map(series.value));
    const last = weeks[weeks.length - 1];
    const lastGoal = series.goal(last);

    const chart = el("div", "trend-chart");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `${series.label} per week, last ${WEEKS} weeks: ${weeks.map(series.show).join(", ")}. This week ${series.show(last)}${lastGoal !== null ? `, goal ${lastGoal}${series.max === 100 ? "%" : ""}` : ""}.`);
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    for (const w of weeks) {
        const value = series.value(w);
        const goal = series.goal(w);
        const col = el("div", w.current ? "trend-col current" : "trend-col");
        col.tabIndex = 0;
        const plot = el("div", "trend-plot");
        const bar = el("div", "trend-bar");
        bar.style.height = `${(value / max) * 100}%`;
        // No data that week: no bar at all, so it doesn't read as zero.
        if (series.show(w) === "None") bar.style.minHeight = "0";
        // The number floats above the bar so it never takes height from it.
        if (w.current || value === biggest) bar.append(el("div", "trend-cap", series.show(w)));
        plot.append(bar);
        // Dashed mark at the week's goal (only weeks since goals started).
        if (goal !== null) {
            const mark = el("div", "trend-goal");
            mark.style.bottom = `${(goal / max) * TREND_PLOT_PX}px`;
            plot.append(mark);
        }
        const tip = el("div", "trend-tip");
        tip.append(
            el("strong", "", `${series.show(w)} ${series.label.toLowerCase()}`),
            ...(series.detail && series.detail(w) ? [el("span", "", series.detail(w))] : []),
            ...(series.key !== "active" ? [el("span", "", `${w.active} active`)] : []),
            el("span", "", plural(w.web, "web voter")),
            el("span", "", `${plural(w.sent, "zzzap")} sent`),
            ...(series.key !== "senders" ? [el("span", "", plural(w.senders, "sender"))] : []),
            ...(goal !== null ? [el("span", "", `Goal ${goal}${series.max === 100 ? "%" : ""}`)] : []),
            el("span", "trend-tip-week", w.current ? "Last 7 days" : `Week of ${shortDate(w.start)}`),
        );
        col.append(plot, tip, el("div", "trend-label", w.current ? "Now" : `${w.start.getMonth() + 1}/${w.start.getDate()}`));
        chart.append(col);
    }
    chartSlot.replaceChildren(chart);
}

// Every number for every week, for reading exact values.
function buildTrendTable() {
    const details = el("details", "trend-table");
    details.append(el("summary", "", "Show as a table"));
    const table = el("table");
    const head = el("tr");
    ["Week of", "Active people", "Goal", "Web voters", "Zzzaps sent", "Senders", "Busiest share", "Came back", "After a month", "Vote rate"].forEach(h => head.append(el("th", "", h)));
    table.append(head);
    for (const w of [...trendWeeks].reverse()) {
        const row = el("tr");
        [w.current ? "Last 7 days" : shortDate(w.start), w.active, w.goal === null ? "" : w.goal, w.web, w.sent, w.senders, w.share === null ? "" : `${w.share}%`, ...TREND_SERIES.slice(3).map(r => (r.detail(w) ? r.show(w) : ""))].forEach(v => row.append(el("td", "", String(v))));
        table.append(row);
    }
    details.append(table);
    return details;
}

// ---------- Devices ----------
// Each person's phone, iOS and Zzzap version, saved by the app at most once
// a day (DeviceReport.swift → devices/{uid}). Admin read only.

const DEVICE_DAYS = 30;

// Apple's model codes. A code not listed shows as the code itself
// (new phones, like the Duo, until their name is added here).
const MODEL_NAMES = {
    "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro", "iPhone12,5": "iPhone 11 Pro Max",
    "iPhone12,8": "iPhone SE (2nd gen)",
    "iPhone13,1": "iPhone 12 mini", "iPhone13,2": "iPhone 12", "iPhone13,3": "iPhone 12 Pro", "iPhone13,4": "iPhone 12 Pro Max",
    "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13", "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max",
    "iPhone14,6": "iPhone SE (3rd gen)",
    "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus", "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max",
    "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus", "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
    "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max",
    "iPhone17,5": "iPhone 16e",
    "iPhone18,3": "iPhone 17", "iPhone18,4": "iPhone Air", "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max",
};

function modelName(code) {
    return MODEL_NAMES[code] || code || "Unknown";
}

// "1.1.10" sorts after "1.1.9".
function compareVersions(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff) return diff;
    }
    return 0;
}

async function loadDevices() {
    const since = Timestamp.fromMillis(Date.now() - DEVICE_DAYS * DAY);
    const snap = await getDocs(query(collection(db, "devices"), where("lastSeen", ">=", since)));
    const devices = snap.docs
        .map(d => ({ uid: d.id, ...d.data(), lastSeen: toDate(d.data().lastSeen) }))
        .filter(d => d.channel !== "Simulator");
    // Names for the Each person table. A deleted or unreadable account
    // just shows without a name.
    await Promise.all(devices.map(async d => {
        try {
            const user = await getDoc(doc(db, "users", d.uid));
            d.name = user.data()?.displayName || "";
        } catch {
            d.name = "";
        }
    }));
    return devices;
}

// One card per question: each value as a bar, how many people, what share.
// One series, so no legend; the newest Zzzap version is yellow (like the
// current week in the trend), everything else gray.
function countCard(heading, devices, valueOf, sort, highlight) {
    const counts = new Map();
    for (const d of devices) {
        const value = valueOf(d);
        counts.set(value, (counts.get(value) || 0) + 1);
    }
    const rows = [...counts.entries()].sort(sort || ((a, b) => b[1] - a[1]));
    const card = el("div", "device-card");
    card.append(el("div", "stat-title", heading));
    for (const [value, count] of rows) {
        const share = percent(count, devices.length);
        const row = el("div", "device-row" + (highlight && value === highlight ? " highlight" : ""));
        row.title = `${value}: ${count} ${count === 1 ? "person" : "people"}, ${share}`;
        const label = el("div", "device-label");
        label.append(el("span", "device-name", String(value)), el("span", "device-count", `${count} · ${share}`));
        const track = el("div", "device-track");
        const bar = el("div", "device-bar");
        bar.style.width = `${(count / devices.length) * 100}%`;
        track.append(bar);
        row.append(label, track);
        card.append(row);
    }
    return card;
}

function buildDevices(devices) {
    if (!devices.length) {
        return [el("p", "surge-muted", "No phones yet. They show up after people open a Zzzap build from Nov 3 or later.")];
    }
    const newestFirst = (a, b) => compareVersions(b[0], a[0]);
    const newestApp = [...devices].map(d => d.appVersion).sort(compareVersions).pop();
    const grid = el("div", "device-grid");
    grid.append(
        countCard("Zzzap version", devices, d => d.appVersion, newestFirst, newestApp),
        countCard("iOS version", devices, d => d.iosVersion, newestFirst),
        countCard("Phone", devices, d => modelName(d.model)),
        countCard("Installed from", devices, d => d.channel),
    );

    // Each person, oldest Zzzap version first, so who needs to update is on top.
    const details = el("details", "trend-table");
    details.append(el("summary", "", `Each person (${devices.length})`));
    const table = el("table");
    const head = el("tr");
    ["Name", "Zzzap", "iOS", "Phone", "From", "Last opened"].forEach(h => head.append(el("th", "", h)));
    table.append(head);
    const sorted = [...devices].sort((a, b) => compareVersions(a.appVersion, b.appVersion) || (a.name || "").localeCompare(b.name || ""));
    for (const d of sorted) {
        const row = el("tr");
        [d.name || "No name", `${d.appVersion} (${d.build})`, d.iosVersion, modelName(d.model), d.channel, d.lastSeen ? daysAgo(d.lastSeen) : ""]
            .forEach(v => row.append(el("td", "", String(v))));
        table.append(row);
    }
    details.append(table);
    return [grid, details];
}

async function refreshDevices() {
    try {
        els.devices.replaceChildren(...buildDevices(await loadDevices()));
    } catch (err) {
        console.warn("[STATS] devices", err.message);
        els.devices.replaceChildren(el("p", "surge-muted", `Couldn't load devices: ${err.message}`));
    }
}

// ---------- Social followers ----------

function shortDate(date) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function daysAgo(date) {
    const days = Math.floor((Date.now() - date.getTime()) / DAY);
    if (days <= 0) return "today";
    return days === 1 ? "yesterday" : `${days} days ago`;
}

// Newest entries first, so the first two per account are the latest and
// the one before it.
async function loadSocial() {
    const snap = await getDocs(query(collection(db, "socialStats"), orderBy("enteredAt", "desc"), limit(200)));
    const byPlatform = {};
    for (const d of snap.docs) {
        const { platform, followers } = d.data();
        const at = toDate(d.data().enteredAt);
        if (!at) continue;
        (byPlatform[platform] ||= []).push({ followers, at });
    }
    return byPlatform;
}

function buildSocialBoxes(byPlatform) {
    return SOCIAL.map(({ id, name }) => {
        const [latest, previous] = byPlatform[id] || [];
        if (!latest) {
            return { title: name, value: "Not set", detail: "No count saved yet", due: true };
        }
        const due = Date.now() - latest.at.getTime() >= SOCIAL_STALE_DAYS * DAY;
        let growth = "First count saved";
        if (previous) {
            const diff = latest.followers - previous.followers;
            growth = diff === 0
                ? `Same as ${shortDate(previous.at)}`
                : `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff).toLocaleString()} since ${shortDate(previous.at)}`;
        }
        return {
            title: name,
            value: latest.followers.toLocaleString(),
            detail: `${growth}. Updated ${daysAgo(latest.at)}`,
            due,
        };
    });
}

// Due note at the top of the tab, plus a dot on the Stats tab so it shows
// from any tab.
function showSocialDue(boxes) {
    const due = boxes.filter(b => b.due).map(b => b.title);
    els.socialDue.hidden = due.length === 0;
    els.socialDue.textContent = due.length
        ? `Time to update follower counts: ${due.join(", ")}. Type the new numbers under Social followers and Save.`
        : "";
    els.tab.querySelector(".tab-due")?.remove();
    if (due.length) {
        const dot = el("span", "tab-due");
        dot.title = "Follower counts are due";
        els.tab.append(dot);
    }
}

async function refreshSocial() {
    const boxes = buildSocialBoxes(await loadSocial());
    els.socialBoxes.replaceChildren(...boxes.map(box));
    showSocialDue(boxes);
}

function setSocialStatus(message, kind = "") {
    els.socialStatus.textContent = message;
    els.socialStatus.className = `status-message ${kind}`;
}

async function saveSocial(e) {
    e.preventDefault();
    const inputs = [...els.socialForm.querySelectorAll("input[data-platform]")];
    const entries = [];
    for (const input of inputs) {
        // Allow "1,234" or "1 234"; anything else that isn't a whole number is a typo.
        const raw = input.value.replace(/[,\s]/g, "");
        if (!raw) continue;
        if (!/^\d+$/.test(raw)) {
            setSocialStatus(`${input.labels[0].textContent} needs a whole number, like 1250.`, "error");
            input.focus();
            return;
        }
        entries.push({ platform: input.dataset.platform, followers: Number(raw) });
    }
    if (!entries.length) {
        setSocialStatus("Type at least one follower count first.", "error");
        return;
    }

    els.socialSave.disabled = true;
    setSocialStatus("Saving…");
    try {
        await Promise.all(entries.map(entry => addDoc(collection(db, "socialStats"), {
            ...entry,
            enteredAt: serverTimestamp(),
            enteredBy: auth.currentUser.uid,
        })));
        inputs.forEach(input => { input.value = ""; });
        await refreshSocial();
        setSocialStatus(`Saved ${entries.length === 1 ? "1 count" : `${entries.length} counts`}.`, "success");
    } catch (err) {
        console.error("[STATS] social save", err);
        setSocialStatus(`Couldn't save: ${err.message}`, "error");
    } finally {
        els.socialSave.disabled = false;
    }
}

// Read once at sign-in so the due dot shows even before Stats is opened.
// Marketing-only accounts can't read socialStats; they don't see Stats either.
function loadSocialQuietly() {
    refreshSocial().catch(err => console.warn("[STATS] social", err.message));
}

// ---------- Render ----------

function renderSample() {

}

async function load() {
    if (loading) return;
    loading = true;
    els.refresh.disabled = true;
    setStatus("Loading…");
    try {
        const polls = await loadZzzaps();
        const appPeople = appPeopleIn(polls);
        els.live.replaceChildren(...buildLiveBoxes(polls, appPeople).map(box));
        els.trend.replaceChildren(buildTrend(polls, appPeople));
        refreshDevices();
        loadSocialQuietly();
        loaded = true;
        const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const recent = polls.filter(p => createdMs(p) >= Date.now() - 30 * DAY).length;
        setStatus(`Updated ${time}. ${recent} zzzaps in the last 30 days, ${polls.length} in the last ${WEEKS} weeks.`);
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
els.socialForm.addEventListener("submit", saveSocial);
els.infoClose.addEventListener("click", () => els.infoDialog.close());
// Clicking the dimmed area outside the box closes it too.
els.infoDialog.addEventListener("click", e => { if (e.target === els.infoDialog) els.infoDialog.close(); });
document.querySelectorAll(".admin-tab").forEach(t => t.addEventListener("click", () => setTimeout(loadIfShowing)));
onAuthStateChanged(auth, user => {
    if (user) {
        loadSocialQuietly();
        loadIfShowing();
    } else {
        loaded = false;
        els.live.replaceChildren();
        els.trend.replaceChildren();
        els.devices.replaceChildren();
        els.socialBoxes.replaceChildren();
        showSocialDue([]);
        setStatus("");
        setSocialStatus("");
    }
});
