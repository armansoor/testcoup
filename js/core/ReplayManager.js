// Replay Management

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
