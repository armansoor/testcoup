// Utility Functions

/**
 * Generates a cryptographically secure random integer between 0 (inclusive) and max (exclusive).
 * Falls back to Math.random() if window.crypto is unavailable.
 */
function getSecureRandomIndex(max) {
    const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' && crypto);
    if (cryptoObj && cryptoObj.getRandomValues) {
        const arr = new Uint32Array(1);
        const maxUint32 = 0xffffffff;
        const range = Math.floor(maxUint32 / max) * max;
        do {
            cryptoObj.getRandomValues(arr);
        } while (arr[0] >= range);
        return arr[0] % max;
    }
    // Fallback for non-browser or old browser environments
    return Math.floor(Math.random() * max);
}

/**
 * Generates a cryptographically secure random float between 0 (inclusive) and 1 (exclusive).
 * Falls back to Math.random() if window.crypto is unavailable.
 */
function getSecureRandom() {
    const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' && crypto);
    if (cryptoObj && cryptoObj.getRandomValues) {
        const arr = new Uint32Array(1);
        cryptoObj.getRandomValues(arr);
        return arr[0] / 0x100000000;
    }
    return Math.random();
}

/**
 * Generates a cryptographically secure random hexadecimal string (e.g. for request IDs).
 */
function generateSecureId() {
    const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' && crypto);
    if (cryptoObj && cryptoObj.getRandomValues) {
        const array = new Uint8Array(16);
        cryptoObj.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    // Fallback
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = getSecureRandomIndex(i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCurrentPlayer() {
    return gameState.players[gameState.currentPlayerIndex];
}

function sanitize(str) {
    if (!str) return '';
    return str.replace(/[&<>"'/]/g, function (s) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        }[s];
    });
}

function getStrongestOpponent(player) {
    let target = null;
    let maxCards = -1;
    let maxCoins = -1;

    gameState.players.forEach(p => {
        if (p.id === player.id || !p.alive) return;

        const aliveCount = p.cards.filter(c => c && !c.dead).length;

        // Priority 1: Most Cards
        if (aliveCount > maxCards) {
            maxCards = aliveCount;
            maxCoins = p.coins;
            target = p;
        }
        // Priority 2: Most Coins (Tie-breaker)
        else if (aliveCount === maxCards) {
            if (p.coins > maxCoins) {
                maxCoins = p.coins;
                target = p;
            }
        }
    });

    return target;
}
