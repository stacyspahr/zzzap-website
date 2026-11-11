// Personal Surge pitch decks (Stacy 2026-11-11). Each one is hand-built by
// Claude in the zzzap-vote repo at vote.zzzap-app.com/invite/<handle>-<4 random>/
// (noindex, unlisted). The links show up as Open Deck + Share on the Surge tab
// (by @handle) and on Marketing → Surge pitch pages (by demo page).
//
// To add one: build the deck, then add its link here and bump ?v= on this
// file's imports in surge.js and marketing.js, and on those two in index.html.

const VOTE = "https://vote.zzzap-app.com";

// Surge accounts, by @handle.
export const DECKS_BY_HANDLE = {
    stacyfromzzzap: `${VOTE}/invite/stacyfromzzzap-ajrv/`,
};

// Prospects, by their demo page URL (same as PITCH_PAGES in marketing.js).
export const DECKS_BY_PAGE = {
};

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
