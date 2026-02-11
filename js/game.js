// --- SETUP FUNCTIONS ---

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
    gameState.log = [];
    gameState.replayData = [];

    // Safety: Reset connection handlers for in-game
    // (Optional: remove lobby-specific listeners if needed)

    // Create Deck (3 of each)
    ROLES.forEach(role => {
        for(let i=0; i<3; i++) gameState.deck.push({ role: role, dead: false });
    });
    shuffle(gameState.deck);

    // Create Humans
    for(let i=1; i<=humanCount; i++) {
        gameState.players.push(new Player(i, `Player ${i}`, false));
    }

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

// --- GAME LOOP ---

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

function submitAction(actionType) {
    const p = getCurrentPlayer();

    // FORCED COUP CHECK
    if (p.coins >= 10 && actionType !== 'Coup') {
        alert("You have 10+ coins. You MUST Coup!");
        return;
    }

    // NETWORK CLIENT LOGIC
    if (isNetworkGame && !netState.isHost) {
        if (p.id !== myPlayerId) return; // Not my turn
        if (ACTIONS[actionType].cost > p.coins) { alert("Not enough coins!"); return; }
        if (actionType === 'Coup' && p.coins < 7) return;

        let targetId = null;
        if (['Coup', 'Assassinate', 'Steal'].includes(actionType)) {
             const targets = gameState.players.filter(pl => pl.id !== p.id && pl.alive);
             if (targets.length === 1) targetId = targets[0].id;
             else {
                 let tName = prompt(`Target for ${actionType}? (${targets.map(t=>t.name).join(', ')})`);
                 const t = targets.find(t => t.name.toLowerCase() === (tName || "").toLowerCase());
                 targetId = t ? t.id : targets[0].id;
             }
        }

        netState.hostConn.send({
            type: 'ACTION',
            action: actionType,
            targetId: targetId
        });
        return;
    }

    // Validation
    if (ACTIONS[actionType].cost > p.coins) {
        alert("Not enough coins!");
        return;
    }
    if (actionType === 'Coup' && p.coins < 7) return;

    // Targeting
    let target = null;
    if (['Coup', 'Assassinate', 'Steal'].includes(actionType)) {
        // For human, we need a simple prompt for now (simulating UI selection)
        // In a pro version, we'd click the avatar. Here we ask name.
        const targets = gameState.players.filter(pl => pl.id !== p.id && pl.alive);
        if (targets.length === 0) return; // Should not happen

        // Simple logic: if only 1 enemy, auto select. Else prompt.
        if (targets.length === 1) target = targets[0];
        else {
            // For Pass & Play, we use a crude prompt for simplicity in this code block
            // Ideally this would be a modal.
            let tName = prompt(`Target for ${actionType}? (${targets.map(t=>t.name).join(', ')})`);
            target = targets.find(t => t.name.toLowerCase() === (tName || "").toLowerCase());
            if (!target) target = targets[0]; // Default fallback
        }
    }

    handleActionSubmit(actionType, p, target);
}

function handleActionSubmit(actionType, player, target = null) {
    setControls(false); // Lock UI
    gameState.currentAction = { type: actionType, player: player, target: target, challenge: null, block: null };

    // Track history for AI analysis
    player.lastAction = actionType;

    log(`${player.name} attempts to ${actionType}${target ? ' on ' + target.name : ''}.`);

    // DEDUCT COSTS IMMEDIATELY
    player.coins -= ACTIONS[actionType].cost;
    updateUI();
    broadcastState();

    // PHASE: Allow Responses (Challenge/Block)
    // We simulate a "wait" period where AI checks triggers, or Human buttons appear
    processReactions();
}

async function processReactions() {
    const action = gameState.currentAction;
    const actingP = action.player;

    // 1. Check for Challenges (if action is challengeable)
    if (ACTIONS[action.type].challengeable) {
        // Ask all other players
        for (let p of gameState.players) {
            if (p.id === actingP.id || !p.alive) continue;

            let wantsChallenge = false;
            if (p.isAI) {
                wantsChallenge = p.shouldChallenge(action);
            } else {
                wantsChallenge = await requestChallenge(p, action);
            }

            if (wantsChallenge) {
                log(`${p.name} CHALLENGES ${actingP.name}!`, 'important');
                const won = await resolveChallenge(actingP, p, ACTIONS[action.type].role);
                if (won) {
                     await resolveActionEffect();
                } else {
                     nextTurn();
                }
                return; // End action flow here based on outcome
            }
        }
    }

    // 2. Check for Blocks (if action is blockable)
    if (ACTIONS[action.type].blockable) {
        // Usually only the target can block, except Foreign Aid (anyone)
        const potentialBlockers = (action.type === 'Foreign Aid')
            ? gameState.players.filter(pl => pl.id !== actingP.id && pl.alive)
            : (action.target ? [action.target] : []);

        for (let p of potentialBlockers) {
            let wantsBlock = false;
            if (p.isAI) wantsBlock = p.shouldBlock(action);
            else wantsBlock = await requestBlock(p, action);

            if (wantsBlock) {
                const blockerRole = ACTIONS[action.type].blockedBy[0]; // Simplification
                log(`${p.name} BLOCKS with ${blockerRole}!`);

                // Block can be challenged!
                const challengeAction = { type: 'Block', player: p, role: blockerRole };
                for (let challenger of gameState.players) {
                    if (challenger.id === p.id || !challenger.alive) continue;

                    let wantsChallenge = false;
                    if (challenger.isAI) {
                        wantsChallenge = challenger.shouldChallenge(challengeAction);
                    } else {
                        wantsChallenge = await requestChallenge(challenger, challengeAction);
                    }

                    if (wantsChallenge) {
                        log(`${challenger.name} CHALLENGES Block!`, 'important');
                        const won = await resolveChallenge(p, challenger, blockerRole);
                        if (!won) {
                            // Block failed, action proceeds
                            await resolveActionEffect();
                        } else {
                            // Block succeeded
                            log(`Action BLOCKED.`);
                            broadcastState();
                            nextTurn();
                        }
                        return;
                    }
                }

                log(`Action BLOCKED.`);
                broadcastState();
                nextTurn();
                return;
            }
        }
    }

    // 3. If no Challenge/Block, Resolve Action
    await resolveActionEffect();
}

async function resolveChallenge(claimedPlayer, challenger, claimedRole) {
    // Reveal logic
    const hasCard = claimedPlayer.cards.some(c => c.role === claimedRole && !c.dead);

    if (hasCard) {
        log(`Challenge FAILED! ${claimedPlayer.name} HAS the ${claimedRole}!`, 'important');
        broadcastState();
        await sleep(1500);
        // Challenger loses card
        await loseInfluence(challenger);

        // Claimed player swaps card
        const cardIdx = claimedPlayer.cards.findIndex(c => c.role === claimedRole && !c.dead);
        const oldCard = claimedPlayer.cards[cardIdx];

        // Return old card to deck FIRST
        gameState.deck.push(oldCard);

        // Shuffle
        shuffle(gameState.deck);

        // Draw NEW card
        claimedPlayer.cards[cardIdx] = gameState.deck.pop();

        broadcastState();

        return true; // Challenge lost (Blocker won)
    } else {
        log(`${claimedPlayer.name} was BLUFFING! Action fails.`, 'important');

        // REFUND RULE: If Assassin is challenged and loses, they get coins back.
        // We must check if the challenge was on the Action (Actor is claimedPlayer)
        // and if the action was Assassinate.
        if (gameState.currentAction &&
            gameState.currentAction.player.id === claimedPlayer.id &&
            gameState.currentAction.type === 'Assassinate') {
                log("Assassin refunded 3 coins.");
                claimedPlayer.coins += 3;
        }

        broadcastState();
        await sleep(1500);
        await loseInfluence(claimedPlayer);
        return false; // Challenge won (Blocker lost)
    }
}

async function loseInfluence(player) {
    // Safety: If player is already dead, they can't lose influence
    if (!player.alive || player.cards.every(c => c.dead)) return;

    if (player.isAI) {
        // AI logic: lose card revealed or random
        const aliveCards = player.cards.filter(c => !c.dead);
        if (aliveCards.length === 0) return; // Should be covered by above, but safe
        const toKill = aliveCards[Math.floor(Math.random() * aliveCards.length)];
        // Find actual index
        const idx = player.cards.indexOf(toKill);
        await player.loseCard(idx);
    } else {
        const idx = await requestLoseCard(player);
        await player.loseCard(idx);
    }

    if (!player.alive) {
        await askContinue(`${player.name} has been eliminated.`);
    }
}

async function resolveActionEffect() {
    const act = gameState.currentAction;
    const p = act.player;
    const t = act.target;

    switch(act.type) {
        case 'Income': p.coins++; break;
        case 'Foreign Aid': p.coins+=2; break;
        case 'Tax': p.coins+=3; break;
        case 'Steal':
            if (!t) { log('Action failed: No target.'); break; }
            const stolen = Math.min(t.coins, 2);
            t.coins -= stolen;
            p.coins += stolen;
            log(`Stole ${stolen} from ${t.name}`);
            break;
        case 'Assassinate':
            if (!t) { log('Action failed: No target.'); break; }
            log(`${t.name} was Assassinated!`);
            await sleep(1500);
            await loseInfluence(t);
            break;
        case 'Coup':
            if (!t) { log('Action failed: No target.'); break; }
            log(`${t.name} suffered a Coup!`);
            await sleep(1500);
            await loseInfluence(t);
            break;
        case 'Exchange':
            p.cards.push(gameState.deck.pop(), gameState.deck.pop());
            log(`${p.name} exchanges cards...`);
            broadcastState(); // Sync cards so client has 4

            if(p.isAI) {
                // Simplicity: AI keeps random, but only ALIVE cards
                const alive = p.cards.filter(c => !c.dead);
                const dead = p.cards.filter(c => c.dead);

                shuffle(alive);

                // Return 2 cards to deck (we drew 2)
                gameState.deck.push(alive.pop());
                gameState.deck.push(alive.pop());
                shuffle(gameState.deck);

                p.cards = [...alive, ...dead];
            } else {
                const keptIndices = await requestExchange(p);

                // Deck Logic (Moved from askHumanExchange)
                // Reconstruct logic based on indices
                // Note: askHumanExchange must return indices relative to ALIVE cards array
                const alive = [];
                const dead = [];
                p.cards.forEach(c => {
                    if (c.dead) dead.push(c);
                    else alive.push(c);
                });

                const kept = alive.filter((_, i) => keptIndices.includes(i));
                const returned = alive.filter((_, i) => !keptIndices.includes(i));

                returned.forEach(c => gameState.deck.push(c));
                shuffle(gameState.deck);

                p.cards = [...kept, ...dead];
            }
            break;
    }
    broadcastState();
    nextTurn();
}

function nextTurn() {
    // Check Winner
    const alive = gameState.players.filter(p => p.alive);
    if (alive.length === 1) {
        const winner = alive[0];
        log(`${winner.name} WINS THE GAME!`, 'important');

        // Check Achievements
        checkGameEndAchievements(winner);

        if (isNetworkGame && netState.isHost) {
            broadcastState(); // Final state
            // Broadcast Game Over explicitly
            broadcast({
                type: 'GAME_OVER',
                winnerName: winner.name,
                isAI: winner.isAI
            });
        }

        document.getElementById('winner-name').innerText = `${winner.name} WINS!`;
        document.getElementById('game-end-message').innerText = `${winner.isAI ? 'The Bot' : 'The Player'} has won.`;
        document.getElementById('game-over-modal').classList.remove('hidden');

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

// --- INTERACTION REQUEST HANDLER (Client) ---
async function handleInteractionRequest(data) {
    // data = { reqId, requestType, args }
    const p = gameState.players.find(pl => pl.id === data.args.playerId);
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
            response = await askHumanExchange(p);
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

// --- REPLAY SYSTEM ---

function saveMatchHistory(winner) {
    const entry = {
        id: Date.now(),
        date: new Date().toISOString(),
        winner: winner.name,
        players: gameState.players.map(p => p.name),
        log: gameState.log,
        replayData: gameState.replayData || []
    };

    let history = [];
    try {
        const stored = localStorage.getItem('coup_match_history');
        if (stored) history = JSON.parse(stored);
    } catch(e) { console.error(e); }

    // Add new (unshift)
    history.unshift(entry);
    if (history.length > 20) history.pop(); // Limit 20

    try {
        localStorage.setItem('coup_match_history', JSON.stringify(history));
        console.log("Match saved to history.");
    } catch(e) { console.error("Failed to save history (quota exceeded?)", e); }
}

function loadReplay(idx) {
    let history = [];
    try {
        const stored = localStorage.getItem('coup_match_history');
        if (stored) history = JSON.parse(stored);
    } catch(e) {}

    const entry = history[idx];
    if (!entry || !entry.replayData || entry.replayData.length === 0) {
        alert("Replay data missing or empty.");
        return;
    }

    // Setup Replay Mode
    isReplayMode = true;
    activeReplayData = entry.replayData;
    currentReplayIndex = 0;

    document.getElementById('history-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    document.getElementById('replay-controls').classList.remove('hidden');
    document.getElementById('quit-btn').classList.add('hidden');
    document.getElementById('exit-replay-btn').classList.remove('hidden');
    document.getElementById('action-panel').classList.add('hidden'); // Hide controls

    // Load first frame
    renderReplayFrame();
}

function renderReplayFrame() {
    if (currentReplayIndex < 0) currentReplayIndex = 0;
    if (currentReplayIndex >= activeReplayData.length) currentReplayIndex = activeReplayData.length - 1;

    const state = activeReplayData[currentReplayIndex];
    syncClientState(state); // Reuse client sync logic to load state!

    // Update Step Counter
    document.getElementById('replay-step').innerText = `${currentReplayIndex + 1} / ${activeReplayData.length}`;

    // Hide controls again (syncClientState might allow them if it thinks it's my turn)
    document.getElementById('action-panel').classList.add('hidden');
}

function replayNext() {
    if (currentReplayIndex < activeReplayData.length - 1) {
        currentReplayIndex++;
        renderReplayFrame();
    }
}

function replayPrev() {
    if (currentReplayIndex > 0) {
        currentReplayIndex--;
        renderReplayFrame();
    }
}

function exitReplay() {
    isReplayMode = false;
    activeReplayData = [];
    currentReplayIndex = 0;
    location.reload();
}
