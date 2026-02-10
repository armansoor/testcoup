function getCurrentPlayer() { return gameState.players[gameState.currentPlayerIndex]; }

function getStrongestOpponent(me) {
    // Target player with most coins or most cards
    const foes = gameState.players.filter(p => p.id !== me.id && p.alive);
    return foes.sort((a,b) => b.coins - a.coins)[0];
}

function shuffle(array) {
    // Shuffle 7 times for maximum randomness
    for (let k = 0; k < 7; k++) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
