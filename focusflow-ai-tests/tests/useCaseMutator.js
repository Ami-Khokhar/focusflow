/**
 * useCaseMutator.js - Lightweight text mutations for broader scenario coverage.
 * Mutations keep intent intact while varying phrasing/noise.
 */

function normalizeSpaces(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function makeRng(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0xffffffff;
    };
}

function applyReplacements(message) {
    const replacements = [
        [/\bminutes\b/gi, 'mins'],
        [/\bminute\b/gi, 'min'],
        [/\bplease\b/gi, 'pls'],
        [/\bremind me\b/gi, 'can you remind me'],
        [/\bactually\b/gi, 'actually yeah'],
        [/\bwhat do you remember\b/gi, 'what all do you remember'],
    ];

    let result = message;
    for (const [pattern, next] of replacements) {
        if (pattern.test(result)) {
            result = result.replace(pattern, next);
            break;
        }
    }
    return normalizeSpaces(result);
}

export function generateFuzzVariants(message, { seed = 7, maxVariants = 3 } = {}) {
    const base = normalizeSpaces(message || '');
    if (!base) return [];

    const rng = makeRng(seed);
    const rawCandidates = [
        `hey, ${base}`,
        `${base} please`,
        `${base}?`,
        `uh ${base}`,
        `${base} rn`,
        applyReplacements(base),
        `quick one: ${base}`,
        `${base} ...`,
        base.toLowerCase(),
    ];

    // Deterministic shuffle based on seed.
    for (let i = rawCandidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = rawCandidates[i];
        rawCandidates[i] = rawCandidates[j];
        rawCandidates[j] = tmp;
    }

    const deduped = [];
    const seen = new Set([base.toLowerCase()]);
    for (const c of rawCandidates) {
        const msg = normalizeSpaces(c);
        const key = msg.toLowerCase();
        if (!msg || seen.has(key)) continue;
        seen.add(key);
        deduped.push(msg);
        if (deduped.length >= maxVariants) break;
    }

    return deduped.map((mutated, idx) => ({
        id: `fuzz_${idx + 1}`,
        message: mutated,
    }));
}