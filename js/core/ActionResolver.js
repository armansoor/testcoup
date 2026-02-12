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
    try {
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

    } catch (e) {
        console.error("Critical Error in processReactions:", e);
        log(`Game Error: ${e.message}`, 'important');
        // Attempt recovery: Force next turn
        nextTurn();
    }
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
        if (oldCard) gameState.deck.push(oldCard);

        // Shuffle
        shuffle(gameState.deck);

        // Draw NEW card
        if (gameState.deck.length > 0) {
            const newCard = gameState.deck.pop();
            // Safety check for undefined
            if (newCard) {
                claimedPlayer.cards[cardIdx] = newCard;
            } else {
                // Critical Failure: Player has undefined card now.
                log("Error: Deck returned undefined card.", "important");
            }
        } else {
             // Deck Empty: Cannot draw. Player effectively loses the card?
             // Or they keep the old card?
             // Standard rules: "Cards are returned to the Court Deck, shuffled, and a replacement is drawn."
        }

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
            // Robust Draw Logic: Draw up to 2 cards, handling empty deck
            const drawnCards = [];
            for (let i = 0; i < 2; i++) {
                if (gameState.deck.length > 0) {
                     const c = gameState.deck.pop();
                     if (c) drawnCards.push(c);
                }
            }
            log(`${p.name} exchanges cards...`);

            // Get current alive cards (Safe filter)
            // Ensure we use the latest player object from state
            const freshP = gameState.players.find(pl => pl.id === p.id) || p;
            const currentAlive = freshP.cards.filter(c => c && !c.dead);
            const currentDead = freshP.cards.filter(c => c && c.dead);

            // Target Keep Count is simply the number of alive cards the player has.
            // If for some reason it's 0 (bug), force at least 1 if player is supposedly alive?
            // But if they have 0 alive cards, they shouldn't be playing.
            let keepCount = currentAlive.length;
            if (keepCount === 0 && freshP.alive) {
                 console.warn("Exchange: Player has 0 alive cards but is marked alive. Defaulting to 1.");
                 keepCount = 1;
            }

            // Combine for selection (Alive + Drawn)
            // Filter out any undefined just in case
            const cardsToChoose = [...currentAlive, ...drawnCards].filter(c => c);

            // Log for debugging
            console.log(`Exchange: ${freshP.name} has ${currentAlive.length} alive, drew ${drawnCards.length}. Keep: ${keepCount}. Total choice: ${cardsToChoose.length}`);

            updateUI(); // Force UI update before showing selection modal

            // Safety: If cardsToChoose has fewer cards than we need to keep (e.g. deck empty AND hand corrupted),
            // we just keep everything.
            if (cardsToChoose.length <= keepCount) {
                // No choice needed/possible
                freshP.cards = [...cardsToChoose, ...currentDead];
            } else {
                if(freshP.isAI) {
                    // AI Logic: Randomly keep 'keepCount' cards
                    shuffle(cardsToChoose);

                    const kept = cardsToChoose.slice(0, keepCount);
                    const returned = cardsToChoose.slice(keepCount);

                    // Return unchosen to deck
                    returned.forEach(c => { if(c) gameState.deck.push(c); });
                    shuffle(gameState.deck);

                    // Update Player
                    freshP.cards = [...kept, ...currentDead];
                } else {
                    // Human Logic (Local or Remote)
                    // cardsToChoose is safe (no undefined).
                    // We pass keepCount explicitly to avoid UI assuming deck size.
                    let keptIds = await requestExchange(freshP, cardsToChoose, keepCount);

                    // Validate keptIds
                    if (!keptIds || !Array.isArray(keptIds)) {
                         // Fallback: Randomly keep if response invalid
                         keptIds = cardsToChoose.slice(0, keepCount).map(c => c.id);
                    }

                    const kept = cardsToChoose.filter(c => keptIds.includes(c.id));

                    // Safety: Ensure we kept the right amount. If not, fill up or trim?
                    // Usually UI handles it. If mismatch, we trust the filter result
                    // (unless kept is empty and keepCount > 0, which implies error).

                    // Identify returned cards
                    const returned = cardsToChoose.filter(c => !kept.includes(c));

                    returned.forEach(c => { if(c) gameState.deck.push(c); });
                    shuffle(gameState.deck);

                    freshP.cards = [...kept, ...currentDead];
                }
            }

            updateUI();
            broadcastState();
            break;
    }
    broadcastState();
    nextTurn();
}
