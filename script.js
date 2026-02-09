const ROLES = ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'];
const ACTIONS = {
    Income: { cost: 0, blockable: false, challengeable: false },
    'Foreign Aid': { cost: 0, blockable: true, challengeable: false, blockedBy: ['Duke'] },
    Coup: { cost: 7, blockable: false, challengeable: false },
    Tax: { cost: 0, blockable: false, challengeable: true, role: 'Duke' },
    Assassinate: { cost: 3, blockable: true, challengeable: true, role: 'Assassin', blockedBy: ['Contessa'] },
    Steal: { cost: 0, blockable: true, challengeable: true, role: 'Captain', blockedBy: ['Captain', 'Ambassador'] },
    Exchange: { cost: 0, blockable: false, challengeable: true, role: 'Ambassador' }
};

let gameState = {
    players: [],
    deck: [],
    currentPlayerIndex: 0,
    turnPhase: 'ACTION_SELECT', // ACTION_SELECT, REACTION, RESOLVE
    currentAction: null,
    log: [],
    replayData: []
};

let isReplayMode = false;
let activeReplayData = [];
let currentReplayIndex = 0;

// --- CORE CLASSES ---

class Player {
    constructor(id, name, isAI = false, difficulty = 'normal') {
        this.id = id;
        this.name = name;
        this.coins = 2;
        this.cards = [];
        this.isAI = isAI;
        this.difficulty = difficulty;
        this.alive = true;
        this.memory = {};
        this.lastAction = null;
    }

    async loseCard(cardIndex) {
        if (this.cards[cardIndex].dead) return;
        this.cards[cardIndex].dead = true;
        log(`${this.name} lost a ${this.cards[cardIndex].role}!`);
        updateUI();
        broadcastState();
        await sleep(1500);

        if (this.cards.every(c => c.dead)) {
            this.alive = false;
            log(`${this.name} is ELIMINATED!`, 'important');
            updateUI();
            broadcastState();
        }
    }

    hasRole(role) {
        return this.cards.some(c => c.role === role && !c.dead);
    }

    // AI LOGIC CORE
    async decideAction() {
        if (!this.alive) return;
        await sleep(1000); // Thinking time

        // 1. Must Coup if 10+ coins
        if (this.coins >= 10) {
            this.doCoup();
            return;
        }

        // HEURISTICS
        const canAssassinate = this.coins >= 3;
        const hasDuke = this.hasRole('Duke');
        const hasAssassin = this.hasRole('Assassin');
        const hasCaptain = this.hasRole('Captain');

        let action = 'Income';

        // Difficulty Logic
        if (this.difficulty === 'hardcore') {
            // GOD MODE: Win at all costs.
            if (this.coins >= 7) { this.doCoup(); return; }

            // Aggressive Assassination (High Bluff)
            if (canAssassinate && (hasAssassin || Math.random() > 0.3)) {
                action = 'Assassinate';
            }
            // Tax often (Bluff Duke)
            else if (hasDuke || Math.random() > 0.4) {
                action = 'Tax';
            }
            // Steal if Captain or desperate
            else if (hasCaptain || Math.random() > 0.5) {
                action = 'Steal';
            }
            else {
                action = 'Foreign Aid';
            }
        } else if (this.difficulty === 'hard') {
            // RUTHLESS: Bluff often, maximize gain
            if (this.coins >= 7) {
                this.doCoup();
                return;
            } else if (canAssassinate && (hasAssassin || Math.random() > 0.4)) {
                action = 'Assassinate'; // Real or bluff assassin
            } else if (hasDuke || Math.random() > 0.3) {
                action = 'Tax'; // Real or bluff tax
            } else if (hasCaptain || Math.random() > 0.5) {
                action = 'Steal';
            } else {
                action = 'Foreign Aid'; // Risky but fast
            }
        } else if (this.difficulty === 'normal') {
            // Standard play
            if (this.coins >= 7) { this.doCoup(); return; }
            if (hasDuke) action = 'Tax';
            else if (canAssassinate && hasAssassin) action = 'Assassinate';
            else if (hasCaptain) action = 'Steal';
            else action = 'Income';
        } else {
            // Easy - Random
            const opts = ['Income', 'Foreign Aid', 'Tax'];
            if (this.coins >= 3) opts.push('Assassinate');
            action = opts[Math.floor(Math.random() * opts.length)];
        }

        let target = null;
        if (['Assassinate', 'Steal'].includes(action)) {
             target = getStrongestOpponent(this);
             // Fallback if no target found (shouldn't happen but prevents crash)
             if (!target) {
                 action = 'Income';
                 target = null;
             }
        }

        handleActionSubmit(action, this, target);
    }

    doCoup() {
        const target = getStrongestOpponent(this);
        handleActionSubmit('Coup', this, target);
    }

    // AI DECISION: Should I Challenge?
    shouldChallenge(actionObj) {
        if (!this.alive || this.id === actionObj.player.id) return false;

        // Don't challenge unchallengeable things
        if (actionObj.type !== 'Block' && !ACTIONS[actionObj.type].challengeable) return false;

        const bluffer = actionObj.player;
        let threshold = 0.8;
        if (this.difficulty === 'hard') threshold = 0.6;
        if (this.difficulty === 'hardcore') threshold = 0.4; // Very suspicious

        // REPEATED ACTION SUSPICION
        // If the player performs the same claimable action consecutively, increase suspicion
        // (Decrease threshold, making it more likely to challenge)
        if (bluffer.lastAction === actionObj.type && ACTIONS[actionObj.type].role) {
             threshold -= 0.2; // 20% more likely to challenge repeated claims
             if (actionObj.type === 'Exchange') threshold -= 0.1; // Exchange is extra suspicious if repeated
        }

        // Identify the role being claimed
        const claimedRole = actionObj.role || ACTIONS[actionObj.type]?.role;

        if (claimedRole) {
            const myCopies = this.cards.filter(c => c.role === claimedRole && !c.dead).length;

            // Check Public Knowledge (Dead cards)
            let deadCopies = 0;
            gameState.players.forEach(p => {
                p.cards.forEach(c => { if(c.dead && c.role === claimedRole) deadCopies++; });
            });
            const totalKnown = myCopies + deadCopies;

            // ABSOLUTE PROOF (Hard & Hardcore)
            if ((this.difficulty === 'hard' || this.difficulty === 'hardcore') && totalKnown === 3) {
                return true; // Caught red-handed
            }

            // High Probability Challenge
            if (this.difficulty === 'hardcore') {
                if (totalKnown === 2) return true; // 2 gone, they claim 3rd? High risk.
                if (myCopies === 2) return true;
            }

            if (this.difficulty === 'hard') {
                if (myCopies === 2) return true;
            }

            // Heuristic for Exchange (Ambassador)
            if (claimedRole === 'Ambassador') {
                 if (myCopies === 2) return true;
                 if (myCopies === 1 && Math.random() > 0.7 && this.difficulty !== 'easy') return true;
            }
        }

        // Logic: If I have the cards they claim, they might be lying
        if (actionObj.type === 'Tax') {
            const myDukes = this.cards.filter(c => c.role === 'Duke' && !c.dead).length;
            if (myDukes === 2) return true;
            if ((this.difficulty === 'hard' || this.difficulty === 'hardcore') && myDukes === 1 && Math.random() > 0.5) return true;
        }

        // Random suspicion based on difficulty
        return Math.random() > threshold;
    }

    // AI DECISION: Should I Block?
    shouldBlock(actionObj) {
        if (!this.alive || this.id === actionObj.player.id) return false;
        if (!ACTIONS[actionObj.type].blockable) return false;

        // Am I the target?
        if (actionObj.target && actionObj.target.id !== this.id) {
             // Foreign Aid can be blocked by anyone claiming Duke
             if (actionObj.type !== 'Foreign Aid') return false;
        }

        const blockerRoles = ACTIONS[actionObj.type].blockedBy;
        const hasBlocker = this.cards.some(c => blockerRoles.includes(c.role) && !c.dead);

        if (hasBlocker) return true; // Always block if I really can

        // Bluff block?
        // Hardcore: Block almost always if targeted by assassination (to survive)
        if (this.difficulty === 'hardcore') {
            if (actionObj.type === 'Assassinate') return true; // Desperate block
            if (actionObj.type === 'Steal' && Math.random() > 0.3) return true;
            if (actionObj.type === 'Foreign Aid' && Math.random() > 0.5) return true;
        }

        if (this.difficulty === 'hard' && actionObj.type === 'Assassinate' && Math.random() > 0.2) return true;
        if (this.difficulty === 'hard' && actionObj.type === 'Steal' && Math.random() > 0.5) return true;

        return false;
    }
}

// --- SETUP FUNCTIONS ---

function startGame() {
    const humanCount = parseInt(document.getElementById('human-count').value);
    const aiCount = parseInt(document.getElementById('ai-count').value);
    const difficulty = document.getElementById('difficulty').value;

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

function askHumanChallenge(player, actionObj) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');
        title.innerText = `${player.name}, do you want to Challenge ${actionObj.player.name}'s ${actionObj.type}?`;
        btns.innerHTML = '';

        const yesBtn = document.createElement('button');
        yesBtn.innerText = 'Challenge!';
        yesBtn.className = 'red';
        yesBtn.onclick = () => {
            panel.classList.add('hidden');
            resolve(true);
        };

        const noBtn = document.createElement('button');
        noBtn.innerText = 'Pass';
        noBtn.onclick = () => {
            panel.classList.add('hidden');
            resolve(false);
        };

        btns.appendChild(yesBtn);
        btns.appendChild(noBtn);
    });
}

function askHumanBlock(player, actionObj) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');
        const blockerRoles = ACTIONS[actionObj.type].blockedBy.join(' or ');
        title.innerText = `${player.name}, do you want to Block ${actionObj.type} (claims ${blockerRoles})?`;
        btns.innerHTML = '';

        const yesBtn = document.createElement('button');
        yesBtn.innerText = 'Block!';
        yesBtn.onclick = () => {
            panel.classList.add('hidden');
            resolve(true);
        };

        const noBtn = document.createElement('button');
        noBtn.innerText = 'Pass';
        noBtn.onclick = () => {
            panel.classList.add('hidden');
            resolve(false);
        };

        btns.appendChild(yesBtn);
        btns.appendChild(noBtn);
    });
}

function askHumanToLoseCard(player) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');
        title.innerText = `${player.name}, choose a card to lose:`;
        btns.innerHTML = '';

        player.cards.forEach((card, idx) => {
            if (card.dead) return;

            const btn = document.createElement('button');
            btn.innerText = card.role;
            btn.className = 'red';
            btn.onclick = () => {
                panel.classList.add('hidden');
                resolve(idx);
            };
            btns.appendChild(btn);
        });
    });
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

function showHistory() {
    // Force switch to history screen from ANY state (Lobby or Game)
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.remove('active'); // Key fix
    document.getElementById('history-screen').classList.add('active');

    const list = document.getElementById('history-list');
    list.innerHTML = '';

    let history = [];
    try {
        const stored = localStorage.getItem('coup_match_history');
        if (stored) history = JSON.parse(stored);
    } catch(e) {}

    if (history.length === 0) {
        list.innerHTML = '<p>No history found.</p>';
        return;
    }

    history.forEach((entry, idx) => {
        const div = document.createElement('div');
        div.style.background = '#333';
        div.style.padding = '10px';
        div.style.marginBottom = '10px';
        div.style.borderRadius = '5px';
        div.style.border = '1px solid #444';

        const date = new Date(entry.date).toLocaleString();
        div.innerHTML = `
            <div style="font-weight:bold; color:#4caf50;">Winner: ${entry.winner}</div>
            <div style="font-size:0.8rem; color:#aaa;">${date}</div>
            <div style="font-size:0.8rem;">Players: ${entry.players.join(', ')}</div>
            <button class="small-btn" onclick="loadReplay(${idx})" style="margin-top:5px; background:#2196F3; width: auto;">Watch Replay</button>
        `;
        list.appendChild(div);
    });
}

function showHistoryFromModal() {
    // Hide Modal first
    document.getElementById('game-over-modal').classList.add('hidden');
    showHistory();
}

function closeHistory() {
    document.getElementById('history-screen').classList.remove('active');
    // Determine where to go back to.
    // If game is in progress or just finished (players array not empty), go to game screen?
    // Or just default to Lobby?
    // Safe default: Lobby.
    document.getElementById('lobby-screen').classList.add('active');
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

function askContinue(message) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');
        title.innerText = message;
        btns.innerHTML = '';

        const okBtn = document.createElement('button');
        okBtn.innerText = 'Continue';
        okBtn.onclick = () => {
            panel.classList.add('hidden');
            resolve();
        };
        btns.appendChild(okBtn);
    });
}

function downloadLog() {
    const logContent = gameState.log.join('\n');
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coup_log_${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

function askHumanExchange(player) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');

        // Logic: Keep same number of ALIVE cards.
        const totalAlive = player.cards.filter(c => !c.dead).length;
        const keepCount = totalAlive - 2;

        title.innerText = `${player.name}, select ${keepCount} card(s) to KEEP:`;
        btns.innerHTML = '';

        const aliveCards = [];
        player.cards.forEach(c => {
            if (!c.dead) aliveCards.push(c);
        });

        // Selected indices (from aliveCards array)
        const selectedIndices = new Set();

        const confirmBtn = document.createElement('button');
        confirmBtn.innerText = `Confirm (0/${keepCount})`;
        confirmBtn.disabled = true;
        confirmBtn.onclick = () => {
            // Return selected INDICES relative to alive array
            panel.classList.add('hidden');
            resolve(Array.from(selectedIndices));
        };

        const cardContainer = document.createElement('div');
        cardContainer.style.display = 'flex';
        cardContainer.style.gap = '10px';
        cardContainer.style.justifyContent = 'center';
        cardContainer.style.marginBottom = '10px';

        aliveCards.forEach((card, idx) => {
            const cDiv = document.createElement('div');
            cDiv.className = 'player-card';
            cDiv.innerText = card.role;
            cDiv.onclick = () => {
                if (selectedIndices.has(idx)) {
                    selectedIndices.delete(idx);
                    cDiv.classList.remove('selected');
                } else {
                    if (selectedIndices.size < keepCount) {
                        selectedIndices.add(idx);
                        cDiv.classList.add('selected');
                    }
                }

                confirmBtn.innerText = `Confirm (${selectedIndices.size}/${keepCount})`;
                confirmBtn.disabled = selectedIndices.size !== keepCount;
            };
            cardContainer.appendChild(cDiv);
        });

        btns.appendChild(cardContainer);
        btns.appendChild(confirmBtn);
    });
}

function nextTurn() {
    // Check Winner
    const alive = gameState.players.filter(p => p.alive);
    if (alive.length === 1) {
        const winner = alive[0];
        log(`${winner.name} WINS THE GAME!`, 'important');

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

    setTimeout(playTurn, 1000);
}

// --- UTILS ---

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
function log(msg, type='') {
    gameState.log.push(msg);
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerText = msg;
    const box = document.getElementById('game-log');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function toggleRules() {
    document.getElementById('rules-modal').classList.toggle('hidden');
}

// --- UI UPDATER ---
function updateUI() {
    const p = getCurrentPlayer();

    // Header
    document.getElementById('turn-indicator').innerText = `Turn: ${p.name}`;

    // Opponents
    const oppContainer = document.getElementById('opponents-container');
    oppContainer.innerHTML = '';
    gameState.players.forEach(pl => {
        // Filter out the player shown in the main area
        let shouldHide = false;
        if (isNetworkGame) {
            if (pl.id === myPlayerId) shouldHide = true;
        } else {
            // Local: Hide current player if human (Pass & Play)
            // Or if Single Player, hide the single human (Player 1)
            const humans = gameState.players.filter(x => !x.isAI);
            if (humans.length === 1) {
                 if (pl.id === humans[0].id) shouldHide = true;
            } else {
                 if (pl.id === p.id && !p.isAI) shouldHide = true;
            }
        }

        if (shouldHide) return;

        const div = document.createElement('div');
        div.className = `opponent-card ${pl.id === p.id ? 'active-turn' : ''}`;
        if (!pl.alive) div.style.opacity = 0.5;

        let cardHtml = '';
        pl.cards.forEach(c => {
            if (c.dead) cardHtml += `<span class="card-back" style="background:red"></span>`;
            else {
                if (isReplayMode) {
                    cardHtml += `<span class="card-back" style="width:auto; min-width:30px; background:#ddd; color:#000; font-size:0.5rem; line-height:38px; overflow:hidden; vertical-align:middle;">${c.role.substr(0,3)}</span>`;
                } else {
                    cardHtml += `<span class="card-back"></span>`;
                }
            }
        });

        div.innerHTML = `
            <div><strong>${pl.name}</strong></div>
            <div>${pl.coins} Coins</div>
            <div>${cardHtml}</div>
        `;
        oppContainer.appendChild(div);
    });

    // Player Area
    const playerArea = document.getElementById('player-area');
    playerArea.classList.add('hidden'); // Default hidden

    let me = null;
    if (isNetworkGame) {
        me = gameState.players.find(pl => pl.id === myPlayerId);
    } else {
        const humans = gameState.players.filter(pl => !pl.isAI);
        if (humans.length === 1) me = humans[0];
        else if (!p.isAI) me = p; // Pass & Play active
    }

    if (me) {
        playerArea.classList.remove('hidden');

        let statusText = me.name;
        if (p.id !== me.id) statusText += ` (Waiting for ${p.name})`;
        else statusText += " (Your Turn)";

        document.getElementById('active-player-name').innerText = statusText;
        document.getElementById('player-coins').innerText = me.coins;

        const cardBox = document.getElementById('player-cards');
        cardBox.innerHTML = '';
        me.cards.forEach((c, idx) => {
            const cDiv = document.createElement('div');
            cDiv.className = `player-card ${c.dead ? 'dead' : ''}`;
            cDiv.innerText = c.role;
            cardBox.appendChild(cDiv);
        });
    } else {
         // Watching bots only
         playerArea.classList.remove('hidden');
         document.getElementById('active-player-name').innerText = `${p.name} (AI) is thinking...`;
         document.getElementById('player-cards').innerHTML = '';
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

function setControls(active) {
    const btns = document.querySelectorAll('#action-panel button');
    btns.forEach(b => {
        b.disabled = !active;
        b.classList.remove('disabled-force');
    });

    if (active) {
        // Forced Coup Check
        const p = getCurrentPlayer();
        // If local human (or if network game and it's my turn, checked by caller context usually,
        // but let's be safe: we only call setControls(true) when it IS our turn).
        if (p && p.coins >= 10) {
             btns.forEach(b => {
                 if (b.innerText.indexOf('Coup') === -1) {
                     b.disabled = true;
                     b.classList.add('disabled-force'); // Optional styling
                 }
             });
        }
    }
}

// --- LOBBY UI LOGIC ---

function switchMode(mode) {
    const localBtn = document.getElementById('mode-local');
    const onlineBtn = document.getElementById('mode-online');
    const localControls = document.getElementById('local-controls');
    const onlineControls = document.getElementById('online-controls');

    if (mode === 'local') {
        localBtn.classList.add('active');
        onlineBtn.classList.remove('active');
        localControls.classList.remove('hidden');
        onlineControls.classList.add('hidden');
    } else {
        localBtn.classList.remove('active');
        onlineBtn.classList.add('active');
        localControls.classList.add('hidden');
        onlineControls.classList.remove('hidden');
    }
}

// --- NETWORK MODULE ---

let isNetworkGame = false;
let myPlayerId = null; // Used for rendering perspective (Host=1, Clients=assigned)
let netState = {
    peer: null,
    hostConn: null, // Client's connection to host
    clients: [], // Host's list of { id, conn, name }
    isHost: false,
    pendingRequests: {} // Map of request ID to resolve function
};

// --- HOST LOGIC ---
function initHost() {
    const name = document.getElementById('my-player-name').value.trim();
    if (name.length < 3 || name.length > 20) {
        alert("Name must be between 3 and 20 characters!");
        return;
    }
    if (name.includes(' ')) {
        alert("Name cannot contain spaces!");
        return;
    }

    isNetworkGame = true;
    netState.isHost = true;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('host-room-info').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Initializing Network...";

    netState.peer = new Peer(); // Auto-generate ID

    netState.peer.on('open', (id) => {
        document.getElementById('my-room-code').innerText = id;
        document.getElementById('connection-status').innerText = "Waiting for players...";
        document.getElementById('network-start-btn').classList.remove('hidden');
        updateLobbyList(); // Show self immediately
    });

    netState.peer.on('connection', (conn) => {
        conn.on('open', () => {
            console.log("New connection:", conn.peer);
        });
        conn.on('data', (data) => handleNetworkData(data, conn));
        conn.on('close', () => {
            netState.clients = netState.clients.filter(c => c.conn !== conn);
            updateLobbyList();
            broadcastLobbyUpdate();
            markPlayerDisconnected(conn.peer);
        });
    });
}

// --- CLIENT LOGIC ---
function joinGame() {
    const name = document.getElementById('my-player-name').value.trim();
    if (name.length < 3 || name.length > 20) {
        alert("Name must be between 3 and 20 characters!");
        return;
    }
    if (name.includes(' ')) {
        alert("Name cannot contain spaces!");
        return;
    }
    const hostId = document.getElementById('host-id-input').value.trim();
    if (!hostId) { alert("Please enter a Room Code"); return; }

    isNetworkGame = true;
    netState.isHost = false;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Connecting to Host...";

    netState.peer = new Peer();

    netState.peer.on('open', (id) => {
        const conn = netState.peer.connect(hostId);
        netState.hostConn = conn;

        conn.on('open', () => {
            document.getElementById('connection-status').innerText = "Connected! Waiting for Host...";
            conn.send({ type: 'JOIN', name: name });
        });

        conn.on('data', (data) => handleNetworkData(data, conn));

        conn.on('close', () => {
            alert("Disconnected from Host");
            location.reload();
        });

        conn.on('error', (err) => {
            console.error(err);
            alert("Connection Error: " + err);
            location.reload();
        });
    });
}

function handleNetworkData(data, conn) {
    // console.log("Received:", data);

    if (netState.isHost) {
        // HOST HANDLING
        switch(data.type) {
            case 'JOIN':
                netState.clients.push({
                    id: conn.peer,
                    conn: conn,
                    name: data.name
                });
                updateLobbyList();
                broadcastLobbyUpdate();
                break;
            case 'ACTION':
                // Client submitting an action
                // Find player
                const p = gameState.players.find(pl => pl.peerId === conn.peer);
                if (p && gameState.players[gameState.currentPlayerIndex].id === p.id) {
                    // Inject target by Name look up (since ID matches)
                    let target = null;
                    if (data.targetId) {
                        target = gameState.players.find(pl => pl.id === data.targetId);
                    }
                    handleActionSubmit(data.action, p, target);
                }
                break;
            case 'INTERACTION_RESPONSE':
                // Client responding to Challenge/Block query
                // Resolve the pending promise
                if (netState.pendingRequests[data.reqId]) {
                    netState.pendingRequests[data.reqId](data.response);
                    delete netState.pendingRequests[data.reqId];
                }
                break;
        }
    } else {
        // CLIENT HANDLING
        switch(data.type) {
            case 'LOBBY_UPDATE':
                updateClientLobby(data.players);
                break;
            case 'GAME_START':
                myPlayerId = data.playerId;
                setupClientGame(data.state);
                break;
            case 'STATE_UPDATE':
                syncClientState(data.state);
                break;
            case 'INTERACTION_REQUEST':
                handleInteractionRequest(data);
                break;
            case 'GAME_OVER':
                handleGameOver(data);
                break;
        }
    }
}

function handleGameOver(data) {
    // Ensure log is up to date (usually State Update comes before this, but safe to assume log is sync)
    document.getElementById('winner-name').innerText = `${data.winnerName} WINS!`;
    document.getElementById('game-end-message').innerText = `${data.isAI ? 'The Bot' : 'The Player'} has won.`;
    document.getElementById('game-over-modal').classList.remove('hidden');

    saveMatchHistory({ name: data.winnerName });
}

// --- LOBBY HELPERS ---
function updateLobbyList() {
    const list = document.getElementById('connected-players-list');
    list.innerHTML = ''; // Clear

    // 1. Host (Self)
    if (netState.isHost) {
        const myName = document.getElementById('my-player-name').value.trim() || 'Host';
        const li = document.createElement('li');
        li.innerText = `${myName} (Host)`;
        li.style.color = '#4caf50';
        list.appendChild(li);
    } else {
        // Client view handled by updateClientLobby
    }

    // 2. Connected Clients
    netState.clients.forEach(c => {
        const li = document.createElement('li');
        li.innerText = c.name;
        list.appendChild(li);
    });

    // 3. AI Bots (Placeholder)
    if (netState.isHost) {
        const aiCount = parseInt(document.getElementById('network-ai-count').value);
        for(let i=1; i<=aiCount; i++) {
            const li = document.createElement('li');
            li.innerText = `Bot ${i} (AI)`;
            li.style.color = '#aaa';
            li.style.fontStyle = 'italic';
            list.appendChild(li);
        }
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

function showHistory() {
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('history-screen').classList.add('active');

    const list = document.getElementById('history-list');
    list.innerHTML = '';

    let history = [];
    try {
        const stored = localStorage.getItem('coup_match_history');
        if (stored) history = JSON.parse(stored);
    } catch(e) {}

    if (history.length === 0) {
        list.innerHTML = '<p>No history found.</p>';
        return;
    }

    history.forEach((entry, idx) => {
        const div = document.createElement('div');
        div.style.background = '#333';
        div.style.padding = '10px';
        div.style.marginBottom = '10px';
        div.style.borderRadius = '5px';
        div.style.border = '1px solid #444';

        const date = new Date(entry.date).toLocaleString();
        div.innerHTML = `
            <div style="font-weight:bold; color:#4caf50;">Winner: ${entry.winner}</div>
            <div style="font-size:0.8rem; color:#aaa;">${date}</div>
            <div style="font-size:0.8rem;">Players: ${entry.players.join(', ')}</div>
            <button class="small-btn" onclick="loadReplay(${idx})" style="margin-top:5px; background:#2196F3; width: auto;">Watch Replay</button>
        `;
        list.appendChild(div);
    });
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

function broadcastLobbyUpdate() {
    const hostName = document.getElementById('my-player-name').value.trim() || 'Host';

    // Include Bots in the broadcast list so clients see them too
    const bots = [];
    const aiCount = parseInt(document.getElementById('network-ai-count').value);
    for(let i=1; i<=aiCount; i++) bots.push(`Bot ${i} (AI)`);

    const names = [`${hostName} (Host)`, ...netState.clients.map(c => c.name), ...bots];
    broadcast({ type: 'LOBBY_UPDATE', players: names });
}

function updateClientLobby(names) {
    const list = document.getElementById('connected-players-list');
    list.innerHTML = '';
    names.forEach(n => {
        const li = document.createElement('li');
        li.innerText = n;
        list.appendChild(li);
    });
}

function broadcast(msg) {
    netState.clients.forEach(c => {
        if(c.conn && c.conn.open) c.conn.send(msg);
    });
}

function startNetworkGame() {
    if (!netState.isHost) return;

    const aiCount = parseInt(document.getElementById('network-ai-count').value);

    // Check Minimum Players (Host + at least 1 other)
    if (netState.clients.length + aiCount < 1) {
        alert("You need at least 1 other player (Human or AI) to start!");
        return;
    }

    // 1. Setup Players
    gameState.players = [];
    gameState.deck = [];
    gameState.log = [];
    gameState.replayData = [];

    // Deck
    ROLES.forEach(role => {
        for(let i=0; i<3; i++) gameState.deck.push({ role: role, dead: false });
    });
    shuffle(gameState.deck);

    // Host is Player 1
    const hostName = document.getElementById('my-player-name').value.trim();
    const hostP = new Player(1, hostName, false);
    gameState.players.push(hostP);
    myPlayerId = 1;

    // Clients
    netState.clients.forEach((c, idx) => {
        const pid = idx + 2;
        const p = new Player(pid, c.name || `Player ${pid}`, false);
        p.isRemote = true; // Flag for logic
        p.peerId = c.id;   // Map back to connection
        gameState.players.push(p);
    });

    // AI
    // aiCount is already defined above
    const difficulty = document.getElementById('network-difficulty').value;
    const startId = gameState.players.length + 1;
    for(let i=0; i<aiCount; i++) {
        // Keep Bot Names as is (Bot 1, Bot 2...)
        gameState.players.push(new Player(startId + i, `Bot ${i+1}`, true, difficulty));
    }

    // Deal
    gameState.players.forEach(p => {
        p.cards = [gameState.deck.pop(), gameState.deck.pop()];
    });

    gameState.currentPlayerIndex = 0;

    // UI Switch for Host
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    // Broadcast Start
    netState.clients.forEach(c => {
        const p = gameState.players.find(pl => pl.peerId === c.id);
        c.conn.send({
            type: 'GAME_START',
            playerId: p.id,
            state: serializeState()
        });
    });

    updateUI();
    playTurn();
}

function setupClientGame(initialState) {
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    gameState.replayData = [];

    // Load State
    syncClientState(initialState);
}

function serializeState() {
    // Create a copy of gameState safe for JSON
    // We need to handle circular refs (like currentAction.player)
    // and remove hidden info if we wanted to be secure, but for now we trust clients.

    const s = {
        players: gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            coins: p.coins,
            cards: p.cards, // Full cards (client must hide opponent's)
            isAI: p.isAI,
            alive: p.alive,
            lastAction: p.lastAction,
            isRemote: p.isRemote, // preserve flags
            peerId: p.peerId
        })),
        currentPlayerIndex: gameState.currentPlayerIndex,
        turnPhase: gameState.turnPhase,
        log: gameState.log,
        currentAction: null
    };

    if (gameState.currentAction) {
        s.currentAction = {
            type: gameState.currentAction.type,
            playerId: gameState.currentAction.player.id, // Send ID instead of Obj
            targetId: gameState.currentAction.target ? gameState.currentAction.target.id : null,
            role: gameState.currentAction.role
        };
    }

    return s;
}

function syncClientState(remoteState) {
    // Reconstruct gameState from remoteState
    gameState.log = remoteState.log;
    gameState.currentPlayerIndex = remoteState.currentPlayerIndex;
    gameState.turnPhase = remoteState.turnPhase;

    // Sync Players
    // We overwrite local players array with data
    // Important: UI depends on this data structure
    gameState.players = remoteState.players.map(rp => {
        // We don't need full Player class instance methods on Client
        // Just the properties for updateUI
        return rp;
    });

    // Re-link currentAction
    if (remoteState.currentAction) {
        const p = gameState.players.find(pl => pl.id === remoteState.currentAction.playerId);
        const t = remoteState.currentAction.targetId ? gameState.players.find(pl => pl.id === remoteState.currentAction.targetId) : null;
        gameState.currentAction = {
            type: remoteState.currentAction.type,
            player: p,
            target: t,
            role: remoteState.currentAction.role
        };
    } else {
        gameState.currentAction = null;
    }

    // Refresh Logs
    const logBox = document.getElementById('game-log');
    logBox.innerHTML = '';
    gameState.log.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'log-entry'; // Type lost in serialization?
        // We didn't serialize type. Improvements for later.
        div.innerText = msg;
        logBox.appendChild(div);
    });
    logBox.scrollTop = logBox.scrollHeight;

    updateUI();

    // CAPTURE REPLAY (CLIENT)
    if (!isReplayMode && isNetworkGame && !netState.isHost) {
        captureReplaySnapshot();
    }
}

function broadcastState() {
    // CAPTURE REPLAY (HOST / LOCAL)
    // We capture every broadcast state, which corresponds to every significant UI update.
    if (!isReplayMode) {
        captureReplaySnapshot();
    }

    if (isNetworkGame && netState.isHost) {
        const s = serializeState();
        broadcast({ type: 'STATE_UPDATE', state: s });
    }
}

function captureReplaySnapshot() {
    if (!gameState.replayData) gameState.replayData = [];

    // Create a deep copy snapshot
    const s = serializeState();
    s.timestamp = Date.now();

    // Avoid duplicates if nothing changed (optional optimization, but strict capture is safer)
    gameState.replayData.push(s);
}


// --- NETWORK INTERACTION WRAPPERS ---

function requestChallenge(player, actionObj) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'CHALLENGE', {
            playerId: player.id,
            actionPlayerId: actionObj.player.id,
            actionType: actionObj.type,
            role: actionObj.role // claimed role
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

function requestExchange(player) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'EXCHANGE', {
            playerId: player.id
        });
    } else {
        return askHumanExchange(player);
    }
}

function sendInteractionRequest(player, type, args) {
    return new Promise(resolve => {
        const reqId = Date.now() + Math.random().toString();
        netState.pendingRequests[reqId] = resolve;

        const client = netState.clients.find(c => c.id === player.peerId);
        if (client && client.conn) {
            client.conn.send({
                type: 'INTERACTION_REQUEST',
                reqId: reqId,
                requestType: type,
                args: args
            });
        } else {
            console.error("Client not found for interaction:", player.name);
            resolve(null); // Fallback
        }
    });
}

// --- ERROR HANDLING & STABILITY ---

window.onbeforeunload = function() {
    if (isNetworkGame) {
        return "Are you sure you want to leave the game?";
    }
};

// Auto-Skip Dead/Disconnected Players
// We need to modify nextTurn to be smarter about network disconnects.
// But we don't have a reliable 'disconnected' flag in Player object yet, except via 'close' event.

// Let's hook into the existing 'close' event in initHost
// It updates netState.clients.
// We should also mark the player as dead or skipped in gameState.

function markPlayerDisconnected(peerId) {
    if (!netState.isHost) return;

    const p = gameState.players.find(pl => pl.peerId === peerId);
    if (p) {
        log(`${p.name} disconnected.`, 'important');
        p.alive = false; // Kill them to skip turns
        p.cards.forEach(c => c.dead = true); // Mark cards dead

        broadcastState(); // Tell everyone
        updateUI();

        // If it was their turn, move on
        if (getCurrentPlayer().id === p.id) {
            nextTurn();
        }
    }
}
