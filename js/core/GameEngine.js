// Core Game Loop and Turn Management

function startGame() {
    const humanCount = parseInt(document.getElementById('human-count').value);
    const aiCount = parseInt(document.getElementById('ai-count').value);
    const difficulty = document.getElementById('difficulty').value;

    // Ensure we are in Local mode
    isNetworkGame = false;
    netState.isHost = false;
    netState.peer = null;

    if (humanCount + aiCount < 2) {
        alert("Minimum 2 players required!");
        return;
    }
    if (humanCount + aiCount > 6) {
        alert("Maximum 6 players allowed!");
        return;
    }

    gameState.players = [];
    gameState.deck = [];
    gameState.log = ['Welcome to Coup.'];
    gameState.replayData = [];

    // Create Deck (3 of each)
    let cardIdCounter = 1;
    ROLES.forEach(role => {
        for(let i=0; i<3; i++) {
            gameState.deck.push({
                id: `card_${cardIdCounter++}`,
                role: role,
                dead: false
            });
        }
    });
    shuffle(gameState.deck);

    // Create Humans
    for(let i=1; i<=humanCount; i++) {
        gameState.players.push(new Player(i, `Player ${i}`, false));
    }
    // Local Player is always Player 1 for stats/UI purposes in Single/Local modes
    window.myPlayerId = 1;

    // Create AI
    for(let i=1; i<=aiCount; i++) {
        gameState.players.push(new Player(humanCount + i, `Bot ${i}`, true, difficulty));
    }

    // Deal Cards
    gameState.players.forEach(p => {
        p.cards = [gameState.deck.pop(), gameState.deck.pop()];
    });

    gameState.currentPlayerIndex = 0;

    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    updateUI();
    playTurn();
}

function playTurn() {
    const p = getCurrentPlayer();
    if (!p.alive) { nextTurn(); return; }

    log(`--- ${p.name}'s Turn ---`);
    updateUI();
    broadcastState();

    if (p.isAI) {
        p.decideAction();
    } else if (p.isRemote) {
        // Remote player turn: Wait for network message
        setControls(false);
    } else {
        // Local Human (Host or Offline Pass & Play)
        // If network game, only unlock if it is MY turn
        if (isNetworkGame) {
            if (p.id === myPlayerId) setControls(true);
            else setControls(false);
        } else {
            setControls(true);
        }
    }
}

function nextTurn() {
    // Check Winner
    const alive = gameState.players.filter(p => p.alive);
    if (alive.length === 1) {
        const winner = alive[0];
        log(`${winner.name} WINS THE GAME!`, 'important');

        // Check Achievements
        checkGameEndAchievements(winner);

        // Capture Final State for Replay (Local & Network)
        broadcastState();

        if (isNetworkGame && netState.isHost) {
            // Broadcast Game Over explicitly
            broadcast({
                type: 'GAME_OVER',
                winnerName: winner.name,
                isAI: winner.isAI
            });
        }

        setupGameOverUI(winner.name, winner.isAI);

        saveMatchHistory(winner);
        return;
    }

    do {
        gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    } while (!gameState.players[gameState.currentPlayerIndex].alive);

    // Pass & Play Privacy Check
    const nextPlayer = getCurrentPlayer();
    const humanPlayers = gameState.players.filter(p => !p.isAI);

    // If it's a local multiplayer game (more than 1 human, no network)
    // AND the next player is human
    // AND the previous player was also human (or we just want to hide between turns regardless)
    if (!isNetworkGame && humanPlayers.length > 1 && !nextPlayer.isAI) {
        // Show Privacy Screen instead of playing directly
        // We delay slightly to let animations finish
        setTimeout(() => showPassDeviceScreen(nextPlayer), 1000);
    } else {
        setTimeout(playTurn, 1000);
    }
}

// --- INTERACTION LOGIC (Requests & Handling) ---

function requestChallenge(player, actionObj) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'CHALLENGE', {
            playerId: player.id,
            actionPlayerId: actionObj.player.id,
            actionType: actionObj.type,
            role: actionObj.role
        });
    } else {
        return askHumanChallenge(player, actionObj);
    }
}

function requestBlock(player, actionObj) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'BLOCK', {
            playerId: player.id,
            actionPlayerId: actionObj.player.id,
            actionType: actionObj.type,
            role: actionObj.role,
            targetId: actionObj.target ? actionObj.target.id : null
        });
    } else {
        return askHumanBlock(player, actionObj);
    }
}

function requestLoseCard(player) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'LOSE_CARD', {
            playerId: player.id
        });
    } else {
        return askHumanToLoseCard(player);
    }
}

function requestExchange(player, cardsToChoose, keepCount) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'EXCHANGE', {
            playerId: player.id,
            cards: cardsToChoose,
            keepCount: keepCount
        });
    } else {
        return askHumanExchange(player, cardsToChoose, keepCount);
    }
}

async function handleInteractionRequest(data) {
    // data = { reqId, requestType, args }
    const p = gameState.players.find(pl => pl.id === data.args.playerId);
    // Safety check if p is me? usually p is me if I received this.
    // However, args.playerId is just for context or UI.

    let response = null;

    switch(data.requestType) {
        case 'CHALLENGE': {
            const actor = gameState.players.find(pl => pl.id === data.args.actionPlayerId);
            const actionObj = {
                type: data.args.actionType,
                player: actor,
                role: data.args.role
            };
            response = await askHumanChallenge(p, actionObj);
            break;
        }
        case 'BLOCK': {
            const actorB = gameState.players.find(pl => pl.id === data.args.actionPlayerId);
            const actionObjB = {
                type: data.args.actionType,
                player: actorB,
                role: data.args.role,
                target: data.args.targetId ? gameState.players.find(pl => pl.id === data.args.targetId) : null
            };
            response = await askHumanBlock(p, actionObjB);
            break;
        }
        case 'LOSE_CARD':
            response = await askHumanToLoseCard(p);
            break;

        case 'EXCHANGE':
            response = await askHumanExchange(p, data.args.cards, data.args.keepCount);
            break;
    }

    if (netState.hostConn && netState.hostConn.open) {
        netState.hostConn.send({
            type: 'INTERACTION_RESPONSE',
            reqId: data.reqId,
            response: response
        });
    }
}
