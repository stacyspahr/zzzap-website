// The Zzzap voice (voice.json), shown to people on the admin site. The same
// file is what Say It Like Zzzap gives the AI, so there's only one copy.
// When the app adds, renames, or drops a term, update voice.json with it.

let cached = null;

export async function loadVoice() {
    if (!cached) {
        cached = fetch("voice.json", { cache: "no-cache" }).then(r => {
            if (!r.ok) throw new Error(`voice.json ${r.status}`);
            return r.json();
        });
    }
    return cached;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/// The whole guide: personality, rules, words to use, and examples.
export function renderVoice(voice) {
    const parts = [];

    parts.push(el("h4", "voice-h", "Personality"));
    const traits = el("ul", "mkt-rules");
    for (const t of voice.personality) {
        const li = el("li");
        li.append(el("strong", "", `${t.trait}. `), document.createTextNode(t.detail));
        traits.append(li);
    }
    parts.push(traits);

    parts.push(el("h4", "voice-h", "Rules"));
    const rules = el("ul", "mkt-rules");
    voice.rules.forEach(r => rules.append(el("li", "", r)));
    parts.push(rules);

    parts.push(el("h4", "voice-h", "Our words"));
    const terms = el("div", "mkt-basics");
    for (const t of voice.terms) {
        const row = el("div", "mkt-basic voice-term");
        const text = el("div", "mkt-basic-text", t.means);
        if (t.avoid.length) text.append(el("div", "voice-avoid", `Not: ${t.avoid.join(", ")}`));
        row.append(el("div", "voice-say", t.say), text);
        terms.append(row);
    }
    parts.push(terms);

    parts.push(el("h4", "voice-h", "Examples"));
    for (const ex of voice.examples) {
        const box = el("div", "voice-example");
        box.append(el("div", "voice-plain", `Plain: ${ex.plain}`));
        const z = ex.zzzap;
        box.append(el("div", "voice-zzzap", `Zzzap: ${z.title}. ${z.body}${z.button ? ` [${z.button}]` : ""}`));
        box.append(el("div", "surge-muted voice-why", ex.why));
        parts.push(box);
    }

    parts.push(el("p", "surge-muted voice-updated", `Last updated ${voice.updated}.`));
    return parts;
}
