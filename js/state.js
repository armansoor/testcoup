// --- GAME STATE & CLASSES ---

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

/**
 * Returns the current active player object.
 */
function getCurrentPlayer() {
    return gameState.players[gameState.currentPlayerIndex];
}

/**
 * Finds the strongest opponent for AI targeting.
 * @param {Player} me
 */
function getStrongestOpponent(me) {
    // Target player with most coins or most cards
    const foes = gameState.players.filter(p => p.id !== me.id && p.alive);
    return foes.sort((a,b) => b.coins - a.coins)[0];
}

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
