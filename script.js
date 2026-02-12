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
    turnPhase: 'ACTION_SELECT',
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
            if (this.coins >= 7) { this.doCoup(); return; }
            if (canAssassinate && (hasAssassin || Math.random() > 0.3)) {
                action = 'Assassinate';
            } else if (hasDuke || Math.random() > 0.4) {
                action = 'Tax';
            } else if (hasCaptain || Math.random() > 0.5) {
                action = 'Steal';
            } else {
                action = 'Foreign Aid';
            }
        } else if (this.difficulty === 'hard') {
            if (this.coins >= 7) { this.doCoup(); return; }
            else if (canAssassinate && (hasAssassin || Math.random() > 0.4)) action = 'Assassinate';
            else if (hasDuke || Math.random() > 0.3) action = 'Tax';
            else if (hasCaptain || Math.random() > 0.5) action = 'Steal';
            else action = 'Foreign Aid';
        } else if (this.difficulty === 'normal') {
            if (this.coins >= 7) { this.doCoup(); return; }
            if (hasDuke) action = 'Tax';
            else if (canAssassinate && hasAssassin) action = 'Assassinate';
            else if (hasCaptain) action = 'Steal';
            else action = 'Income';
        } else {
            const opts = ['Income', 'Foreign Aid', 'Tax'];
            if (this.coins >= 3) opts.push('Assassinate');
            action = opts[Math.floor(Math.random() * opts.length)];
        }

        let target = null;
        if (['Assassinate', 'Steal'].includes(action)) {
             target = getStrongestOpponent(this);
             if (!target) {
                 action = 'Income';
                 target = null;
             }
        }

        // Safety Check
        if (ACTIONS[action].cost > this.coins) {
             console.warn(`AI ${this.name} tried unaffordable action. Defaulting to Income.`);
             action = 'Income';
             target = null;
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
        if (actionObj.type !== 'Block' && !ACTIONS[actionObj.type].challengeable) return false;

        const bluffer = actionObj.player;
        let threshold = 0.8;
        if (this.difficulty === 'hard') threshold = 0.6;
        if (this.difficulty === 'hardcore') threshold = 0.4;

        if (bluffer.lastAction === actionObj.type && ACTIONS[actionObj.type].role) {
             threshold -= 0.2;
             if (actionObj.type === 'Exchange') threshold -= 0.1;
        }

        const claimedRole = actionObj.role || ACTIONS[actionObj.type]?.role;

        if (claimedRole) {
            const myCopies = this.cards.filter(c => c.role === claimedRole && !c.dead).length;
            let deadCopies = 0;
            gameState.players.forEach(p => {
                p.cards.forEach(c => { if(c.dead && c.role === claimedRole) deadCopies++; });
            });
            const totalKnown = myCopies + deadCopies;

            if ((this.difficulty === 'hard' || this.difficulty === 'hardcore') && totalKnown === 3) return true;

            if (this.difficulty === 'hardcore') {
                if (totalKnown === 2) return true;
                if (myCopies === 2) return true;
            }

            if (this.difficulty === 'hard') {
                if (myCopies === 2) return true;
            }

            if (claimedRole === 'Ambassador') {
                 if (myCopies === 2) return true;
                 if (myCopies === 1 && Math.random() > 0.7 && this.difficulty !== 'easy') return true;
            }
        }

        if (actionObj.type === 'Tax') {
            const myDukes = this.cards.filter(c => c.role === 'Duke' && !c.dead).length;
            if (myDukes === 2) return true;
            if ((this.difficulty === 'hard' || this.difficulty === 'hardcore') && myDukes === 1 && Math.random() > 0.5) return true;
        }

        return Math.random() > threshold;
    }

    // AI DECISION: Should I Block?
    shouldBlock(actionObj) {
        if (!this.alive || this.id === actionObj.player.id) return false;
        if (!ACTIONS[actionObj.type].blockable) return false;

        if (actionObj.target && actionObj.target.id !== this.id) {
             if (actionObj.type !== 'Foreign Aid') return false;
        }

        const blockerRoles = ACTIONS[actionObj.type].blockedBy;
        const hasBlocker = this.cards.some(c => blockerRoles.includes(c.role) && !c.dead);

        if (hasBlocker) return true;

        if (this.difficulty === 'hardcore') {
            if (actionObj.type === 'Assassinate') return true;
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
    isReplayMode = false;
    activeReplayData = [];

    // Create Deck
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
    try {
        const p = getCurrentPlayer();
        if (!p.alive) { nextTurn(); return; }

        log(`--- ${p.name}'s Turn ---`);
        updateUI();
        broadcastState();

        if (p.isAI) {
            p.decideAction();
        } else if (p.isRemote) {
            setControls(false);
        } else {
            // Local Human
            if (isNetworkGame) {
                if (p.id === myPlayerId) setControls(true);
                else setControls(false);
            } else {
                setControls(true);
            }
        }
    } catch(e) {
        console.error("Error in playTurn:", e);
        log("Error: " + e.message);
        alert("A critical error occurred. Please restart.");
    }
}

function submitAction(actionType) {
    const p = getCurrentPlayer();

    // Forced Coup Check
    if (p.coins >= 10 && actionType !== 'Coup') {
        alert("You have 10+ coins. You MUST Coup!");
        return;
    }

    // NETWORK CLIENT LOGIC
    if (isNetworkGame && !netState.isHost) {
        if (p.id !== myPlayerId) return;
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
        const targets = gameState.players.filter(pl => pl.id !== p.id && pl.alive);
        if (targets.length === 0) return;
        
        if (targets.length === 1) target = targets[0];
        else {
            let tName = prompt(`Target for ${actionType}? (${targets.map(t=>t.name).join(', ')})`);
            target = targets.find(t => t.name.toLowerCase() === (tName || "").toLowerCase());
            if (!target) target = targets[0];
        }
    }

    handleActionSubmit(actionType, p, target);
}

function handleActionSubmit(actionType, player, target = null) {
    try {
        setControls(false);
        gameState.currentAction = { type: actionType, player: player, target: target, challenge: null, block: null };
        player.lastAction = actionType;

        log(`${player.name} attempts to ${actionType}${target ? ' on ' + target.name : ''}.`);

        player.coins -= ACTIONS[actionType].cost;
        updateUI();
        broadcastState();

        processReactions();
    } catch(e) {
        console.error("Error in handleActionSubmit:", e);
        setControls(true);
    }
}

async function processReactions() {
    try {
        const action = gameState.currentAction;
        const actingP = action.player;

        // 1. Challenges
        if (ACTIONS[action.type].challengeable) {
            for (let p of gameState.players) {
                if (p.id === actingP.id || !p.alive) continue;

                let wantsChallenge = false;
                if (p.isAI) wantsChallenge = p.shouldChallenge(action);
                else wantsChallenge = await requestChallenge(p, action);

                if (wantsChallenge) {
                    log(`${p.name} CHALLENGES ${actingP.name}!`, 'important');
                    const won = await resolveChallenge(actingP, p, ACTIONS[action.type].role);
                    if (won) await resolveActionEffect();
                    else nextTurn();
                    return;
                }
            }
        }

        // 2. Blocks
        if (ACTIONS[action.type].blockable) {
            const potentialBlockers = (action.type === 'Foreign Aid')
                ? gameState.players.filter(pl => pl.id !== actingP.id && pl.alive)
                : (action.target ? [action.target] : []);

            for (let p of potentialBlockers) {
                let wantsBlock = false;
                if (p.isAI) wantsBlock = p.shouldBlock(action);
                else wantsBlock = await requestBlock(p, action);

                if (wantsBlock) {
                    const blockerRole = ACTIONS[action.type].blockedBy[0];
                    log(`${p.name} BLOCKS with ${blockerRole}!`);

                    const challengeAction = { type: 'Block', player: p, role: blockerRole };
                    for (let challenger of gameState.players) {
                        if (challenger.id === p.id || !challenger.alive) continue;

                        let wantsChallenge = false;
                        if (challenger.isAI) wantsChallenge = challenger.shouldChallenge(challengeAction);
                        else wantsChallenge = await requestChallenge(challenger, challengeAction);

                        if (wantsChallenge) {
                            log(`${challenger.name} CHALLENGES Block!`, 'important');
                            const won = await resolveChallenge(p, challenger, blockerRole);
                            if (!won) await resolveActionEffect();
                            else {
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

        await resolveActionEffect();
    } catch(e) {
        console.error("Error in processReactions:", e);
        nextTurn();
    }
}

async function resolveChallenge(claimedPlayer, challenger, claimedRole) {
    const hasCard = claimedPlayer.cards.some(c => c.role === claimedRole && !c.dead);

    if (hasCard) {
        log(`Challenge FAILED! ${claimedPlayer.name} HAS the ${claimedRole}!`, 'important');
        broadcastState();
        await sleep(1500);
        await loseInfluence(challenger);

        // Swap Card
        const cardIdx = claimedPlayer.cards.findIndex(c => c.role === claimedRole && !c.dead);
        const oldCard = claimedPlayer.cards[cardIdx];

        gameState.deck.push(oldCard);
        shuffle(gameState.deck);
        claimedPlayer.cards[cardIdx] = gameState.deck.pop();

        broadcastState();
        return true;
    } else {
        log(`${claimedPlayer.name} was BLUFFING! Action fails.`, 'important');
        if (gameState.currentAction &&
            gameState.currentAction.player.id === claimedPlayer.id &&
            gameState.currentAction.type === 'Assassinate') {
                log("Assassin refunded 3 coins.");
                claimedPlayer.coins += 3;
        }

        broadcastState();
        await sleep(1500);
        await loseInfluence(claimedPlayer);
        return false;
    }
}

async function resolveActionEffect() {
    try {
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
                const drawCount = Math.min(2, gameState.deck.length);
                const drawn = [];
                for(let i=0; i<drawCount; i++) drawn.push(gameState.deck.pop());
                p.cards.push(...drawn);

                log(`${p.name} exchanges cards...`);
                broadcastState();

                if(p.isAI) {
                    const alive = p.cards.filter(c => !c.dead);
                    const dead = p.cards.filter(c => c.dead);
                    shuffle(alive);

                    // Return drawn count
                    for(let i=0; i<drawCount; i++) gameState.deck.push(alive.pop());
                    shuffle(gameState.deck);
                    p.cards = [...alive, ...dead];
                } else {
                    const keptIndices = await requestExchange(p);
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
    } catch(e) {
        console.error("Error in resolveActionEffect:", e);
        nextTurn();
    }
}

// --- HISTORY & REPLAY ---

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

    history.unshift(entry);
    if (history.length > 20) history.pop();

    try {
        localStorage.setItem('coup_match_history', JSON.stringify(history));
    } catch(e) { console.error("Failed to save history", e); }
}

function showHistory() {
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.remove('active');
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
    document.getElementById('game-over-modal').classList.add('hidden');
    showHistory();
}

function closeHistory() {
    document.getElementById('history-screen').classList.remove('active');
    document.getElementById('lobby-screen').classList.add('active');
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

    isReplayMode = true;
    activeReplayData = entry.replayData;
    currentReplayIndex = 0;

    document.getElementById('history-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    document.getElementById('replay-controls').classList.remove('hidden');
    document.getElementById('quit-btn').classList.add('hidden');
    document.getElementById('exit-replay-btn').classList.remove('hidden');
    document.getElementById('action-panel').classList.add('hidden');

    renderReplayFrame();
}

function renderReplayFrame() {
    if (currentReplayIndex < 0) currentReplayIndex = 0;
    if (currentReplayIndex >= activeReplayData.length) currentReplayIndex = activeReplayData.length - 1;

    const state = activeReplayData[currentReplayIndex];
    syncClientState(state);

    document.getElementById('replay-step').innerText = `${currentReplayIndex + 1} / ${activeReplayData.length}`;
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

function captureReplaySnapshot() {
    if (!gameState.replayData) gameState.replayData = [];
    const s = serializeState();
    s.timestamp = Date.now();
    gameState.replayData.push(s);
}

// --- UTILS & UI ---

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
        yesBtn.onclick = () => { panel.classList.add('hidden'); resolve(true); };

        const noBtn = document.createElement('button');
        noBtn.innerText = 'Pass';
        noBtn.onclick = () => { panel.classList.add('hidden'); resolve(false); };

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
        yesBtn.onclick = () => { panel.classList.add('hidden'); resolve(true); };

        const noBtn = document.createElement('button');
        noBtn.innerText = 'Pass';
        noBtn.onclick = () => { panel.classList.add('hidden'); resolve(false); };

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
            btn.onclick = () => { panel.classList.add('hidden'); resolve(idx); };
            btns.appendChild(btn);
        });
    });
}

function askHumanExchange(player) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');

        const totalAlive = player.cards.filter(c => !c.dead).length;
        // Default keep count logic (assuming draw 2, so keep original count = total - 2)
        // But clamped to min 1
        let keepCount = totalAlive - 2;
        if (keepCount < 1) keepCount = 1;

        title.innerText = `${player.name}, select ${keepCount} card(s) to KEEP:`;
        btns.innerHTML = '';

        const aliveCards = [];
        player.cards.forEach(c => { if (!c.dead) aliveCards.push(c); });

        const selectedIndices = new Set();

        const confirmBtn = document.createElement('button');
        confirmBtn.innerText = `Confirm (0/${keepCount})`;
        confirmBtn.disabled = true;
        confirmBtn.onclick = () => {
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
        okBtn.onclick = () => { panel.classList.add('hidden'); resolve(); };
        btns.appendChild(okBtn);
    });
}

function updateUI() {
    try {
        const p = getCurrentPlayer();
        if (!p) return;

        document.getElementById('turn-indicator').innerText = `Turn: ${p.name}`;

        const oppContainer = document.getElementById('opponents-container');
        oppContainer.innerHTML = '';
        gameState.players.forEach(pl => {
            let shouldHide = false;
            if (isNetworkGame) {
                if (pl.id === myPlayerId) shouldHide = true;
            } else {
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

        const playerArea = document.getElementById('player-area');
        playerArea.classList.add('hidden');

        let me = null;
        if (isNetworkGame) me = gameState.players.find(pl => pl.id === myPlayerId);
        else {
            const humans = gameState.players.filter(pl => !pl.isAI);
            if (humans.length === 1) me = humans[0];
            else if (!p.isAI) me = p;
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
             playerArea.classList.remove('hidden');
             document.getElementById('active-player-name').innerText = `${p.name} (AI) is thinking...`;
             document.getElementById('player-cards').innerHTML = '';
        }
    } catch(e) { console.error("UI Error", e); }
}

function setControls(active) {
    const btns = document.querySelectorAll('#action-panel button');
    btns.forEach(b => {
        b.disabled = !active;
        b.classList.remove('disabled-force');
    });

    if (active) {
        const p = getCurrentPlayer();
        if (p && p.coins >= 10) {
             btns.forEach(b => {
                 if (b.innerText.indexOf('Coup') === -1) {
                     b.disabled = true;
                     b.classList.add('disabled-force');
                 }
             });
        }
    }
}

// --- UTILS ---

async function loseInfluence(player) {
    if (!player.alive || player.cards.every(c => c.dead)) return;

    if (player.isAI) {
        const aliveCards = player.cards.filter(c => !c.dead);
        if (aliveCards.length === 0) return;
        const toKill = aliveCards[Math.floor(Math.random() * aliveCards.length)];
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

function getCurrentPlayer() { return gameState.players[gameState.currentPlayerIndex]; }
function getStrongestOpponent(me) {
    const foes = gameState.players.filter(p => p.id !== me.id && p.alive);
    if (foes.length === 0) return null;
    return foes.sort((a,b) => b.coins - a.coins)[0];
}
function shuffle(array) {
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
function toggleRules() { document.getElementById('rules-modal').classList.toggle('hidden'); }
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

// --- NETWORK MODULE ---

let isNetworkGame = false;
let myPlayerId = null;
let netState = {
    peer: null,
    hostConn: null,
    clients: [],
    isHost: false,
    pendingRequests: {}
};

function initHost() {
    const name = document.getElementById('my-player-name').value.trim();
    if (name.length < 3 || name.length > 20) { alert("Name Error"); return; }
    if (name.includes(' ')) { alert("Name Error"); return; }

    isNetworkGame = true;
    netState.isHost = true;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('host-room-info').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Initializing Network...";

    netState.peer = new Peer();

    netState.peer.on('open', (id) => {
        document.getElementById('my-room-code').innerText = id;
        document.getElementById('connection-status').innerText = "Waiting for players...";
        document.getElementById('network-start-btn').classList.remove('hidden');
        updateLobbyList();
    });

    netState.peer.on('connection', (conn) => {
        conn.on('data', (data) => handleNetworkData(data, conn));
        conn.on('close', () => {
            netState.clients = netState.clients.filter(c => c.conn !== conn);
            updateLobbyList();
            broadcastLobbyUpdate();
            markPlayerDisconnected(conn.peer);
        });
    });
}

function joinGame() {
    const name = document.getElementById('my-player-name').value.trim();
    if (name.length < 3) { alert("Name Error"); return; }
    const hostId = document.getElementById('host-id-input').value.trim();
    if (!hostId) { alert("Please enter a Room Code"); return; }

    isNetworkGame = true;
    netState.isHost = false;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Connecting...";

    netState.peer = new Peer();
    netState.peer.on('open', (id) => {
        const conn = netState.peer.connect(hostId);
        netState.hostConn = conn;
        conn.on('open', () => {
            document.getElementById('connection-status').innerText = "Connected!";
            conn.send({ type: 'JOIN', name: name });
        });
        conn.on('data', (data) => handleNetworkData(data, conn));
        conn.on('close', () => { alert("Disconnected"); location.reload(); });
    });
}

function handleNetworkData(data, conn) {
    if (netState.isHost) {
        switch(data.type) {
            case 'JOIN':
                netState.clients.push({ id: conn.peer, conn: conn, name: data.name });
                updateLobbyList();
                broadcastLobbyUpdate();
                break;
            case 'ACTION':
                const p = gameState.players.find(pl => pl.peerId === conn.peer);
                if (p && gameState.players[gameState.currentPlayerIndex].id === p.id) {
                    let target = null;
                    if (data.targetId) target = gameState.players.find(pl => pl.id === data.targetId);
                    handleActionSubmit(data.action, p, target);
                }
                break;
            case 'INTERACTION_RESPONSE':
                if (netState.pendingRequests[data.reqId]) {
                    netState.pendingRequests[data.reqId](data.response);
                    delete netState.pendingRequests[data.reqId];
                }
                break;
        }
    } else {
        switch(data.type) {
            case 'LOBBY_UPDATE': updateClientLobby(data.players); break;
            case 'GAME_START': myPlayerId = data.playerId; setupClientGame(data.state); break;
            case 'STATE_UPDATE': syncClientState(data.state); break;
            case 'INTERACTION_REQUEST': handleInteractionRequest(data); break;
            case 'GAME_OVER': handleGameOver(data); break;
        }
    }
}

function handleGameOver(data) {
    document.getElementById('winner-name').innerText = `${data.winnerName} WINS!`;
    document.getElementById('game-end-message').innerText = `${data.isAI ? 'The Bot' : 'The Player'} has won.`;
    document.getElementById('game-over-modal').classList.remove('hidden');
    saveMatchHistory({ name: data.winnerName });
}

function updateLobbyList() {
    const list = document.getElementById('connected-players-list');
    list.innerHTML = '';
    if (netState.isHost) {
        const myName = document.getElementById('my-player-name').value.trim() || 'Host';
        const li = document.createElement('li');
        li.innerText = `${myName} (Host)`;
        li.style.color = '#4caf50';
        list.appendChild(li);
    }
    netState.clients.forEach(c => {
        const li = document.createElement('li');
        li.innerText = c.name;
        list.appendChild(li);
    });
    if (netState.isHost) {
        const aiCount = parseInt(document.getElementById('network-ai-count').value);
        for(let i=1; i<=aiCount; i++) {
            const li = document.createElement('li');
            li.innerText = `Bot ${i} (AI)`;
            li.style.color = '#aaa';
            list.appendChild(li);
        }
    }
}

function broadcastLobbyUpdate() {
    const hostName = document.getElementById('my-player-name').value.trim() || 'Host';
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
    netState.clients.forEach(c => { if(c.conn && c.conn.open) c.conn.send(msg); });
}

function startNetworkGame() {
    if (!netState.isHost) return;
    const aiCount = parseInt(document.getElementById('network-ai-count').value);
    if (netState.clients.length + aiCount < 1) {
        alert("Minimum 2 players!");
        return;
    }

    gameState.players = [];
    gameState.deck = [];
    gameState.log = [];
    gameState.replayData = [];
    isReplayMode = false;
    activeReplayData = [];

    ROLES.forEach(role => {
        for(let i=0; i<3; i++) gameState.deck.push({ role: role, dead: false });
    });
    shuffle(gameState.deck);

    const hostName = document.getElementById('my-player-name').value.trim();
    gameState.players.push(new Player(1, hostName, false));
    myPlayerId = 1;

    netState.clients.forEach((c, idx) => {
        const pid = idx + 2;
        const p = new Player(pid, c.name || `Player ${pid}`, false);
        p.isRemote = true;
        p.peerId = c.id;
        gameState.players.push(p);
    });

    const difficulty = document.getElementById('network-difficulty').value;
    const startId = gameState.players.length + 1;
    for(let i=0; i<aiCount; i++) {
        gameState.players.push(new Player(startId + i, `Bot ${i+1}`, true, difficulty));
    }

    gameState.players.forEach(p => { p.cards = [gameState.deck.pop(), gameState.deck.pop()]; });
    gameState.currentPlayerIndex = 0;

    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    netState.clients.forEach(c => {
        const p = gameState.players.find(pl => pl.peerId === c.id);
        c.conn.send({ type: 'GAME_START', playerId: p.id, state: serializeState() });
    });

    updateUI();
    playTurn();
}

function setupClientGame(initialState) {
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    gameState.replayData = [];
    syncClientState(initialState);
}

function serializeState() {
    const s = {
        players: gameState.players.map(p => ({
            id: p.id, name: p.name, coins: p.coins, cards: p.cards,
            isAI: p.isAI, alive: p.alive, lastAction: p.lastAction,
            isRemote: p.isRemote, peerId: p.peerId
        })),
        currentPlayerIndex: gameState.currentPlayerIndex,
        turnPhase: gameState.turnPhase,
        log: gameState.log,
        currentAction: null
    };
    if (gameState.currentAction) {
        s.currentAction = {
            type: gameState.currentAction.type,
            playerId: gameState.currentAction.player.id,
            targetId: gameState.currentAction.target ? gameState.currentAction.target.id : null,
            role: gameState.currentAction.role
        };
    }
    return s;
}

function syncClientState(remoteState) {
    gameState.log = remoteState.log;
    gameState.currentPlayerIndex = remoteState.currentPlayerIndex;
    gameState.turnPhase = remoteState.turnPhase;
    gameState.players = remoteState.players.map(rp => rp); // Plain objects on client

    if (remoteState.currentAction) {
        const p = gameState.players.find(pl => pl.id === remoteState.currentAction.playerId);
        const t = remoteState.currentAction.targetId ? gameState.players.find(pl => pl.id === remoteState.currentAction.targetId) : null;
        gameState.currentAction = {
            type: remoteState.currentAction.type,
            player: p, target: t, role: remoteState.currentAction.role
        };
    } else {
        gameState.currentAction = null;
    }

    const logBox = document.getElementById('game-log');
    logBox.innerHTML = '';
    gameState.log.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerText = msg;
        logBox.appendChild(div);
    });
    logBox.scrollTop = logBox.scrollHeight;

    updateUI();

    // Capture replay for Client
    if (!isReplayMode && isNetworkGame && !netState.isHost) {
        captureReplaySnapshot();
    }
}

function broadcastState() {
    if (!isReplayMode) captureReplaySnapshot();
    if (isNetworkGame && netState.isHost) {
        broadcast({ type: 'STATE_UPDATE', state: serializeState() });
    }
}

// --- INTERACTION WRAPPERS ---
function requestChallenge(player, actionObj) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'CHALLENGE', {
            playerId: player.id, actionPlayerId: actionObj.player.id,
            actionType: actionObj.type, role: actionObj.role
        });
    } else return askHumanChallenge(player, actionObj);
}
function requestBlock(player, actionObj) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'BLOCK', {
            playerId: player.id, actionPlayerId: actionObj.player.id,
            actionType: actionObj.type, role: actionObj.role,
            targetId: actionObj.target ? actionObj.target.id : null
        });
    } else return askHumanBlock(player, actionObj);
}
function requestLoseCard(player) {
    if (player.isRemote) return sendInteractionRequest(player, 'LOSE_CARD', { playerId: player.id });
    else return askHumanToLoseCard(player);
}
function requestExchange(player) {
    if (player.isRemote) return sendInteractionRequest(player, 'EXCHANGE', { playerId: player.id });
    else return askHumanExchange(player);
}
function sendInteractionRequest(player, type, args) {
    return new Promise(resolve => {
        const reqId = Date.now() + Math.random().toString();
        netState.pendingRequests[reqId] = resolve;
        const client = netState.clients.find(c => c.id === player.peerId);
        if (client && client.conn) {
            client.conn.send({ type: 'INTERACTION_REQUEST', reqId: reqId, requestType: type, args: args });
        } else resolve(null);
    });
}
function handleInteractionRequest(data) {
    const p = gameState.players.find(pl => pl.id === data.args.playerId);
    let response = null;
    switch(data.requestType) {
        case 'CHALLENGE':
            response = askHumanChallenge(p, { type: data.args.actionType, player: gameState.players.find(x=>x.id===data.args.actionPlayerId), role: data.args.role }).then(r=>r);
            break;
        case 'BLOCK':
             response = askHumanBlock(p, { type: data.args.actionType, player: gameState.players.find(x=>x.id===data.args.actionPlayerId), role: data.args.role }).then(r=>r);
             break;
        case 'LOSE_CARD': response = askHumanToLoseCard(p).then(r=>r); break;
        case 'EXCHANGE': response = askHumanExchange(p).then(r=>r); break;
    }
    // We need to await the promise before sending response!
    // But switch case above returns Promise object.
    // We need to await it.
    if (response) {
        response.then(res => {
            if (netState.hostConn) netState.hostConn.send({ type: 'INTERACTION_RESPONSE', reqId: data.reqId, response: res });
        });
    }
}
// Fix handleInteractionRequest above: the `await` was inside switch but `response` variable assignment is synchronous.
// I fixed it by using `.then`.

function markPlayerDisconnected(peerId) {
    if (!netState.isHost) return;
    const p = gameState.players.find(pl => pl.peerId === peerId);
    if (p) {
        log(`${p.name} disconnected.`, 'important');
        p.alive = false;
        p.cards.forEach(c => c.dead = true);
        broadcastState();
        updateUI();
        if (getCurrentPlayer().id === p.id) nextTurn();
    }
}

window.onbeforeunload = function() {
    if (isNetworkGame) return "Are you sure?";
};

// --- DIAGNOSTICS ---
window.runDiagnostics = function() {
    console.log("--- COUP DIAGNOSTICS ---");
    console.log("GameState:", gameState);
    try {
        JSON.stringify(serializeState());
        console.log("Serialization (State): OK");
    } catch(e) { console.error("Serialization (State): FAIL", e); }
    if (gameState.replayData) {
        console.log(`Replay Data: ${gameState.replayData.length} frames`);
        try { JSON.stringify(gameState.replayData); console.log("Serialization (Replay): OK"); }
        catch(e) { console.error("Serialization (Replay): FAIL", e); }
    }
    gameState.players.forEach(p => {
        if (p.coins < 0) console.error(`Player ${p.name} has negative coins!`);
        if (p.cards.some(c => !c.role)) console.error(`Player ${p.name} has invalid cards!`);
    });
    console.log("--- END ---");
    return "Check Console";
};
