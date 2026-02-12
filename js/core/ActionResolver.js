// Action Resolution Logic (Submitting, Resolving, Challenging)

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
    stopTurnTimer(); // Action committed

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

        updateUI(); // Ensure local UI reflects the swap immediately
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
                const keptIds = await requestExchange(p);

                // Deck Logic (Moved from askHumanExchange)
                // Reconstruct logic based on IDs (More robust than indices)
                const alive = [];
                const dead = [];
                p.cards.forEach(c => {
                    if (c.dead) dead.push(c);
                    else alive.push(c);
                });

                const kept = alive.filter(c => keptIds.includes(c.id));
                const returned = alive.filter(c => !keptIds.includes(c.id));

                returned.forEach(c => gameState.deck.push(c));
                shuffle(gameState.deck);

                p.cards = [...kept, ...dead];
            }
            break;
    }
    broadcastState();
    nextTurn();
}
