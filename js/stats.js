
const ACHIEVEMENTS = [
    { id: 'first_win', name: 'First Victory', desc: 'Win your first game' },
    { id: 'win_streak_3', name: 'On Fire', desc: 'Win 3 games in a row' },
    { id: 'pacifist', name: 'Pacifist', desc: 'Win without performing a Coup' },
    { id: 'rich_kid', name: 'Rich Kid', desc: 'Win with 10+ coins' },
    { id: 'broke_winner', name: 'Broke Winner', desc: 'Win with 0 coins' },
    { id: 'perfect_game', name: 'Perfect Game', desc: 'Win without losing any cards' },
    { id: 'duke_lover', name: 'Duke Lover', desc: 'Claim Duke 5 times in a game' },
    { id: 'assassin_creed', name: 'Assassins Creed', desc: 'Successfully Assassinate 3 times in a game' },
    { id: 'master_thief', name: 'Master Thief', desc: 'Steal 10+ coins total' },
    { id: 'unshakeable', name: 'Unshakeable', desc: 'Win after being successfully blocked' },
    { id: 'caught_red_handed', name: 'Caught Red Handed', desc: 'Win after losing a challenge' },
    { id: 'contessa_block', name: 'Not Today', desc: 'Block an assassination with Contessa' },
    { id: 'ambassador_shuffle', name: 'The Diplomat', desc: 'Exchange cards 3 times' },
    { id: 'foreign_aid_spammer', name: 'Foreign Aid Spammer', desc: 'Take Foreign Aid 5 times' },
    { id: 'coup_master', name: 'Coup Master', desc: 'Perform 3 Coups in one game' },
    { id: 'lucky_survivor', name: 'Lucky Survivor', desc: 'Win with only 1 card left' },
    { id: 'bot_slayer', name: 'Bot Slayer', desc: 'Defeat 3 AI bots in one game' },
    { id: 'hardcore_champ', name: 'Hardcore Champion', desc: 'Win a game on Hardcore difficulty' },
    { id: 'tax_evader', name: 'Tax Evader', desc: 'Successfully block Foreign Aid as Duke' },
    { id: 'generous', name: 'Generous', desc: 'Allow someone to take Foreign Aid (don\'t block)' },
    { id: 'truth_teller', name: 'Truth Teller', desc: 'Win a challenge as the defender' },
    { id: 'lie_detector', name: 'Lie Detector', desc: 'Win a challenge as the challenger' },
    { id: 'double_agent', name: 'Double Agent', desc: 'Win with 2 of the same role (e.g. 2 Dukes)' },
    { id: 'veteran', name: 'Veteran', desc: 'Play 50 games' }
];

let playerStats = {
    gamesPlayed: 0,
    gamesWon: 0,
    streak: 0,
    achievements: [], // List of IDs
    history: []
};

function loadStats() {
    try {
        const s = localStorage.getItem('coup_stats');
        if (s) {
            playerStats = JSON.parse(s);
        }
    } catch (e) {
        console.error("Failed to load stats:", e);
        playerStats = {
            gamesPlayed: 0,
            gamesWon: 0,
            streak: 0,
            achievements: [],
            history: []
        };
    }
}

function saveStats() {
    localStorage.setItem('coup_stats', JSON.stringify(playerStats));
}

function unlockAchievement(id) {
    if (!playerStats.achievements.includes(id)) {
        playerStats.achievements.push(id);
        // Show notification (simple log for now, or toast)
        log(`🏆 ACHIEVEMENT UNLOCKED: ${ACHIEVEMENTS.find(a=>a.id===id).name}`, 'important');
        if (window.audio) window.audio.playWin(); // Celebrate
    }
}

// Check Logic called at Game Over
function checkGameEndAchievements(winner) {
    const human = gameState.players.find(p => !p.isAI && p.id === myPlayerId); // Local human in single player
    if (!human) return; // Spectator or MP Client? (MP stats tricky without accounts)

    // Only track stats for Single Player or Pass & Play Player 1
    if (isNetworkGame && !netState.isHost) return; // Simple: Host/SP only for now to avoid complexity

    playerStats.gamesPlayed++;

    const isWinner = winner.id === human.id;

    if (isWinner) {
        playerStats.gamesWon++;
        playerStats.streak++;
        unlockAchievement('first_win');

        if (playerStats.streak >= 3) unlockAchievement('win_streak_3');
        if (human.coins >= 10) unlockAchievement('rich_kid');
        if (human.coins === 0) unlockAchievement('broke_winner');
        if (human.cards.filter(c => !c.dead).length === 2) unlockAchievement('perfect_game');
        if (human.cards.filter(c => !c.dead).length === 1) unlockAchievement('lucky_survivor');

        // Difficulty Check
        const diff = document.getElementById('difficulty').value;
        if (diff === 'hardcore') unlockAchievement('hardcore_champ');

        // Check Roles
        const alive = human.cards.filter(c => !c.dead);
        if (alive.length === 2 && alive[0].role === alive[1].role) unlockAchievement('double_agent');

    } else {
        playerStats.streak = 0;
    }

    if (playerStats.gamesPlayed >= 50) unlockAchievement('veteran');

    saveStats();
}

function showStatsModal() {
    loadStats();

    // Create Modal HTML dynamically if not exists
    let modal = document.getElementById('stats-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'stats-modal';
        modal.className = 'modal hidden';
        modal.style.zIndex = '2000'; // Ensure it is on top of everything
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <h2>Stats & Achievements</h2>
                <div id="stats-summary" style="margin-bottom: 20px; font-size: 1.1rem;"></div>
                <h3>Achievements</h3>
                <div id="achievements-list" style="text-align: left; display: grid; gap: 10px;"></div>
                <button onclick="document.getElementById('stats-modal').classList.add('hidden')" style="margin-top: 20px;">Close</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Populate
    const summary = document.getElementById('stats-summary');
    summary.innerHTML = `
        <p>Games Played: ${playerStats.gamesPlayed}</p>
        <p>Games Won: ${playerStats.gamesWon}</p>
        <p>Win Rate: ${playerStats.gamesPlayed ? Math.round((playerStats.gamesWon/playerStats.gamesPlayed)*100) : 0}%</p>
        <p>Current Streak: ${playerStats.streak}</p>
        <p>Achievements: ${playerStats.achievements.length} / ${ACHIEVEMENTS.length}</p>
    `;

    const list = document.getElementById('achievements-list');
    list.innerHTML = '';

    ACHIEVEMENTS.forEach(ach => {
        const unlocked = playerStats.achievements.includes(ach.id);
        const div = document.createElement('div');
        div.className = `achievement-item ${unlocked ? 'unlocked' : 'locked'}`;
        div.style.padding = '10px';
        div.style.background = unlocked ? '#2e7d32' : '#333';
        div.style.border = '1px solid #444';
        div.style.borderRadius = '5px';
        div.style.opacity = unlocked ? '1' : '0.6';

        div.innerHTML = `
            <div style="font-weight: bold;">${ach.name} ${unlocked ? '✅' : '🔒'}</div>
            <div style="font-size: 0.8rem;">${ach.desc}</div>
        `;
        list.appendChild(div);
    });

    modal.classList.remove('hidden');
}

// Load stats on startup
loadStats();
