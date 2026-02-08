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
    log: []
};

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
    }

    loseCard(cardIndex) {
        if (this.cards[cardIndex].dead) return;
        this.cards[cardIndex].dead = true;
        log(`${this.name} lost a ${this.cards[cardIndex].role}!`);
        if (this.cards.every(c => c.dead)) {
            this.alive = false;
            log(`${this.name} is ELIMINATED!`, 'important');
        }
        updateUI();
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
        if (this.difficulty === 'hard') {
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
        // Blocks are always challengeable
        if (actionObj.type !== 'Block' && !ACTIONS[actionObj.type].challengeable) return false;

        const bluffer = actionObj.player;
        const threshold = this.difficulty === 'hard' ? 0.6 : 0.8; // Hard bots challenge more

        // Identify the role being claimed
        const claimedRole = actionObj.role || ACTIONS[actionObj.type]?.role;

        if (claimedRole) {
            const myCopies = this.cards.filter(c => c.role === claimedRole && !c.dead).length;

            // If I have 2 of the claimed role, it's less likely they have it (1 left in deck/others)
            // If it's a 2-player game (or late game), probability shifts, but simple heuristic:
            if (myCopies === 2 && this.difficulty === 'hard') {
                return true; // Aggressive challenge
            }
        }

        // Logic: If I have the cards they claim, they might be lying
        // E.g. They claim Duke (Tax), but I have 2 Dukes. High chance they lie.
        if (actionObj.type === 'Tax') {
            const myDukes = this.cards.filter(c => c.role === 'Duke' && !c.dead).length;
            if (myDukes === 2) return true; // High probability lie
            if (this.difficulty === 'hard' && myDukes === 1 && Math.random() > 0.5) return true;
        }

        // Random suspicion based on difficulty
        return Math.random() > threshold;
    }

    // AI DECISION: Should I Block?
    shouldBlock(actionObj) {
        if (!this.alive || this.id === actionObj.player.id) return false;
        if (!ACTIONS[actionObj.type].blockable) return false;

        // Am I the target?
        if (actionObj.target && actionObj.target.id !== this.id) return false; // Only block if I am target (mostly)
        if (actionObj.type === 'Foreign Aid') { /* Anyone can block FA */ } 
        else if (actionObj.target && actionObj.target.id !== this.id) return false;

        const blockerRoles = ACTIONS[actionObj.type].blockedBy;
        const hasBlocker = this.cards.some(c => blockerRoles.includes(c.role) && !c.dead);

        if (hasBlocker) return true; // Always block if I really can

        // Bluff block?
        if (this.difficulty === 'hard' && actionObj.type === 'Assassinate' && Math.random() > 0.2) return true; // Save myself!
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

    if (p.isAI) {
        p.decideAction();
    } else {
        // Unlock UI for human
        setControls(true);
    }
}

function submitAction(actionType) {
    const p = getCurrentPlayer();
    
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
    
    log(`${player.name} attempts to ${actionType}${target ? ' on ' + target.name : ''}.`);

    // DEDUCT COSTS IMMEDIATELY
    player.coins -= ACTIONS[actionType].cost;
    updateUI();

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
                wantsChallenge = await askHumanChallenge(p, action);
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
            else wantsBlock = await askHumanBlock(p, action);
            
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
                        wantsChallenge = await askHumanChallenge(challenger, challengeAction);
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
                            nextTurn();
                        }
                        return;
                    }
                }

                log(`Action BLOCKED.`);
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
        log(`${claimedPlayer.name} HAS the ${claimedRole}! Challenger loses.`, 'important');
        // Challenger loses card
        await loseInfluence(challenger);
        
        // Claimed player swaps card
        const cardIdx = claimedPlayer.cards.findIndex(c => c.role === claimedRole && !c.dead);
        claimedPlayer.cards[cardIdx] = gameState.deck.pop(); // Swap
        gameState.deck.push({role: claimedRole, dead: false}); // Return old
        shuffle(gameState.deck);
        
        return true; // Challenge lost (Blocker won)
    } else {
        log(`${claimedPlayer.name} was BLUFFING! Action fails.`, 'important');
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
        player.loseCard(idx);
    } else {
        const idx = await askHumanToLoseCard(player);
        player.loseCard(idx);
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
            const stolen = Math.min(t.coins, 2);
            t.coins -= stolen;
            p.coins += stolen;
            log(`Stole ${stolen} from ${t.name}`);
            break;
        case 'Assassinate':
            log(`${t.name} was Assassinated!`);
            await loseInfluence(t);
            break;
        case 'Coup':
            log(`${t.name} suffered a Coup!`);
            await loseInfluence(t);
            break;
        case 'Exchange':
            p.cards.push(gameState.deck.pop(), gameState.deck.pop());
            log(`${p.name} exchanges cards...`);

            if(p.isAI) {
                // Simplicity: AI keeps random
                shuffle(p.cards);
                while(p.cards.length > 2) {
                    gameState.deck.push(p.cards.pop());
                }
            } else {
                await askHumanExchange(p);
            }
            break;
    }
    nextTurn();
}

function askHumanExchange(player) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');

        // Count how many alive cards the player SHOULD have
        // They drew 2, so current total length - 2 is their original count.
        // Wait, dead cards are in the array too.
        // Logic: Keep same number of ALIVE cards.
        const totalAlive = player.cards.filter(c => !c.dead).length;
        const toKeepCount = totalAlive - 2; // We added 2, so we need to remove 2 to get back to original count.
        // No, totalAlive includes the 2 new ones (which are alive).
        // Original alive count = totalAlive - 2.
        // We want to keep Original Alive Count.
        const keepCount = totalAlive - 2;

        // If keepCount is 0 (impossible if game is running), handle gracefully?
        // Actually, logic is: Draw 2. Choose (Original Alive) to keep.
        // Example: Had 1 alive. Draw 2. Now 3 alive. Keep 1. Return 2.

        title.innerText = `${player.name}, select ${keepCount} card(s) to KEEP:`;
        btns.innerHTML = '';

        // Render all ALIVE cards as selectable
        // Dead cards are not exchanged, they stay.
        // Wait, standard Coup rules: You take your influence cards (face down), add 2, shuffle, keep X.
        // Face up (dead) cards are irrelevant to exchange, they just sit there.

        const aliveCards = [];
        const deadCards = [];
        player.cards.forEach(c => {
            if (c.dead) deadCards.push(c);
            else aliveCards.push(c);
        });

        // Selected indices (from aliveCards array)
        const selectedIndices = new Set();

        const confirmBtn = document.createElement('button');
        confirmBtn.innerText = `Confirm (0/${keepCount})`;
        confirmBtn.disabled = true;
        confirmBtn.onclick = () => {
            // Reconstruct player hand
            const keptCards = aliveCards.filter((_, i) => selectedIndices.has(i));
            const returnedCards = aliveCards.filter((_, i) => !selectedIndices.has(i));

            // Return unselected to deck
            returnedCards.forEach(c => gameState.deck.push(c));
            shuffle(gameState.deck);

            // Update player cards: Kept + Dead
            player.cards = [...keptCards, ...deadCards];

            panel.classList.add('hidden');
            resolve();
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

        document.getElementById('winner-name').innerText = `${winner.name} WINS!`;
        document.getElementById('game-end-message').innerText = `${winner.isAI ? 'The Bot' : 'The Player'} has won.`;
        document.getElementById('game-over-modal').classList.remove('hidden');
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
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
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
        if (pl.id === p.id && !gameState.players.every(x => x.isAI)) return; // Don't show self in opponents area if human playing
        
        const div = document.createElement('div');
        div.className = `opponent-card ${pl.id === p.id ? 'active-turn' : ''}`;
        if (!pl.alive) div.style.opacity = 0.5;
        
        let cardHtml = '';
        pl.cards.forEach(c => {
            if (c.dead) cardHtml += `<span class="card-back" style="background:red"></span>`;
            else cardHtml += `<span class="card-back"></span>`;
        });

        div.innerHTML = `
            <div><strong>${pl.name}</strong></div>
            <div>${pl.coins} Coins</div>
            <div>${cardHtml}</div>
        `;
        oppContainer.appendChild(div);
    });

    // Player Area (Only if Human is active or Pass & Play)
    const playerArea = document.getElementById('player-area');
    if (!p.isAI) {
        playerArea.classList.remove('hidden');
        document.getElementById('active-player-name').innerText = p.name;
        document.getElementById('player-coins').innerText = p.coins;
        
        const cardBox = document.getElementById('player-cards');
        cardBox.innerHTML = '';
        p.cards.forEach((c, idx) => {
            const cDiv = document.createElement('div');
            cDiv.className = `player-card ${c.dead ? 'dead' : ''}`;
            cDiv.innerText = c.role;
            cardBox.appendChild(cDiv);
        });
    } else {
        // If watching bots
         document.getElementById('active-player-name').innerText = `${p.name} (AI) is thinking...`;
    }
}

function setControls(active) {
    const btns = document.querySelectorAll('#action-panel button');
    btns.forEach(b => b.disabled = !active);
    }
