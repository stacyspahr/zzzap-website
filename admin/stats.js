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
    getFirestore, collection, query, where, getDocs, Timestamp,
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
    sample: document.getElementById("stats-sample"),
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
function box({ title, value, detail, needs, due }) {
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

    const sentNow = lastWeek.filter(p => p.status !== "cancelled").length;
    const sentBefore = weekBefore.filter(p => p.status !== "cancelled").length;

    return [
        { title: "Zzzaps sent", value: String(sentNow), detail: `Last 7 days. ${change(sentNow, sentBefore)}` },
        { title: "Active people", value: String(activeNow.size), detail: "In the app. Sent or voted in the last 7 days" },
        { title: "Web voters", value: String(web.size), detail: "Voted on the web without the app, last 7 days" },
        { title: "Came back", value: percent(cameBack, activeBefore.size), detail: `${cameBack} of ${activeBefore.size} active the week before were active again this week` },
        { title: "After a month", value: percent(stayed, activeMonthAgo.size), detail: `${stayed} of ${activeMonthAgo.size} active 4 weeks ago were active again this week` },
        { title: "Vote rate", value: percent(answered, asked), detail: `${answered} of ${asked} people asked voted. Finished zzzaps, last 30 days` },
        { title: "Strike vs Storm", value: `${sent.length - storms} / ${storms}`, detail: `Last 30 days. ${photos} with photos` },
        { title: "People per zzzap", value: avgAsked, detail: `Average sent to, last 30 days. ${cancelled} cancelled` },
    ];
}

// ---------- 12-week trend ----------

// One column per week, oldest on the left. Active people in the app is the
// bar; web voters ride along in the tooltip and the table, not as a second
// color. The current week is yellow, the rest gray.
function buildTrend(allPolls, appPeople) {
    const now = Date.now();
    const notCancelled = allPolls.filter(p => p.status !== "cancelled");
    const weeks = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
        const inWeek = weekOf(notCancelled, i, now);
        weeks.push({
            start: new Date(now - (i + 1) * 7 * DAY),
            active: activePeople(inWeek, appPeople).size,
            web: webVoters(inWeek, appPeople).size,
            sent: inWeek.length,
            current: i === 0,
        });
    }
    const max = Math.max(1, ...weeks.map(w => w.active));

    const wrap = el("div", "trend");
    const chart = el("div", "trend-chart");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `Active people in the app per week, last ${WEEKS} weeks: ${weeks.map(w => w.active).join(", ")}. This week ${weeks[weeks.length - 1].active}.`);
    for (const w of weeks) {
        const col = el("div", w.current ? "trend-col current" : "trend-col");
        col.tabIndex = 0;
        const plot = el("div", "trend-plot");
        if (w.current || w.active === max) plot.append(el("div", "trend-cap", String(w.active)));
        const bar = el("div", "trend-bar");
        bar.style.height = `${(w.active / max) * 100}%`;
        plot.append(bar);
        const tip = el("div", "trend-tip");
        const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
        tip.append(el("strong", "", `${w.active} active`), el("span", "", plural(w.web, "web voter")), el("span", "", `${plural(w.sent, "zzzap")} sent`), el("span", "trend-tip-week", w.current ? "Last 7 days" : `Week of ${shortDate(w.start)}`));
        col.append(plot, tip, el("div", "trend-label", w.current ? "Now" : `${w.start.getMonth() + 1}/${w.start.getDate()}`));
        chart.append(col);
    }
    wrap.append(chart);

    // Same numbers as a table, for reading exact values.
    const details = el("details", "trend-table");
    details.append(el("summary", "", "Show as a table"));
    const table = el("table");
    const head = el("tr");
    ["Week of", "Active people", "Web voters", "Zzzaps sent"].forEach(h => head.append(el("th", "", h)));
    table.append(head);
    for (const w of [...weeks].reverse()) {
        const row = el("tr");
        [w.current ? "Last 7 days" : shortDate(w.start), w.active, w.web, w.sent].forEach(v => row.append(el("td", "", String(v))));
        table.append(row);
    }
    details.append(table);
    wrap.append(details);
    return wrap;
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
    els.sample.replaceChildren(...SAMPLE_BOXES.map(box));
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
        els.socialBoxes.replaceChildren();
        showSocialDue([]);
        setStatus("");
        setSocialStatus("");
    }
});
