// Utility Functions

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    // Double shuffle for "feel"
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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

        const aliveCount = p.cards.filter(c => !c.dead).length;

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
