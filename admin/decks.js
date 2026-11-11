// Personal Surge pitch decks (Stacy 2026-11-11). Each one is hand-built by
// Claude in the zzzap-vote repo at vote.zzzap-app.com/invite/<handle>-<4 random>/
// (noindex, unlisted). The links show up as Open Deck + Share on the Surge tab
// (by @handle for accounts on Surge, and under Prospects).
//
// To add one: build the deck, then add its link here and bump ?v= on this
// file's import in surge.js, and surge.js's ?v= in index.html.

const VOTE = "https://vote.zzzap-app.com";

// Surge accounts, by @handle.
export const DECKS_BY_HANDLE = {
    stacyfromzzzap: `${VOTE}/invite/stacyfromzzzap-ajrv/`,
};

// Prospects (Surge tab → Prospects): each one's hand-built demo page on
// vote.zzzap-app.com, plus their deck once Claude builds it (`deck`).
export const ALL_DEMOS = `${VOTE}/demo/`;
export const PROSPECTS = [
    { name: "Colette Bottiaux", note: "Fitness · Vive Fitness PDX", page: `${VOTE}/demofitness/` },
    { name: "Meurig Morgan", note: "Golf · Dragon Golf, Oregon City", page: `${VOTE}/demogolf/` },
    { name: "Jason Prouty", note: "Artist · Garage31", page: `${VOTE}/demoartist/` },
    { name: "Michael Trupia", note: "Insurance · COUNTRY Financial", page: `${VOTE}/demoinsurance/` },
    { name: "503 Distilling", note: "Distillery · SE Portland", page: `${VOTE}/demo503/` },
    { name: "Throne Barbershop", note: "Barbershop · 3 Portland shops", page: `${VOTE}/demobarber/` },
];

function button(className, text) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = text;
    return b;
}

/// Open Deck + Share for one deck. Share opens the share sheet (Messages,
/// Mail, AirDrop) where the browser has one, otherwise copies the link.
export function deckButtons(name, url) {
    const open = button("btn-secondary", "Open Deck");
    open.addEventListener("click", () => window.open(url, "_blank", "noopener"));

    const share = button("btn-secondary", "Share");
    share.addEventListener("click", async () => {
        if (navigator.share) {
            try { await navigator.share({ title: `Zzzap Surge for ${name}`, url }); } catch (e) { /* closed the sheet */ }
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            share.textContent = "Link Copied";
            setTimeout(() => { share.textContent = "Share"; }, 2000);
        } catch (e) {
            prompt("Copy this link", url);
        }
    });
    return [open, share];
}
