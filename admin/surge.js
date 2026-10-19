// Admin console → Surge (v1.2, Stacy 2026-10-19).
// Who's on Surge, invite someone (search + category), and the category list.
//
// Reading works today. Changes go through two admin-only server functions
// (Zak's half, BACKLOG → Surge server list → "Inviting people to Surge"):
//   setSurgeAccount({ uid, on, categoryId })  sets isSurge, categoryId and the
//                                              surge feature override
//   addSurgeCategory({ name })                 adds to config/surgeCategories
// Until they're deployed, the buttons say so instead of failing quietly.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
    getFirestore, collection, query, where, limit, getDocs, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

const els = {
    members: document.getElementById("surge-members"),
    search: document.getElementById("surge-search"),
    results: document.getElementById("surge-results"),
    categories: document.getElementById("surge-categories"),
    newCategory: document.getElementById("surge-new-category"),
    addCategory: document.getElementById("surge-add-category"),
    status: document.getElementById("surge-status"),
};

let categoryNames = {};   // id -> name
let unsubCategories = null;

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

function categorySelect(selected) {
    const select = el("select", "surge-category-select");
    const ids = Object.keys(categoryNames).sort((a, b) => categoryNames[a].localeCompare(categoryNames[b]));
    if (!ids.length) {
        select.append(new Option("Add a category first", ""));
        select.disabled = true;
    }
    for (const id of ids) select.append(new Option(categoryNames[id], id, false, id === selected));
    return select;
}

/// What a Surge page still needs, the same four steps as the app's checklist.
function setupSummary(u) {
    const steps = [
        ["handle", !!u.handle],
        ["photo", !!u.photoURL || !!u.headerPhotoURL],
        ["bio or links", !!u.bio || (u.socialLinks && Object.keys(u.socialLinks).length > 0)],
        ["first Public zzzap", !!u.surgeSentPublic],
    ];
    const done = steps.filter(([, ok]) => ok).length;
    if (done === steps.length) return "Page set up";
    const missing = steps.filter(([, ok]) => !ok).map(([name]) => name).join(", ");
    return `${done} of 4 set up · needs ${missing}`;
}

async function setSurge(uid, on, categoryId) {
    const call = httpsCallable(functions, "setSurgeAccount");
    try {
        await call({ uid, on, categoryId: categoryId || null });
        setStatus(on ? "Done. They'll get the Surge welcome next time they open Zzzap." : "Turned off.", "success");
        await loadMembers();
    } catch (err) {
        setStatus(serverNotReady(err)
            ? "This button works once Zak's server piece is in. Until then, ask Claude to do it."
            : `Couldn't save: ${err.message}`, "error");
    }
}

// ---------- On Surge ----------

async function loadMembers() {
    els.members.replaceChildren(el("p", "surge-muted", "Loading…"));
    // The user list rule only allows discoverable accounts, so a hidden
    // account on Surge won't show here (the Firebase console still has it).
    const snap = await getDocs(query(
        collection(db, "users"),
        where("discoverable", "==", true),
        where("isSurge", "==", true),
        limit(200)
    ));
    if (snap.empty) {
        els.members.replaceChildren(el("p", "surge-muted", "Nobody yet."));
        return;
    }
    const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
    els.members.replaceChildren(...rows.map(memberRow));
}

function memberRow(u) {
    const row = el("div", "surge-row");
    const info = el("div", "surge-info");
    // With a handle, the name opens their page (vote.zzzap-app.com/@handle) in a new tab.
    if (u.handle) {
        const link = el("a", "surge-name surge-name-link", u.displayName || "Unnamed");
        link.href = `https://vote.zzzap-app.com/@${encodeURIComponent(u.handle)}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.title = "Open their page in a new tab";
        info.append(link);
    } else {
        info.append(el("div", "surge-name", u.displayName || "Unnamed"));
    }
    const handle = u.handle ? `@${u.handle}` : "No handle yet";
    const category = categoryNames[u.categoryId] || "No category";
    info.append(el("div", "surge-meta", `${handle} · ${category} · ${setupSummary(u)}`));
    row.append(info);

    const actions = el("div", "surge-actions");
    const select = categorySelect(u.categoryId);
    const save = el("button", "btn-secondary", "Change");
    save.type = "button";
    save.addEventListener("click", () => setSurge(u.id, true, select.value));
    const off = el("button", "btn-danger", "Turn Off");
    off.type = "button";
    off.addEventListener("click", () => {
        if (confirm(`Turn off Surge for ${u.displayName || "this account"}? Their handle stays reserved.`)) {
            setSurge(u.id, false, null);
        }
    });
    actions.append(select, save, off);
    row.append(actions);
    return row;
}

// ---------- Invite ----------

let searchTimer = null;
els.search.addEventListener("input", () => {
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
        limit(10)
    ));
    if (snap.empty) {
        els.results.replaceChildren(el("p", "surge-muted", "No match. They need a Zzzap account that can be found in search."));
        return;
    }
    els.results.replaceChildren(...snap.docs.map(d => inviteRow({ id: d.id, ...d.data() })));
}

function inviteRow(u) {
    const row = el("div", "surge-row");
    const info = el("div", "surge-info");
    info.append(el("div", "surge-name", u.displayName || "Unnamed"));
    info.append(el("div", "surge-meta", u.isSurge ? "Already on Surge" : (u.realName || "")));
    row.append(info);
    if (!u.isSurge) {
        const actions = el("div", "surge-actions");
        const select = categorySelect("");
        const invite = el("button", "btn-primary", "Invite to Surge");
        invite.type = "button";
        invite.addEventListener("click", () => {
            if (!select.value) { setStatus("Pick a category first.", "error"); return; }
            setSurge(u.id, true, select.value);
        });
        actions.append(select, invite);
        row.append(actions);
    }
    return row;
}

// ---------- Categories ----------

function renderCategories() {
    const ids = Object.keys(categoryNames).sort((a, b) => categoryNames[a].localeCompare(categoryNames[b]));
    els.categories.replaceChildren(
        ...(ids.length ? ids.map(id => el("span", "surge-chip", categoryNames[id])) : [el("p", "surge-muted", "None yet.")])
    );
}

els.addCategory.addEventListener("click", async () => {
    const name = els.newCategory.value.trim();
    if (!name) return;
    const call = httpsCallable(functions, "addSurgeCategory");
    try {
        await call({ name });
        els.newCategory.value = "";
        setStatus(`Added ${name}.`, "success");
    } catch (err) {
        setStatus(serverNotReady(err)
            ? "Adding categories works once Zak's server piece is in. Until then, ask Claude."
            : `Couldn't add: ${err.message}`, "error");
    }
});

// ---------- Start once signed in ----------

onAuthStateChanged(auth, user => {
    if (unsubCategories) { unsubCategories(); unsubCategories = null; }
    if (!user) return;
    unsubCategories = onSnapshot(doc(db, "config", "surgeCategories"), snap => {
        categoryNames = (snap.data() || {}).names || {};
        renderCategories();
        loadMembers().catch(err => setStatus(`Couldn't load Surge accounts: ${err.message}`, "error"));
    });
});
