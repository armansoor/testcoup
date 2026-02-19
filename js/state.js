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

var turnTimer = null;
var TURN_LIMIT_SECONDS = 180;
var REACTION_LIMIT_SECONDS = 45;
var reactionTimer = null;
var lastWinnerName = null;

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
        return this.cards.some(c => c && c.role === role && !c.dead);
    }

    // AI LOGIC CORE
    async decideAction() {
        if (!this.alive) return;

        try {
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
        if (this.difficulty === 'broken') {
             // 1. Coup (Unblockable win condition)
             if (this.coins >= 7) {
                 this.doCoup();
                 return;
             }

             // PEAK AHEAD (Cheat): Check Deck
             const topCards = gameState.deck.slice(-2);
             const goodCards = ['Duke', 'Captain', 'Assassin', 'Contessa'];
             const hasBadHand = this.cards.every(c => c.dead || !goodCards.includes(c.role));

             // Exchange Priority: If hand is weak AND deck has good cards
             if (hasBadHand && topCards.some(c => goodCards.includes(c.role))) {
                 action = 'Exchange';
             }
             // Assassinate Logic: Kill if target has NO Contessa
             else if (this.coins >= 3) {
                 // Find target with NO Contessa
                 let target = null;
                 // Prioritize strongest opponent who is vulnerable
                 const opponents = gameState.players.filter(p => p.id !== this.id && p.alive);
                 // Sort by threat (cards > coins)
                 opponents.sort((a, b) => {
                     const aCards = a.cards.filter(c => !c.dead).length;
                     const bCards = b.cards.filter(c => !c.dead).length;
                     if (aCards !== bCards) return bCards - aCards;
                     return b.coins - a.coins;
                 });

                 for (let op of opponents) {
                     const hasContessa = op.cards.some(c => c.role === 'Contessa' && !c.dead);
                     if (!hasContessa) {
                         target = op;
                         break;
                     }
                 }

                 if (target) {
                     handleActionSubmit('Assassinate', this, target);
                     return;
                 }
                 // If all targets have Contessa, fall through to other actions (don't waste 3 coins)
             }

             // Steal Logic: Steal if target has NO Captain/Ambassador (Safe Steal)
             // Check if we already decided on an action (like Exchange)
             if (action === 'Income') {
                 let target = null;
                 const opponents = gameState.players.filter(p => p.id !== this.id && p.alive && p.coins >= 2);
                 // Sort by most coins to steal
                 opponents.sort((a, b) => b.coins - a.coins);

                 for (let op of opponents) {
                     const hasBlocker = op.cards.some(c => (c.role === 'Captain' || c.role === 'Ambassador') && !c.dead);
                     if (!hasBlocker) {
                         target = op;
                         break;
                     }
                 }

                 if (target) {
                     // Only steal if I HAVE Captain OR if I have < 3 coins (desperate)
                     const hasCaptain = this.hasRole('Captain');
                     if (hasCaptain || this.coins < 3) {
                         handleActionSubmit('Steal', this, target);
                         return;
                     }
                 }
             }

             // Tax Logic: Always good, unless someone has 2 Dukes (proof)
             if (action === 'Income') {
                  // Check for 2 Dukes in one hand
                  let danger = false;
                  gameState.players.forEach(p => {
                      if (p.id !== this.id && p.alive) {
                          const dukes = p.cards.filter(c => c.role === 'Duke' && !c.dead).length;
                          if (dukes === 2) danger = true;
                      }
                  });

                  if (!danger) {
                      action = 'Tax';
                  } else {
                      // If dangerous to Tax (someone has proof)
                      action = 'Exchange';
                  }
             }

             handleActionSubmit(action, this, null);
             return;
        } else if (this.difficulty === 'hardcore') {
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
        } catch (e) {
            console.error("AI Logic Error:", e);
            log(`AI Error: ${e.message}`, 'important');
            // Fallback to Income to prevent hang
            handleActionSubmit('Income', this, null);
        }
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

        if (this.difficulty === 'broken' && claimedRole) {
            const actor = actionObj.player;
            const hasCard = actor.cards.some(c => c.role === claimedRole && !c.dead);
            if (!hasCard) return true; // They are lying! Challenge!
            return false; // They are telling the truth. Never challenge.
        }

        if (claimedRole) {
            const myCopies = this.cards.filter(c => c && c.role === claimedRole && !c.dead).length;

            // Check Public Knowledge (Dead cards)
            let deadCopies = 0;
            gameState.players.forEach(p => {
                p.cards.forEach(c => { if(c && c.dead && c.role === claimedRole) deadCopies++; });
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
        const hasBlocker = this.cards.some(c => c && blockerRoles.includes(c.role) && !c.dead);

        if (hasBlocker) {
            // Return the specific role I have
            const validCard = this.cards.find(c => c && blockerRoles.includes(c.role) && !c.dead);
            return validCard.role;
        }

        // Bluff block?
        let shouldBluff = false;

        if (this.difficulty === 'broken') {
             // Fatal check: Assassinate
            if (actionObj.type === 'Assassinate') shouldBluff = true; // Must block to survive
            // Steal: Only if desperate
            if (actionObj.type === 'Steal' && this.coins <= 1) shouldBluff = true;
        }

        // Hardcore: Block almost always if targeted by assassination (to survive)
        if (this.difficulty === 'hardcore') {
            if (actionObj.type === 'Assassinate') shouldBluff = true; // Desperate block
            if (actionObj.type === 'Steal' && Math.random() > 0.3) shouldBluff = true;
            if (actionObj.type === 'Foreign Aid' && Math.random() > 0.5) shouldBluff = true;
        }

        if (this.difficulty === 'hard' && actionObj.type === 'Assassinate' && Math.random() > 0.2) shouldBluff = true;
        if (this.difficulty === 'hard' && actionObj.type === 'Steal' && Math.random() > 0.5) shouldBluff = true;

        if (shouldBluff) {
            // Pick a random valid blocker role to claim
            const randomRole = blockerRoles[Math.floor(Math.random() * blockerRoles.length)];
            return randomRole;
        }

        return false;
    }
}
