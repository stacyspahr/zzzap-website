// Admin console → Marketing (Stacy 2026-10-19, for Haley and anyone doing
// marketing). Pitch pages, brand files, and wording rules. Everything here is
// static and public (the files live in /assets/brand/ on the public site), so
// never put private information on this tab.
//
// To add a file: drop it in assets/brand/ and add a line to BRAND_GROUPS.

const BRAND = "../assets/brand/";

// Hand-built Surge pitch pages on vote.zzzap-app.com (zzzap-vote repo).
const PITCH_PAGES = [
    { name: "All Surge demos", note: "The list page with every demo", url: "https://vote.zzzap-app.com/demo/" },
    { name: "Colette Bottiaux", note: "Fitness · Vive Fitness PDX", url: "https://vote.zzzap-app.com/demofitness/" },
    { name: "Meurig Morgan", note: "Golf · Dragon Golf, Oregon City", url: "https://vote.zzzap-app.com/demogolf/" },
    { name: "Jason Prouty", note: "Artist · Garage31", url: "https://vote.zzzap-app.com/demoartist/" },
    { name: "Michael Trupia", note: "Insurance · COUNTRY Financial", url: "https://vote.zzzap-app.com/demoinsurance/" },
    { name: "503 Distilling", note: "Distillery · SE Portland", url: "https://vote.zzzap-app.com/demo503/" },
    { name: "Throne Barbershop", note: "Barbershop · 3 Portland shops", url: "https://vote.zzzap-app.com/demobarber/" },
];

// `light` puts a light background behind files that are black on clear.
const BRAND_GROUPS = [
    {
        title: "Logo",
        note: "The double bolt with the word Zzzap. White or Black is the color of the word: use White on dark photos and Black on light ones.",
        files: [
            { label: "White, on clear", file: "logo-white-transparent.png" },
            { label: "White, on black", file: "logo-white-black.png" },
            { label: "White, on white", file: "logo-white-white.png", light: true },
            { label: "Black, on clear", file: "logo-black-transparent.png", light: true },
            { label: "Black, on black", file: "logo-black-black.png" },
            { label: "Black, on white", file: "logo-black-white.png", light: true },
        ],
    },
    {
        title: "Logo with tagline",
        note: "Same logo with “Trusted Sources. Real Decisions.” underneath.",
        files: [
            { label: "White, on clear", file: "logo-white-tagline-transparent.png" },
            { label: "White, on black", file: "logo-white-tagline-black.png" },
            { label: "White, on white", file: "logo-white-tagline-white.png", light: true },
            { label: "Black, on clear", file: "logo-black-tagline-transparent.png", light: true },
            { label: "Black, on black", file: "logo-black-tagline-black.png" },
            { label: "Black, on white", file: "logo-black-tagline-white.png", light: true },
        ],
    },
    {
        title: "Bolt and lockups",
        note: "Vector files (SVG) stay sharp at any size, good for print and signs.",
        files: [
            { label: "Double bolt mark (SVG)", file: "bolt-mark.svg" },
            { label: "Home screen lockup, black lettering (SVG)", file: "home-lockup.svg", light: true },
            { label: "Wordmark", file: "wordmark.png" },
        ],
    },
    {
        title: "App and App Store",
        files: [
            { label: "App icon, 1024 px", file: "app-icon-1024.png" },
            { label: "Download on the App Store badge (SVG)", file: "../marketing/download-on-the-app-store.svg" },
            { label: "Link preview card", file: "../marketing/og-card.png" },
            { label: "App Store header", file: "app-store-header.png" },
            { label: "App Store header, centered", file: "app-store-header-centered.png" },
            { label: "Screenshot: results (iPhone Duo)", file: "screenshot-duo-results.jpg" },
        ],
    },
];

const BASICS = [
    ["Name", "Zzzap: capital Z, three z’s. One question sent in the app is “a zzzap,” all lowercase."],
    ["Tagline", "Trusted Sources. Real Decisions."],
    ["Zzzap types", "Strike: pick an answer. Storm: write your own answer."],
    ["Yellow", "#F5C518 for buttons and highlights. The bolt itself is a yellow to orange gradient, so use the logo files instead of redrawing it."],
    ["Background", "Black. Zzzap is dark only; there’s no light version of the app."],
    ["App Store link", "https://apps.apple.com/app/id6761918562"],
    ["Website", "https://zzzap-app.com"],
];

const WORDING = [
    "Say “Surge,” “Surge account,” or “on Surge.” Never “tier” or “creator.”",
    "A Surge badge reads “Category · Surge,” for example “Golf Instructor · Surge.”",
    "No long dashes (— or –) in posts. They read as written by AI. Use a period or comma.",
    "Use the real bolt files for the logo, never the ⚡ emoji. Emoji colors change by phone and never match our yellow.",
    "Fine to say: Zzzap never tracks people for ads, and brands only ever see totals.",
    "Don’t promise “free forever.”",
];

// Not built yet. Shown dimmed with what each one needs.
const COMING = [
    { title: "Upload files here", detail: "Add photos and files from this page instead of sending them to Stacy.", needs: "Zak: a storage permission for the Marketing role" },
    { title: "Post calendar", detail: "What’s going out, where, and when.", needs: "Decide what to track, then Claude builds it" },
    { title: "Prospect list", detail: "Who we’re pitching for Surge and where each one stands. Splits into Prospects and Clients once the first real one signs on.", needs: "Zak: a place to save it that only the team can read" },
    { title: "Zzzap Official ideas", detail: "Questions to send as Zzzap Official, ready for when the Official sender role exists.", needs: "Zak: the Official sender role" },
];

// ---------- Small helpers (text only, never HTML from data) ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function heading(text) {
    return el("h3", "surge-h3", text);
}

// ---------- Sections ----------
// Each section folds open and closed so the logos don't take over the page.
// Which ones are open is remembered in this browser.

const OPEN_KEY = "marketingOpenSections";
const openSections = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '["pitch"]'));

function section(id, title, summary, content, onFirstOpen) {
    const box = el("details", "mkt-section");
    box.open = openSections.has(id);
    const head = el("summary", "mkt-summary");
    head.append(el("span", "mkt-summary-title", title), el("span", "mkt-summary-count", summary));
    const body = el("div", "mkt-section-body");
    body.append(...content);
    box.append(head, body);
    let started = false;
    const start = () => { if (box.open && !started && onFirstOpen) { started = true; onFirstOpen(); } };
    box.addEventListener("toggle", () => {
        box.open ? openSections.add(id) : openSections.delete(id);
        localStorage.setItem(OPEN_KEY, JSON.stringify([...openSections]));
        start();
    });
    start();
    return box;
}

function pitchPages() {
    const list = el("div", "mkt-links");
    for (const page of PITCH_PAGES) {
        const link = el("a", "mkt-link");
        link.href = page.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.append(el("div", "surge-name", page.name), el("div", "surge-meta", page.note));
        list.append(link);
    }
    return section("pitch", "Surge pitch pages", `${PITCH_PAGES.length} pages`, [list]);
}

function fileGrid(files) {
    const grid = el("div", "mkt-grid");
    for (const item of files) {
        const url = BRAND + item.file;
        const tile = el("div", "mkt-tile");
        const view = el("a", item.light ? "mkt-thumb mkt-thumb-light" : "mkt-thumb");
        view.href = url;
        view.target = "_blank";
        view.rel = "noopener";
        const img = el("img");
        img.src = url;
        img.alt = item.label;
        img.loading = "lazy";
        view.append(img);
        const save = el("a", "mkt-download", "Download");
        save.href = url;
        save.download = item.file.split("/").pop();
        tile.append(view, el("div", "mkt-label", item.label), save);
        grid.append(tile);
    }
    return grid;
}

function brandGroups() {
    return BRAND_GROUPS.map((group, i) => {
        const content = [];
        if (group.note) content.push(el("p", "surge-muted mkt-group-note", group.note));
        content.push(fileGrid(group.files));
        const count = `${group.files.length} ${group.files.length === 1 ? "file" : "files"}`;
        return section(`brand-${i}`, group.title, count, content);
    });
}

// The main site's animated logo, playing live (assets/brand/animated-logo.html
// borrows it from the main page, so it's always the same one). It only loads
// once the section is opened.
function animatedLogo() {
    const url = BRAND + "animated-logo.html";
    const frame = el("iframe", "mkt-anim");
    frame.title = "Zzzap animated logo";
    const open = el("a", "mkt-download", "Open full screen");
    open.href = url;
    open.target = "_blank";
    open.rel = "noopener";
    return section("animated", "Animated logo", "Plays live", [
        el("p", "surge-muted mkt-group-note", "The same one as the top of zzzap-app.com. The lightning strikes again every several seconds. To make a video, open it full screen and screen record."),
        frame,
        open,
    ], () => { frame.src = url; });
}

function basics() {
    const list = el("div", "mkt-basics");
    for (const [label, text] of BASICS) {
        const row = el("div", "mkt-basic");
        row.append(el("div", "mkt-basic-label", label), el("div", "mkt-basic-text", text));
        list.append(row);
    }
    return section("basics", "Brand basics", "Name, tagline, colors, links", [list]);
}

function wording() {
    const list = el("ul", "mkt-rules");
    WORDING.forEach(rule => list.append(el("li", "", rule)));
    return section("wording", "Wording rules", `${WORDING.length} rules`, [list]);
}

function comingSoon() {
    const grid = el("div", "stats-grid");
    for (const item of COMING) {
        const box = el("div", "stat-box stat-sample");
        const head = el("div", "stat-head");
        head.append(el("div", "stat-title", item.title), el("span", "stat-tag", "Coming"));
        box.append(head, el("div", "stat-detail mkt-coming-detail", item.detail), el("div", "stat-needs", `Needs: ${item.needs}`));
        grid.append(box);
    }
    return section("coming", "Coming later", `${COMING.length} ideas`, [grid]);
}

document.getElementById("marketing-card").replaceChildren(
    el("p", "surge-muted mkt-public-note", "Everything on this tab is public. Anyone who finds a file’s link can open it, so keep private information off it."),
    heading("Pitching"),
    pitchPages(),
    heading("Brand files"),
    animatedLogo(),
    ...brandGroups(),
    heading("Guidelines"),
    basics(),
    wording(),
    heading("Later"),
    comingSoon(),
);
