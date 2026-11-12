// Admin console core: Firebase setup, sign in / out, roles, and the original
// Zzzap Official zzzap sender (parked until v1.3). Moved out of index.html
// unchanged on 2026-11-06 (admin site clean-out); split further as tabs move.
// Firebase Web SDK v10 (modular, ESM via CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, where, orderBy, limit, onSnapshot, Timestamp,
    getDoc, getDocs, doc, documentId
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
    getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

// ───────────────────────────────────────────────────────────────
// Firebase web config — wired 2026-06-07
// ───────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyBaTfoiq1UN0GtRgf1k6BO3tY7vcm1g0Eg",
    authDomain: "spahrzap.firebaseapp.com",
    projectId: "spahrzap",
    storageBucket: "spahrzap.firebasestorage.app",
    messagingSenderId: "838021448718",
    appId: "1:838021448718:web:fcb8b87db61d8b7786685f",
    measurementId: "G-X5EMHRXGRZ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// ───────────────────────────────────────────────────────────────
// Auth flow
// ───────────────────────────────────────────────────────────────
const signinView = document.getElementById("signin-view");
const noAccessView = document.getElementById("no-access-view");
const adminView = document.getElementById("admin-view");
const signinForm = document.getElementById("signin-form");
const signinBtn = document.getElementById("signin-btn");
const signinError = document.getElementById("signin-error");
const signoutBtn = document.getElementById("signout-btn");
const userName = document.getElementById("user-name");

// Persist auth across page reloads so we don't have to sign in
// every time we open a new tab.
setPersistence(auth, browserLocalPersistence).catch(() => {});

signinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    signinError.textContent = "";
    signinBtn.disabled = true;
    signinBtn.textContent = "Signing in…";
    try {
        const email = document.getElementById("signin-email").value.trim();
        const password = document.getElementById("signin-password").value;
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        signinError.textContent = err.message;
    } finally {
        signinBtn.disabled = false;
        signinBtn.textContent = "Sign in";
    }
});

signoutBtn.addEventListener("click", () => signOut(auth));

// Password change: Firebase emails a link to pick a new password.
// Firebase doesn't say whether an email has an account, so the
// message is the same either way.
async function sendReset(email) {
    await sendPasswordResetEmail(auth, email);
    return `If ${email} has an account, a link to set a new password is on its way. Check spam if it doesn't show up in a few minutes.`;
}

document.getElementById("reset-password-link").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = document.getElementById("signin-email").value.trim();
    signinError.className = "status-message error";
    if (!email) {
        signinError.textContent = "Type your email above first, then click this again.";
        return;
    }
    try {
        signinError.textContent = await sendReset(email);
        signinError.className = "status-message success";
    } catch (err) {
        signinError.textContent = err.message;
    }
});

document.getElementById("change-password-link").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = auth.currentUser?.email;
    if (!email) return;
    try {
        alert(await sendReset(email));
    } catch (err) {
        alert(`Couldn't send the email: ${err.message}`);
    }
});

let recentUnsub = null;
let queueUnsub = null;

document.getElementById("no-access-signout").addEventListener("click", () => signOut(auth));

// Roles (Stacy 2026-11-06). One role per person:
//   owner      Stacy, Zak: everything
//   moderator  the Inbox only
//   marketing  Brand only (Haley)
// Planned source (Zak): admins/{uid}.role, readable by that person. Until his
// rule is in, the old config/adminRoles map still works, and an account with
// no role counts as an owner only if it can read reports (an admins-only read).
// Anyone else gets "No access". Hiding tabs is a convenience; the server rules
// are what actually keep private data private.
const ROLE_TABS = { owner: null, moderator: ["today", "inbox"], marketing: ["marketing"] };

async function roleFor(uid) {
    try {
        const own = await getDoc(doc(db, "admins", uid));
        if (own.exists()) return ROLE_TABS.hasOwnProperty(own.data().role) ? own.data().role : "owner";
        // Readable but missing: not on the list (the old map may still say marketing).
        return await legacyRole(uid);
    } catch (_) {
        // Zak's self-read rule isn't in yet.
        const legacy = await legacyRole(uid);
        if (legacy) return legacy;
        try {
            await getDocs(query(collection(db, "reports"), limit(1)));
            return "owner";
        } catch (err) {
            return null;
        }
    }
}

async function legacyRole(uid) {
    try {
        const snap = await getDoc(doc(db, "config", "adminRoles"));
        const role = snap.exists() ? snap.data()[uid] : null;
        return ROLE_TABS.hasOwnProperty(role) ? role : null;
    } catch (err) {
        return null;
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const role = await roleFor(user.uid);
        signinView.classList.add("hidden");
        if (!role) {
            // Signed in but not on the list: no tabs at all.
            noAccessView.classList.remove("hidden");
            adminView.classList.add("hidden");
            document.getElementById("no-access-email").textContent = user.email || "This account";
            return;
        }
        noAccessView.classList.add("hidden");
        window.adminTabs.allow(ROLE_TABS[role]);
        adminView.classList.remove("hidden");
        userName.textContent = user.email || user.displayName || "Admin";
        console.log("[ADMIN] signed in as", user.uid, "— send this UID to Zak for the allowlist");
        if (role !== "owner") return; // no Reach People tab, so no Official listeners
        startRecentListener();
        startQueueListener();
        updateRecipientsHint();
    } else {
        signinView.classList.remove("hidden");
        adminView.classList.add("hidden");
        noAccessView.classList.add("hidden");
        if (recentUnsub) { recentUnsub(); recentUnsub = null; }
        if (queueUnsub) { queueUnsub(); queueUnsub = null; }
        userNameCache.clear();
        cachedBrandFollowers = null;
    }
});

// ───────────────────────────────────────────────────────────────
// Compose form
// ───────────────────────────────────────────────────────────────
const optionsContainer = document.getElementById("options-container");
const addOptionBtn = document.getElementById("add-option");
const recipientsSel = document.getElementById("recipients");
const customUidsRow = document.getElementById("custom-uids-row");
const composeForm = document.getElementById("compose-form");
const sendBtn = document.getElementById("send-btn");
const composeStatus = document.getElementById("compose-status");

addOptionBtn.addEventListener("click", () => {
    const idx = optionsContainer.children.length + 1;
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `
        <input type="text" placeholder="Option ${idx}" class="option-input" required>
        <button type="button" class="remove-option" title="Remove">×</button>
    `;
    optionsContainer.appendChild(row);
});

optionsContainer.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-option")) {
        // Don't allow fewer than 2 options
        if (optionsContainer.children.length > 2) {
            e.target.parentElement.remove();
        }
    }
});

recipientsSel.addEventListener("change", () => {
    customUidsRow.classList.toggle("hidden", recipientsSel.value !== "custom");
});

// Storm vs Strike: toggle which fields are visible + required.
const pollTypeSel = document.getElementById("poll-type");
const optionsRow = document.getElementById("options-row");
const stormLimitRow = document.getElementById("storm-limit-row");
function applyPollType() {
    const isStorm = pollTypeSel.value === "storm";
    optionsRow.classList.toggle("hidden", isStorm);
    stormLimitRow.classList.toggle("hidden", !isStorm);
    // Strip the required attribute from options when Storm so
    // form validation doesn't block submit on an empty options row.
    document.querySelectorAll(".option-input").forEach(i => {
        if (isStorm) i.removeAttribute("required");
        else i.setAttribute("required", "");
    });
}
pollTypeSel.addEventListener("change", applyPollType);

// Schedule toggle: reveal datetime picker + relabel the submit button
const scheduleToggle = document.getElementById("schedule-toggle");
const scheduleWhenRow = document.getElementById("schedule-when-row");
const scheduleWhen = document.getElementById("schedule-when");
function applyScheduleToggle() {
    const on = scheduleToggle.checked;
    scheduleWhenRow.classList.toggle("hidden", !on);
    if (on && !scheduleWhen.value) {
        // Default to 1 hour from now, rounded to next 15min
        const d = new Date(Date.now() + 60 * 60 * 1000);
        d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
        const pad = (n) => String(n).padStart(2, "0");
        scheduleWhen.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    sendBtn.textContent = on ? "Schedule" : "Send as Zzzap Official";
}
scheduleToggle.addEventListener("change", applyScheduleToggle);

composeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    composeStatus.textContent = "";
    composeStatus.className = "status-message";
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";

    try {
        const pollType = pollTypeSel.value;
        const question = document.getElementById("question").value.trim();
        const options = pollType === "storm"
            ? []
            : [...document.querySelectorAll(".option-input")]
                .map(i => i.value.trim())
                .filter(v => v.length > 0);
        const timeLimit = parseInt(document.getElementById("time-limit").value, 10);
        const stormCharLimit = pollType === "storm"
            ? parseInt(document.getElementById("storm-char-limit").value, 10)
            : null;
        const uiMode = recipientsSel.value;
        const customUidsRaw = document.getElementById("custom-uids").value;
        // Client-side expansion of "all testers" — the Cloud Function
        // is supposed to do this server-side, but until ZZZ-298 ships
        // we fetch the Zzzap Official followers array ourselves and
        // pass the full UID list as `recipients`. Stays in place as
        // a safety net even after the server fix lands.
        //
        // CRITICAL: we resolve the list client-side, then always tell
        // the Cloud Function we're in "custom" mode regardless of
        // what the admin picked. If we kept `mode: "all"`, the
        // function would see that flag and try its own server-side
        // expansion — which today returns empty and silently
        // overwrites our resolved list with []. Forcing "custom"
        // makes our resolved recipients authoritative.
        let recipients;
        if (uiMode === "custom") {
            recipients = customUidsRaw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        } else {
            recipients = await fetchBrandFollowers();
            if (recipients.length === 0) {
                throw new Error("No followers found on the Zzzap Official account. Use Custom UIDs instead.");
            }
        }
        const mode = "custom";

        const openBallot = document.getElementById("open-ballot").checked;
        // Scheduling: if toggled, pass an ISO timestamp; Cloud Function
        // writes status="scheduled" + scheduledFor on the poll doc and
        // the existing lifecycle Cloud Tasks scheduler flips it to
        // "active" at that time (same path as iOS scheduled polls).
        const scheduledFor = scheduleToggle.checked && scheduleWhen.value
            ? new Date(scheduleWhen.value).toISOString()
            : null;

        const composeFn = httpsCallable(functions, "composeBrandPoll");
        const result = await composeFn({ pollType, question, options, timeLimit, stormCharLimit, openBallot, scheduledFor, recipients, mode });

        composeStatus.textContent = `Sent! Poll ID: ${result.data.pollId}`;
        composeStatus.classList.add("success");
        composeForm.reset();
        // Restore 2 default option rows
        optionsContainer.innerHTML = `
            <div class="option-row">
                <input type="text" placeholder="Option 1" class="option-input" required>
                <button type="button" class="remove-option" title="Remove">×</button>
            </div>
            <div class="option-row">
                <input type="text" placeholder="Option 2" class="option-input" required>
                <button type="button" class="remove-option" title="Remove">×</button>
            </div>
        `;
    } catch (err) {
        composeStatus.textContent = `Error: ${err.message}`;
        composeStatus.classList.add("error");
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send as Zzzap Official";
    }
});

// ───────────────────────────────────────────────────────────────
// Templates — click to fill the compose form
// ───────────────────────────────────────────────────────────────
// Edit this array to add/remove/rewrite templates. Keep options
// to 4 or fewer for best UX. timeLimit is in minutes.
// openBallot defaults: Awareness/Prioritization/Quick = true
// (you'll want follow-up); Friction = false (anonymity gets
// more honest criticism). Override per-template if needed.
const templates = [
    // Voice locked: see memory/project-zzzap-official-voice.md.
    // Editorial, adult, trusted. Lead with the question, no
    // preamble. No em dashes (use periods). No urgency words.
    // Implementation-intention voter options stay — they're the
    // voter committing to themselves, which is the one place
    // "now" is allowed.

    // AWARENESS — find out who knows about each feature.
    // featureTag links the broadcast template to its matching teach
    // template below, so the per-voter Teach button on a Recent row
    // knows which teaching zzzap to pre-fill.
    { category: "Awareness", name: "Tried a Storm?", featureTag: "storm",
      question: "Have you sent a Storm yet? It's the write-in version. No preset options.",
      options: ["Yes, used it", "Not yet. Trying one now.", "Show me how"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Lock-screen voting?", featureTag: "lock_screen",
      question: "Have you voted on a zzzap from the lock screen yet? Long-press the notification to see options.",
      options: ["Yes, love it", "Not yet. Trying it next time.", "Tried, didn't work"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Smart Circles?", featureTag: "smart_circles",
      question: "Have you used Smart Circles yet? All Followers, Mutuals, and a few others.",
      options: ["Yes, use them", "Not yet. Setting one up now.", "Show me how"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Secret zzzaps?", featureTag: "private",
      question: "Have you sent a secret zzzap? Results vanish 30 seconds after viewing.",
      options: ["Yes, sent one", "Not yet. Sending one now.", "What does private mean?"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Scheduling?", featureTag: "scheduling",
      question: "Have you scheduled a zzzap to send later?",
      options: ["Yes, used it", "Not yet. Trying it now.", "Show me where"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Pin a zzzap?", featureTag: "pin",
      question: "Have you pinned a zzzap to the top of your feed? Long-press the row.",
      options: ["Yes, use it", "Not yet. Trying it now.", "Show me how"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Vote comments?", featureTag: "comments",
      question: "Have you left a comment with your vote yet? Tap Add a comment under the results after voting.",
      options: ["Yes, used it", "Not yet. Trying it now.", "Show me where"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Send Feedback?", featureTag: "feedback",
      question: "Have you used Send Feedback yet? It lives in your Profile, under Settings. Anything that feels off goes there.",
      options: ["Yes, sent some", "Not yet. Sending one now.", "Show me where"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Editing a zzzap?", featureTag: "edit",
      question: "Have you edited a zzzap after sending it? Works on scheduled ones, and on any that nobody's voted on yet.",
      options: ["Yes, used it", "Not yet. Trying it now.", "Show me how"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Dynamic Island?", featureTag: "dynamic_island",
      question: "Have you watched a zzzap from the Dynamic Island yet? Tap and hold the pill to see the countdown and live tally.",
      options: ["Yes, love it", "Not yet. Trying it next time.", "What's the Dynamic Island?"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Open ballot?", featureTag: "open_ballot",
      question: "Have you sent an open-ballot zzzap? The creator sees who voted what after it ends.",
      options: ["Yes, used it", "Not yet. Trying one now.", "Show me where"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Hey Siri?", featureTag: "siri",
      question: "Have you tried saying \"Hey Siri, create a poll on Zzzap\"? Opens straight to voice creation.",
      options: ["Yes, used it", "Not yet. Trying it now.", "Show me how"],
      timeLimit: 1440, openBallot: true },
    { category: "Awareness", name: "Photo zzzaps?", featureTag: "photo",
      question: "Have you sent a photo zzzap? Each option becomes an image. Spark gets one free try.",
      options: ["Yes, sent one", "Not yet. Trying one now.", "Show me where"],
      timeLimit: 1440, openBallot: true },

    // FRICTION — sober, direct. Closed ballot by default for
    // honest criticism.
    { category: "Friction", name: "Most confusing part",
      question: "What's the most confusing part of Zzzap right now?",
      options: ["The invite gate", "Creating a Storm", "Voting", "Nothing really"],
      timeLimit: 2880, openBallot: false },
    { category: "Friction", name: "Where you get stuck",
      question: "Where do you get stuck most often in Zzzap?",
      options: ["Picking recipients", "Writing options", "Understanding results", "I don't"],
      timeLimit: 2880, openBallot: false },
    { category: "Friction", name: "What's missing? (Storm)",
      type: "storm",
      question: "What's one thing Zzzap is missing for you?",
      stormCharLimit: 50,
      timeLimit: 4320, openBallot: false },
    { category: "Friction", name: "Noisiest part of the app",
      question: "What feels noisiest in Zzzap right now?",
      options: ["The Home tab", "The Zzzaps tab", "Notifications", "Nothing really"],
      timeLimit: 2880, openBallot: false },
    { category: "Friction", name: "Regressions?",
      question: "Anything that used to work and now doesn't?",
      options: ["Yes. Sending it through Feedback.", "Not that I've noticed", "Haven't used it enough"],
      timeLimit: 2880, openBallot: false },

    // PRIORITIZATION — editorial framing.
    { category: "Prioritization", name: "Most-wanted Power capability",
      question: "Which Power capability would you pay to unlock unlimited?",
      options: ["Unlimited photo zzzaps", "Unlimited secret zzzaps", "Unlimited open ballots", "Bigger recipient circles"],
      timeLimit: 2880, openBallot: true },
    { category: "Prioritization", name: "Invite cap?",
      question: "Is 15 recipients per zzzap enough for your decisions?",
      options: ["Plenty", "Sometimes I need more", "Need way more"],
      timeLimit: 2880, openBallot: true },
    { category: "Prioritization", name: "Dream feature (Storm)",
      type: "storm",
      question: "If you could add one feature to Zzzap, what would it be?",
      stormCharLimit: 50,
      timeLimit: 4320, openBallot: true },
    { category: "Prioritization", name: "New card look",
      question: "How do the new Zzzap cards feel? Status pills are mostly gone, the result leads, the type sits behind as a watermark.",
      options: ["Cleaner. Keep going.", "About the same", "Liked the old way better"],
      timeLimit: 2880, openBallot: true },

    // QUICK — voice can relax slightly for real-life filler.
    { category: "Quick", name: "Friday plans?",
      question: "What are you doing Friday night?",
      options: ["Going out", "Staying in", "Working", "No plans yet"],
      timeLimit: 1440, openBallot: true },
];

// Teach templates: explanation-first 1-on-1 zzzaps used by the per-voter
// Teach button on each Recent row's expanded view. Keyed by featureTag,
// so when a Recent row's parent broadcast template carries a matching
// featureTag we know which teach zzzap to pre-fill.
//
// Structure mirrors broadcast templates (question + options) but
// inverts the voice: question text carries the explanation, options
// are the implementation-intention + escalation trio. The "Still
// not clear" option is the trip-wire that tells Stacy to text the
// tester directly (Tier 3 in the coaching playbook).
// Teach templates use a 4h window — long enough to feel polite,
// short enough to keep the implementation-intention ("Sending
// one now") fresh. Broadcasts can sit 24h; 1-on-1 coaching
// shouldn't claim "23h left" all day.
const teachTemplates = {
    storm: {
        name: "Teach: Storm",
        question: "A Storm lets voters write in their own answers. No preset options, just a question and a place to brainstorm. Try one?",
        options: ["Sending one now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    lock_screen: {
        name: "Teach: Lock-screen voting",
        question: "You can vote on a zzzap without unlocking your phone. Long-press the notification, options appear, tap one. Try it next time you get a zzzap?",
        options: ["Trying it next time.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    smart_circles: {
        name: "Teach: Smart Circles",
        question: "Smart Circles are pre-built recipient lists. All Followers, Mutuals, Usuals. Pick one when sending instead of selecting people one by one. Try one?",
        options: ["Setting one up now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    private: {
        name: "Teach: Secret zzzaps",
        question: "Secret zzzaps auto-destroy 30 seconds after viewing. Perfect for personal stuff. Try one now?",
        options: ["Sending one now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    scheduling: {
        name: "Teach: Scheduling",
        question: "You can schedule a zzzap to send later. Useful for asking around dinner without setting a reminder. Try it?",
        options: ["Trying it now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    pin: {
        name: "Teach: Pinning",
        question: "Pin a zzzap to the top of your feed by long-pressing the row. Stays put until you unpin. Try it on any active zzzap?",
        options: ["Trying it now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    comments: {
        name: "Teach: Vote comments",
        question: "After you vote, an Add a comment button appears under the results. Lets you tell the creator your reasoning. Try it next time you vote?",
        options: ["Trying it next time.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    feedback: {
        name: "Teach: Send Feedback",
        question: "Send Feedback lives in your Profile, under Settings. Anything that feels off, send it through. Try it now?",
        options: ["Sending one now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    edit: {
        name: "Teach: Editing a zzzap",
        question: "You can edit a zzzap after sending. Open it, tap Edit. Works on scheduled zzzaps and on any that nobody's voted on yet. Try it next time?",
        options: ["Trying it next time.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    dynamic_island: {
        name: "Teach: Dynamic Island",
        question: "When a zzzap is active, the Dynamic Island shows the countdown at the top of your screen. Tap and hold the pill to expand and watch the live vote tally. Voting still happens from the lock-screen notification. Try it next time?",
        options: ["Trying it next time.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    open_ballot: {
        name: "Teach: Open ballot",
        question: "Toggle Open Ballot when creating a zzzap. After it ends, you see who voted what. Voters are warned their votes will be visible. Try one?",
        options: ["Sending one now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    siri: {
        name: "Teach: Hey Siri",
        question: "Say \"Hey Siri, create a poll on Zzzap\" anywhere, even on your lock screen. Opens voice creation straight away. Try it?",
        options: ["Trying it now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    },
    photo: {
        name: "Teach: Photo zzzaps",
        question: "When you start a zzzap, tap the Photo Zzzap toggle. Each option becomes an image instead of text. Spark gets one free try. Try one?",
        options: ["Sending one now.", "Got it. Will try later.", "Still not clear."],
        timeLimit: 240, openBallot: true
    }
};

// Match a parent zzzap to a featureTag by comparing its question text
// against the broadcast templates. Brittle to manual edits — falls
// through to null if no match (chip then shows a blank Follow-up).
function inferFeatureTag(parentQuestion) {
    const q = (parentQuestion || "").trim().toLowerCase();
    if (!q) return null;
    for (const t of templates) {
        if (!t.featureTag) continue;
        if (t.question.trim().toLowerCase() === q) return t.featureTag;
    }
    return null;
}

const templatesList = document.getElementById("templates-list");

// Most recent Zzzap Official zzzaps, kept in module scope so the
// templates sidebar (last-sent staleness) and the expanded-row
// detail renderer (1-on-1 follow-up detection) can both read it
// without firing extra Firestore queries. Populated by the Recent
// listener; defaults to [] before sign-in so the initial
// renderTemplates() call doesn't hit a TDZ error.
let recentDocs = [];

// For each template, find the most recent Recent zzzap whose
// question matches exactly. Drives the "Sent 3d ago" indicator
// so the admin can pace coaching and avoid repeating themselves.
// Matches by exact question text — if a template was edited
// before sending, it won't pick up the date (acceptable; templates
// are meant to be used as-is for cadence tracking).
function lastSentDateForTemplate(template) {
    const q = template.question.trim().toLowerCase();
    let mostRecent = null;
    for (const d of recentDocs) {
        if ((d.data.question || "").trim().toLowerCase() !== q) continue;
        const t = d.data.createdAt?.toDate?.() || d.data.createdAt;
        if (!t) continue;
        if (!mostRecent || t > mostRecent) mostRecent = t;
    }
    return mostRecent;
}

function staleness(date) {
    if (!date) return null;
    const days = (Date.now() - date.getTime()) / 86400000;
    if (days < 2) return "fresh";
    if (days < 7) return "warm";
    return "cool";
}

function renderTemplates() {
    // Sort by last-sent date so the freshest candidates surface
    // first: never-sent templates at the top, then oldest sends,
    // then most-recently-sent at the bottom (least desirable to
    // repeat). Original indices are preserved for the click
    // handler's data-idx attribute.
    const ordered = templates
        .map((t, i) => ({ t, i, last: lastSentDateForTemplate(t) }))
        .sort((a, b) => {
            const aT = a.last ? a.last.getTime() : 0;
            const bT = b.last ? b.last.getTime() : 0;
            return aT - bT;
        });
    templatesList.innerHTML = ordered.map(({ t, i, last }) => {
        // Bolt iconography rule: single bolt = Strike (decisive
        // moment), tornado = Storm (brainstorm). Matches the iOS
        // app + the marketing site's duo cards.
        const isStorm = t.type === "storm";
        const icon = isStorm ? "&#127786;" : "&#9889;";
        const stale = staleness(last);
        const lastSentLine = last
            ? `<span class="template-last-sent ${stale}">Sent ${timeAgo(last)}</span>`
            : "";
        return `
        <button type="button" class="template-btn" data-idx="${i}">
            <span class="template-cat">
                <span class="template-icon">${icon}</span>
                ${escapeHtml(t.category)}
            </span>
            ${escapeHtml(t.name)}
            ${lastSentLine}
        </button>
        `;
    }).join("");
}
renderTemplates();

templatesList.addEventListener("click", (e) => {
    const btn = e.target.closest(".template-btn");
    if (!btn) return;
    const t = templates[parseInt(btn.dataset.idx, 10)];
    if (!t) return;
    const isStorm = t.type === "storm";
    // Type picker first (drives which fields are visible/required)
    pollTypeSel.value = isStorm ? "storm" : "strike";
    applyPollType();
    // Question + time limit always apply
    document.getElementById("question").value = t.question;
    document.getElementById("time-limit").value = String(t.timeLimit);
    // Open ballot — template can set explicitly; defaults to ON
    // for follow-up capability.
    document.getElementById("open-ballot").checked = t.openBallot !== false;
    if (isStorm) {
        if (t.stormCharLimit) {
            document.getElementById("storm-char-limit").value = String(t.stormCharLimit);
        }
    } else if (t.options) {
        // Rebuild option rows to match the template exactly
        optionsContainer.innerHTML = t.options.map((opt, i) => `
            <div class="option-row">
                <input type="text" placeholder="Option ${i + 1}" class="option-input" value="${escapeHtml(opt)}" required>
                <button type="button" class="remove-option" title="Remove">×</button>
            </div>
        `).join("");
    }
    // Scroll the form into view on mobile where the sidebar stacks above
    document.getElementById("question").focus();
    document.getElementById("question").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ───────────────────────────────────────────────────────────────
// Recent zzzaps (live listener)
// ───────────────────────────────────────────────────────────────
const recentList = document.getElementById("recent-list");

function startRecentListener() {
    const q = query(
        collection(db, "polls"),
        where("creatorId", "==", "zzzap_official"),
        orderBy("createdAt", "desc"),
        limit(30)
    );
    recentUnsub = onSnapshot(q,
        (snap) => {
            if (snap.empty) {
                recentDocs = [];
                recentList.innerHTML = `<p style="color:#666; font-size:13px;">No zzzaps from Zzzap Official yet.</p>`;
                renderTemplates();
                return;
            }
            recentDocs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
            const paceLine = renderPace(recentDocs);
            const rows = recentDocs.map(d => renderRecent(d.id, d.data)).join("");
            recentList.innerHTML = paceLine + rows;
            // Refresh the templates sidebar so each template's
            // "Sent X ago" indicator reflects the latest snapshot.
            renderTemplates();
        },
        (err) => {
            recentList.innerHTML = `<p style="color:#ff453a; font-size:13px;">Couldn't load: ${err.message}<br><small>(Make sure Zak added your UID to the admins allowlist + the Firestore rule that lets admins read brand polls.)</small></p>`;
        }
    );
}

// Computes how many zzzaps went out in the last 7 and 30 days so
// Stacy can gut-check cadence at a glance without scrolling.
function renderPace(docs) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Split last-7 into broadcasts vs targeted coaching so the
    // admin can read pacing per type — coaching cadence (which
    // can be heavy) shouldn't drown out broadcast cadence (which
    // should stay light). Same broadcast/targeted definition as
    // the row badge: BROADCAST = recipient count matches full
    // follower count, TARGETED = subset (single or group).
    const fullFollowerCount = cachedBrandFollowers?.length || 0;
    const isBroadcast = d => {
        const len = (d.data.recipients || []).length;
        return fullFollowerCount > 0 ? len === fullFollowerCount : len > 5;
    };
    const within = (d, span) => {
        const t = d.data.createdAt?.toDate?.()?.getTime?.() ?? 0;
        return now - t < span;
    };
    const last7Docs = docs.filter(d => within(d, 7 * day));
    const last7Broadcasts = last7Docs.filter(d => isBroadcast(d)).length;
    const last7Targeted = last7Docs.filter(d => !isBroadcast(d)).length;
    const last30 = docs.filter(d => within(d, 30 * day)).length;
    return `
        <div style="color:#999; font-size:12px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid #222;">
            <strong style="color:#f5c518;">${last7Broadcasts}</strong> broadcast${last7Broadcasts === 1 ? "" : "s"} ·
            <strong style="color:#f5c518;">${last7Targeted}</strong> targeted in the last 7 days
            <span style="margin-left:8px; color:#555;">(${last30} total in 30 days)</span>
        </div>
    `;
}

function renderRecent(id, data) {
    const recipients = data.recipients || [];
    const voters = data.voters ? Object.keys(data.voters).length : 0;
    const total = recipients.length;
    const expiresAt = data.expiresAt?.toDate?.() || data.expiresAt;
    const now = new Date();
    // Mirror the iOS poll-state logic: a zzzap is effectively
    // closed once everybody who could vote has voted, even if
    // the doc's expiresAt is still in the future. Without this,
    // 1-on-1 follow-ups stay ACTIVE for 24h after the single
    // recipient has acted, which clutters the active set and
    // misrepresents what's actually outstanding.
    const allVoted = total > 0 && voters >= total;
    const isActive = expiresAt && expiresAt > now && !allVoted;
    const statusLabel = isActive ? "ACTIVE" : "CLOSED";
    const statusClass = isActive ? "status-active" : "status-closed";
    const createdAt = data.createdAt?.toDate?.() || data.createdAt;
    const ago = createdAt ? timeAgo(createdAt) : "—";
    const absolute = createdAt ? formatAbsolute(createdAt) : "";
    const isStorm = (data.pollType || "").toLowerCase() === "storm";
    const stormBadge = isStorm
        ? `<span style="font-size:10px; font-weight:700; color:#000; background:#f5c518; padding:1px 6px; border-radius:6px; letter-spacing:0.5px;">STORM</span>`
        : "";
    // Scope badge: BROADCAST when the recipient list matches the
    // full Zzzap Official follower count, TARGETED for anything
    // smaller (single voter follow-ups AND multi-voter group
    // coaching). Falls back to the recipient-count heuristic
    // when we haven't loaded the follower count yet.
    const fullFollowerCount = cachedBrandFollowers?.length || 0;
    const isBroadcast = fullFollowerCount > 0
        ? recipients.length === fullFollowerCount
        : recipients.length > 5; // best-effort fallback
    const scopeBadge = isBroadcast
        ? `<span style="font-size:10px; font-weight:700; color:#000; background:#34c759; padding:1px 6px; border-radius:6px; letter-spacing:0.5px;">BROADCAST</span>`
        : `<span style="font-size:10px; font-weight:700; color:#bbb; background:#2a2a2a; padding:1px 6px; border-radius:6px; letter-spacing:0.5px;">TARGETED</span>`;
    return `
        <div class="recent-zzzap expandable" data-poll-id="${id}" data-poll-type="${isStorm ? "storm" : "strike"}">
            <div class="question">${stormBadge} ${scopeBadge} ${escapeHtml(data.question || "(no question)")}</div>
            <div class="meta">
                <span class="${statusClass}">${statusLabel}</span>
                <span>${voters} of ${total} voted</span>
                <span title="${absolute}">${ago}</span>
                <span class="expand-hint">click to expand ›</span>
            </div>
            <div style="margin-top:4px; color:#555; font-size:11px;">${absolute}</div>
        </div>
    `;
}

// ───────────────────────────────────────────────────────────────
// Vote details — expanded view inside each Recent row
// ───────────────────────────────────────────────────────────────

// Cache user display names so a session that fans out across
// many rows doesn't refetch the same UID. Wiped on signout.
const userNameCache = new Map();

// Click a Recent row → expand inline with vote details. Delegated
// listener so it survives the row re-renders that onSnapshot triggers.
recentList.addEventListener("click", async (e) => {
    // Group action button — "Teach these N" or "Nudge all N"
    const groupBtn = e.target.closest(".group-action");
    if (groupBtn) {
        e.stopPropagation();
        const uids = (groupBtn.dataset.uids || "").split(",").filter(Boolean);
        const action = groupBtn.dataset.action;
        const tag = groupBtn.dataset.tag;
        if (action === "teach" && tag) {
            sendTeachGroup(uids, tag);
        } else {
            prefillFollowUpGroup(uids);
        }
        return;
    }
    // Action button — either a chip in a voter pill or the small
    // Follow up link on a vote comment line. Same routing either
    // way: pre-fill compose with that uid + optional teach
    // template. stopPropagation so the row doesn't also toggle.
    const actionBtn = e.target.closest(".voter-chip button, .vc-followup");
    if (actionBtn) {
        e.stopPropagation();
        const uid = actionBtn.dataset.uid;
        const action = actionBtn.dataset.action;
        if (action === "teach") {
            const tag = actionBtn.dataset.tag;
            sendTeach(uid, tag);
        } else {
            prefillFollowUp(uid);
        }
        return;
    }
    const row = e.target.closest(".recent-zzzap.expandable");
    if (!row) return;

    const pollId = row.dataset.pollId;
    const pollType = row.dataset.pollType;
    const existing = row.querySelector(".details");
    if (existing) {
        existing.remove();
        row.classList.remove("expanded");
        return;
    }
    row.classList.add("expanded");
    const details = document.createElement("div");
    details.className = "details";
    details.innerHTML = `<div class="details-loading">Loading details…</div>`;
    row.appendChild(details);
    try {
        const html = await renderDetails(pollId, pollType);
        details.innerHTML = html;
    } catch (err) {
        console.error("[ADMIN] details load failed", err);
        details.innerHTML = `<div class="details-error">Couldn't load details: ${escapeHtml(err.message || String(err))}</div>`;
    }
});

async function renderDetails(pollId, pollType) {
    // Refetch the poll doc so we get a frozen snapshot for this render
    const pollDocs = await getDocs(query(collection(db, "polls"), where(documentId(), "==", pollId)));
    if (pollDocs.empty) return `<div class="details-error">Poll not found.</div>`;
    const poll = pollDocs.docs[0].data();
    const recipients = poll.recipients || [];
    const voters = poll.voters || {};

    // Lazy-fetch display names for everyone we'll show
    const uidsToFetch = new Set([...recipients, ...Object.keys(voters)]);
    await loadNames([...uidsToFetch]);

    // Per-voter context used by chip rendering:
    //   featureTag → drives the Teach button content (null = blank Follow up)
    //   followedUpUids → uids already coached 1-on-1 after this parent;
    //     marked with a green check on their chip.
    //   voteComments → uid → comment text the voter left with their vote
    const parentCreatedAt = poll.createdAt?.toDate?.() || poll.createdAt || new Date(0);
    const followedUpUids = new Set();
    for (const d of recentDocs) {
        const otherRecipients = d.data.recipients || [];
        if (otherRecipients.length !== 1) continue; // only single-recipient counts as a 1-on-1 follow-up
        const t = d.data.createdAt?.toDate?.() || d.data.createdAt;
        if (!t || t <= parentCreatedAt) continue;
        if (d.id === pollId) continue; // don't count the parent against itself
        followedUpUids.add(otherRecipients[0]);
    }
    const ctx = {
        featureTag: inferFeatureTag(poll.question),
        followedUpUids,
        voteComments: poll.voteComments || {}
    };

    if (pollType === "storm") {
        return await renderStormDetails(pollId, poll, recipients, voters, ctx);
    }
    return renderStrikeDetails(poll, recipients, voters, ctx);
}

function renderStrikeDetails(poll, recipients, voters, ctx) {
    const options = poll.options || [];
    // Bucket voters by the option they picked
    const byOption = options.map(() => []);
    for (const [uid, optionIndex] of Object.entries(voters)) {
        if (typeof optionIndex === "number" && optionIndex >= 0 && optionIndex < options.length) {
            byOption[optionIndex].push(uid);
        }
    }
    const totalVotes = Object.keys(voters).length;
    const optionBlocks = options.map((text, i) => {
        const count = byOption[i].length;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        return `
            <div class="option-result">
                <div class="option-result-header">
                    <span class="option-result-text">${escapeHtml(text)}</span>
                    <span class="option-result-count">${count} · ${pct}%</span>
                </div>
                <div class="option-result-bar"><div class="option-result-bar-fill" style="width:${pct}%"></div></div>
                ${renderGroupAction(byOption[i], ctx, "teach")}
                ${renderVoterChips(byOption[i], ctx)}
                ${renderVoteComments(byOption[i], ctx)}
            </div>
        `;
    }).join("");
    return optionBlocks + renderNonVoters(recipients, voters, ctx);
}

async function renderStormDetails(pollId, poll, recipients, voters, ctx) {
    // Storm answers live in a subcollection. Each doc has text +
    // voterIds (everyone who picked it, which includes the original
    // author). Sort by votes desc, hide merged answers — they
    // collapse into their merge target.
    const answersSnap = await getDocs(collection(db, "polls", pollId, "answers"));
    const answers = answersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => !a.isMerged)
        .sort((a, b) => (b.voterIds?.length || 0) - (a.voterIds?.length || 0));

    // Names for everyone we'll show as a voter on any answer
    const extraUids = new Set();
    answers.forEach(a => (a.voterIds || []).forEach(u => extraUids.add(u)));
    await loadNames([...extraUids]);

    const totalVotes = answers.reduce((sum, a) => sum + (a.voterIds?.length || 0), 0);
    if (answers.length === 0) {
        return `<div style="color:#666; font-size:12px; padding:8px 0;">No write-in answers yet.</div>`
            + renderNonVoters(recipients, voters, ctx);
    }
    const blocks = answers.map(a => {
        const count = a.voterIds?.length || 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const fullText = a.fullText && a.fullText !== a.text
            ? `<div style="color:#999; font-size:12px; margin-top:4px;">${escapeHtml(a.fullText)}</div>`
            : "";
        return `
            <div class="option-result">
                <div class="option-result-header">
                    <span class="option-result-text">${escapeHtml(a.text || "(empty)")}${fullText}</span>
                    <span class="option-result-count">${count} · ${pct}%</span>
                </div>
                <div class="option-result-bar"><div class="option-result-bar-fill" style="width:${pct}%"></div></div>
                ${renderGroupAction(a.voterIds || [], ctx, "teach")}
                ${renderVoterChips(a.voterIds || [], ctx)}
                ${renderVoteComments(a.voterIds || [], ctx)}
            </div>
        `;
    }).join("");
    return blocks + renderNonVoters(recipients, voters, ctx);
}

// Group action button — pre-fills compose with multiple recipients
// at once. Used when the admin wants to coach everyone who voted a
// certain way, or nudge everyone who hasn't voted yet. The button
// applies the matching teach template (if a featureTag is in scope)
// OR a blank prefill otherwise, then sets ALL the given uids as
// recipients and scrolls to compose.
function renderGroupAction(uids, ctx, kind /* "teach" | "nudge" */) {
    if (uids.length < 2) return ""; // single-voter case is already covered by per-chip buttons
    const teach = ctx?.featureTag ? teachTemplates[ctx.featureTag] : null;
    // Labels: prefer the teach phrasing when we have one
    let label;
    if (kind === "nudge") {
        label = `Nudge all ${uids.length}`;
    } else {
        label = teach ? `Teach these ${uids.length}` : `Follow up with ${uids.length}`;
    }
    const cls = kind === "nudge" ? "group-action nudge" : "group-action";
    const tag = teach ? escapeHtml(ctx.featureTag) : "";
    const action = teach && kind !== "nudge" ? "teach" : "custom";
    return `<button class="${cls}" data-uids="${escapeHtml(uids.join(","))}" data-action="${action}" data-tag="${tag}">${label}</button>`;
}

function renderVoterChips(uids, ctx) {
    if (uids.length === 0) return "";
    const teach = ctx?.featureTag ? teachTemplates[ctx.featureTag] : null;
    const followedUp = ctx?.followedUpUids || new Set();
    const chips = uids.map(uid => {
        const name = userNameCache.get(uid) || `${uid.slice(0, 6)}…`;
        // Only UID goes in data-* attributes — name is looked up
        // from the cache inside the click handler. Keeps the HTML
        // attribute free of arbitrary text that could break quoting.
        const check = followedUp.has(uid)
            ? `<span class="voter-check" title="Already followed up with this person">✓</span>`
            : "";
        // Primary button: Teach if we know the feature, else blank
        // Follow-up. When a teach template exists, also offer Custom
        // as an escape hatch for blank-prefill.
        const primary = teach
            ? `<button data-uid="${escapeHtml(uid)}" data-action="teach" data-tag="${escapeHtml(ctx.featureTag)}" class="chip-primary">Teach</button>`
            : `<button data-uid="${escapeHtml(uid)}" data-action="custom" class="chip-primary">Follow up</button>`;
        const custom = teach
            ? `<button data-uid="${escapeHtml(uid)}" data-action="custom" class="chip-secondary">Custom</button>`
            : "";
        return `<span class="voter-chip">${check}${escapeHtml(name)} ${primary}${custom}</span>`;
    }).join("");
    return `<div class="voter-chips">${chips}</div>`;
}

// Vote comments: free-text a voter left alongside their vote. Only
// some voters comment, so this block only renders when at least
// one of the supplied uids has a comment. Each comment carries
// its own Follow up button so the admin can DM that specific
// voter without re-finding their chip.
function renderVoteComments(uids, ctx) {
    const voteComments = ctx?.voteComments || {};
    const withComments = uids.filter(uid => voteComments[uid] && voteComments[uid].trim().length > 0);
    if (withComments.length === 0) return "";
    const lines = withComments.map(uid => {
        const name = userNameCache.get(uid) || `${uid.slice(0, 6)}…`;
        const text = voteComments[uid];
        return `
            <div class="vote-comment">
                <span class="vc-author">${escapeHtml(name)}:</span>${escapeHtml(text)}
                <button class="vc-followup" data-uid="${escapeHtml(uid)}" data-action="custom">Follow up</button>
            </div>
        `;
    }).join("");
    return `<div class="vote-comments">${lines}</div>`;
}

function renderNonVoters(recipients, voters, ctx) {
    const nonVoters = recipients.filter(uid => !(uid in voters));
    if (nonVoters.length === 0) return "";
    return `
        <div class="non-voters">
            <div class="non-voters-title">Hasn't voted yet (${nonVoters.length})</div>
            ${renderGroupAction(nonVoters, ctx, "nudge")}
            ${renderVoterChips(nonVoters, ctx)}
        </div>
    `;
}

// Batch user-doc reads (Firestore `in` caps at 30 values per query)
async function loadNames(uids) {
    const missing = uids.filter(u => u && !userNameCache.has(u));
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += 30) {
        const chunk = missing.slice(i, i + 30);
        try {
            const snap = await getDocs(query(collection(db, "users"), where(documentId(), "in", chunk)));
            snap.forEach(d => {
                const data = d.data();
                const name = data.displayName || data.nickname || `${d.id.slice(0, 6)}…`;
                userNameCache.set(d.id, name);
            });
        } catch (err) {
            console.warn("[ADMIN] couldn't read users — Zak may need to update Firestore rules", err);
        }
        // Anyone still missing — likely deleted users or rule blocks — gets a uid-stub
        chunk.forEach(u => { if (!userNameCache.has(u)) userNameCache.set(u, `${u.slice(0, 6)}…`); });
    }
}

// Pre-fill the compose form with exactly one recipient (blank
// question/options). Used for ad-hoc Custom follow-ups where the
// admin wants to write their own teaching from scratch.
function prefillFollowUp(uid) {
    const name = userNameCache.get(uid) || uid;
    lockRecipientToUid(uid);
    document.getElementById("question").focus();
    document.getElementById("question").scrollIntoView({ behavior: "smooth", block: "start" });
    console.log("[ADMIN] follow-up pre-filled for", name, uid);
}

// One-click teach: pre-fill the matching teach template AND lock
// the recipient to a single voter. The form ends fully populated;
// the admin just clicks Send Now.
function sendTeach(uid, featureTag) {
    const teach = teachTemplates[featureTag];
    if (!teach) {
        console.warn("[ADMIN] no teach template for", featureTag, "— falling back to blank Follow up");
        prefillFollowUp(uid);
        return;
    }
    const name = userNameCache.get(uid) || uid;
    // Strike type — all teach templates are Strikes today
    pollTypeSel.value = "strike";
    applyPollType();
    document.getElementById("question").value = teach.question;
    document.getElementById("time-limit").value = String(teach.timeLimit);
    document.getElementById("open-ballot").checked = teach.openBallot !== false;
    optionsContainer.innerHTML = teach.options.map((opt, i) => `
        <div class="option-row">
            <input type="text" placeholder="Option ${i + 1}" class="option-input" value="${escapeHtml(opt)}" required>
            <button type="button" class="remove-option" title="Remove">×</button>
        </div>
    `).join("");
    lockRecipientToUid(uid);
    document.getElementById("question").scrollIntoView({ behavior: "smooth", block: "start" });
    console.log("[ADMIN] teach", featureTag, "pre-filled for", name, uid);
}

function lockRecipientToUid(uid) {
    recipientsSel.value = "custom";
    customUidsRow.classList.remove("hidden");
    document.getElementById("custom-uids").value = uid;
    updateRecipientsHint();
}

function lockRecipientsToUids(uids) {
    recipientsSel.value = "custom";
    customUidsRow.classList.remove("hidden");
    document.getElementById("custom-uids").value = uids.join(", ");
    updateRecipientsHint();
}

// Group teach: pre-fill the matching teach template AND set
// recipients to a list of voters (e.g. everyone who voted
// "What's that?" on the Pin awareness zzzap). One click,
// ready to send — the admin just hits Send Now.
function sendTeachGroup(uids, featureTag) {
    const teach = teachTemplates[featureTag];
    if (!teach) {
        console.warn("[ADMIN] no teach template for", featureTag, "— falling back to blank group follow-up");
        prefillFollowUpGroup(uids);
        return;
    }
    pollTypeSel.value = "strike";
    applyPollType();
    document.getElementById("question").value = teach.question;
    document.getElementById("time-limit").value = String(teach.timeLimit);
    document.getElementById("open-ballot").checked = teach.openBallot !== false;
    optionsContainer.innerHTML = teach.options.map((opt, i) => `
        <div class="option-row">
            <input type="text" placeholder="Option ${i + 1}" class="option-input" value="${escapeHtml(opt)}" required>
            <button type="button" class="remove-option" title="Remove">×</button>
        </div>
    `).join("");
    lockRecipientsToUids(uids);
    document.getElementById("question").scrollIntoView({ behavior: "smooth", block: "start" });
    console.log("[ADMIN] group teach", featureTag, "pre-filled for", uids.length, "voters");
}

// Group blank follow-up: just set the recipient list, focus the
// question field. Used for nudging non-voters or for blanks
// when no teach template matches.
function prefillFollowUpGroup(uids) {
    lockRecipientsToUids(uids);
    document.getElementById("question").focus();
    document.getElementById("question").scrollIntoView({ behavior: "smooth", block: "start" });
    console.log("[ADMIN] group follow-up pre-filled for", uids.length, "voters");
}

// Resolves the set of UIDs that follow Zzzap Official.
//
// The follow relationship is asymmetric in Firestore: each user's
// own `following` array is the authoritative side (written by the
// "add zzzap_official to all users" script). The brand account's
// `followers` array is a mirror that may or may not be populated
// depending on whether anyone backfilled it. So we query the
// reverse direction — every user doc whose `following` array
// contains zzzap_official — and use the document IDs.
//
// Falls back to reading users/zzzap_official.followers if the
// reverse query fails (e.g. Firestore rules don't allow that
// collection query). Whichever returns a non-empty list wins.
let cachedBrandFollowers = null;
async function fetchBrandFollowers({ force = false } = {}) {
    if (cachedBrandFollowers && !force) return cachedBrandFollowers;
    try {
        const snap = await getDocs(query(
            collection(db, "users"),
            where("following", "array-contains", "zzzap_official")
        ));
        const uids = snap.docs.map(d => d.id);
        if (uids.length > 0) {
            cachedBrandFollowers = uids;
            return cachedBrandFollowers;
        }
    } catch (err) {
        console.warn("[ADMIN] reverse follower query failed, falling back to brand doc.followers", err);
    }
    // Fallback: read the mirrored array on the brand user doc
    const brandSnap = await getDoc(doc(db, "users", "zzzap_official"));
    const data = brandSnap.exists() ? brandSnap.data() : {};
    cachedBrandFollowers = Array.isArray(data.followers) ? data.followers : [];
    return cachedBrandFollowers;
}

// Updates the small hint under the Recipients dropdown so the admin
// can see how many testers a broadcast will actually reach before
// they hit Send.
const recipientsHint = document.getElementById("recipients-hint");
async function updateRecipientsHint() {
    if (recipientsSel.value === "custom") {
        const raw = document.getElementById("custom-uids").value;
        const count = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).length;
        recipientsHint.textContent = count === 0
            ? "Add at least one UID."
            : `Will send to ${count} ${count === 1 ? "tester" : "testers"}.`;
        return;
    }
    // "all" mode — fetch the live count
    recipientsHint.textContent = "Counting followers…";
    try {
        const followers = await fetchBrandFollowers({ force: true });
        if (followers.length === 0) {
            recipientsHint.textContent = "No followers found on Zzzap Official. Switch to Custom UIDs.";
            recipientsHint.style.color = "#ff453a";
        } else {
            recipientsHint.textContent = `Will send to ${followers.length} ${followers.length === 1 ? "tester" : "testers"}.`;
            recipientsHint.style.color = "#34c759";
        }
    } catch (err) {
        recipientsHint.textContent = `Couldn't read follower count: ${err.message}`;
        recipientsHint.style.color = "#ff453a";
    }
}
recipientsSel.addEventListener("change", updateRecipientsHint);
document.getElementById("custom-uids").addEventListener("input", updateRecipientsHint);

function timeAgo(date) {
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

// ───────────────────────────────────────────────────────────────
// Queue (scheduled brand zzzaps)
// ───────────────────────────────────────────────────────────────
const queueList = document.getElementById("queue-list");

function startQueueListener() {
    const q = query(
        collection(db, "polls"),
        where("creatorId", "==", "zzzap_official"),
        where("status", "==", "scheduled"),
        orderBy("scheduledFor", "asc"),
        limit(30)
    );
    queueUnsub = onSnapshot(q,
        (snap) => {
            if (snap.empty) {
                queueList.innerHTML = `<p style="color:#666; font-size:13px;">Queue is empty. Schedule a few coaching zzzaps so the cadence keeps rolling.</p>`;
                return;
            }
            queueList.innerHTML = snap.docs.map(d => renderQueued(d.id, d.data())).join("");
        },
        (err) => {
            queueList.innerHTML = `<p style="color:#ff453a; font-size:13px;">Couldn't load queue: ${err.message}<br><small>(May need a composite index — Firebase will print a link to create it in the browser console on first read.)</small></p>`;
            console.error(err);
        }
    );
}

function renderQueued(id, data) {
    const scheduledFor = data.scheduledFor?.toDate?.() || data.scheduledFor;
    const when = scheduledFor ? formatAbsolute(scheduledFor) : "—";
    const isStorm = (data.pollType || "").toLowerCase() === "storm";
    const typeBadge = isStorm
        ? `<span style="font-size:10px; font-weight:700; color:#000; background:#f5c518; padding:1px 6px; border-radius:6px; letter-spacing:0.5px;">STORM</span>`
        : "";
    return `
        <div class="recent-zzzap" style="border-left: 3px solid #f5c518; padding-left: 13px;">
            <div class="question">${typeBadge} ${escapeHtml(data.question || "(no question)")}</div>
            <div class="meta">
                <span style="color:#f5c518; font-weight:600;">SCHEDULED</span>
                <span>${when}</span>
            </div>
        </div>
    `;
}

// Compact local-time absolute format. Today/yesterday get a label
// instead of the date for quick scanning.
function formatAbsolute(date) {
    const now = new Date();
    const sameDay = now.toDateString() === date.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = yesterday.toDateString() === date.toDateString();
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today at ${time}`;
    if (isYesterday) return `Yesterday at ${time}`;
    const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${dateStr} at ${time}`;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
