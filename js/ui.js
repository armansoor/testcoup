function log(msg, type='') {
    gameState.log.push(msg);
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.innerText = msg;
    const box = document.getElementById('game-log');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;

    // Audio Cues based on message content
    if (window.audio) {
        if (type === 'important' || msg.includes('ELIMINATED')) window.audio.playLose();
        else if (msg.includes('WINS')) window.audio.playWin();
        else if (msg.includes('BLOCKS') || msg.includes('CHALLENGES')) window.audio.playError(); // Alert sound
        else if (msg.includes('Income') || msg.includes('Foreign Aid') || msg.includes('Tax') || msg.includes('Steal')) {
             // Subtle click for regular actions
             window.audio.playClick();
        }
    }

    // Visual Shake for negative events
    // if (msg.includes('BLOCKS') || msg.includes('CHALLENGES') || msg.includes('lost a')) {
    //    triggerAnimation(document.body, 'anim-shake');
    // }
    // Red Flash for elimination
    if (msg.includes('ELIMINATED')) {
        triggerAnimation(document.body, 'anim-flash');
    }
}

function triggerAnimation(element, animClass) {
    if (!element) return;
    element.classList.remove(animClass);
    void element.offsetWidth; // Trigger reflow
    element.classList.add(animClass);
}

function spawnFloatingText(text, targetElement) {
    if (!targetElement) return;
    const rect = targetElement.getBoundingClientRect();

    const span = document.createElement('span');
    span.innerText = text;
    span.className = 'floating-text';
    span.style.left = `${rect.left + rect.width/2}px`;
    span.style.top = `${rect.top}px`;

    document.body.appendChild(span);

    // Cleanup
    setTimeout(() => {
        if (span.parentNode) span.parentNode.removeChild(span);
    }, 1000);
}

function toggleRules() {
    document.getElementById('rules-modal').classList.toggle('hidden');
}

// --- PASS & PLAY SCREEN ---
function showPassDeviceScreen(nextPlayer) {
    const screen = document.getElementById('pass-device-screen');
    const nameSpan = document.getElementById('next-player-name');
    const btn = document.getElementById('i-am-ready-btn');

    screen.classList.remove('hidden');
    nameSpan.innerText = nextPlayer.name;
    btn.innerText = `I am ${nextPlayer.name}`;

    // Set up one-time click handler
    btn.onclick = () => {
        screen.classList.add('hidden');
        // Resume game flow
        playTurn();
    };
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

        // Coin Animation Logic
        const oldCoins = parseInt(document.getElementById('player-coins').innerText);
        if (oldCoins < me.coins) {
             if (window.audio) window.audio.playCoin();
             // Spawn Floating Text
             const diff = me.coins - oldCoins;
             spawnFloatingText(`+${diff}`, document.querySelector('.coins-display'));
        }

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

// --- PWA INSTALL BUTTON ---
let deferredPrompt;

function setupInstallButton() {
    const installBtn = document.getElementById('install-pwa-btn');
    if (!installBtn) return;

    installBtn.style.display = 'none'; // Hidden by default

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the mini-infobar from appearing on mobile
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Update UI notify the user they can install the PWA
        installBtn.style.display = 'block';

        installBtn.addEventListener('click', () => {
            // Hide the app provided install promotion
            installBtn.style.display = 'none';
            // Show the install prompt
            deferredPrompt.prompt();
            // Wait for the user to respond to the prompt
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted the install prompt');
                } else {
                    console.log('User dismissed the install prompt');
                }
                deferredPrompt = null;
            });
        });
    });

    window.addEventListener('appinstalled', () => {
        // Log install to analytics
        console.log('PWA was installed');
        installBtn.style.display = 'none';
    });
}
