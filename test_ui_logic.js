
const gameState = {
    players: [],
    currentPlayerIndex: 0
};

function setup(humanCount, aiCount) {
    gameState.players = [];
    for(let i=1; i<=humanCount; i++) gameState.players.push({id: i, name: `P${i}`, isAI: false});
    for(let i=1; i<=aiCount; i++) gameState.players.push({id: humanCount+i, name: `B${i}`, isAI: true});
}

function testUpdateUI(description) {
    const p = gameState.players[gameState.currentPlayerIndex];
    const humans = gameState.players.filter(pl => !pl.isAI);
    const isSinglePlayer = humans.length === 1;

    let viewPlayer = p;
    if (isSinglePlayer) {
        viewPlayer = humans[0];
    }

    console.log(`--- ${description} ---`);
    console.log(`Current Turn: ${p.name} (${p.isAI?'AI':'Human'})`);
    console.log(`View Player: ${viewPlayer.name}`);

    // Opponents check
    const opponents = gameState.players.filter(pl => pl.id !== viewPlayer.id).map(pl => pl.name);
    console.log(`Opponents shown: ${opponents.join(', ')}`);
}

// Test 1: Single Player (1 Human, 1 Bot), Human Turn
setup(1, 1);
gameState.currentPlayerIndex = 0; // P1
testUpdateUI("Single Player - Human Turn");

// Test 2: Single Player, Bot Turn
gameState.currentPlayerIndex = 1; // B1
testUpdateUI("Single Player - Bot Turn");

// Test 3: Pass & Play (2 Humans), P1 Turn
setup(2, 0);
gameState.currentPlayerIndex = 0;
testUpdateUI("P&P - P1 Turn");

// Test 4: Pass & Play, P2 Turn
gameState.currentPlayerIndex = 1;
testUpdateUI("P&P - P2 Turn");
