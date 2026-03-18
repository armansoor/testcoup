// --- UI UPDATER ---
let uiUpdatePending = false;

function updateUI() {
    // ⚡ Bolt: Debounce UI updates to prevent layout thrashing and redundant re-renders.
    if (uiUpdatePending) return;
    uiUpdatePending = true;

    // Use requestAnimationFrame if available (Browser)
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
            performUpdateUI();
            uiUpdatePending = false;
        });
    } else {
        // Fallback for Test Environment (or very old browsers)
        // In tests with mocked setTimeout, this executes synchronously immediately, preserving test behavior.
        setTimeout(() => {
            performUpdateUI();
            uiUpdatePending = false;
        }, 0);
    }
}

function performUpdateUI() {
    const p = getCurrentPlayer();

    // Header
    const turnIndicator = document.getElementById('turn-indicator');
    if (turnIndicator) turnIndicator.innerText = `Turn: ${p.name}`;

    // Opponents
    const oppContainer = document.getElementById('opponents-container');
    if (!oppContainer) return; // Safety check

    oppContainer.innerHTML = '';
    // Use DocumentFragment to batch DOM updates and minimize reflows
    const oppFragment = document.createDocumentFragment();
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

        // Spectator View: Show everyone
        if (myPlayerId === -1) shouldHide = false;

        if (shouldHide) return;

        const div = document.createElement('div');
        div.className = `opponent-card ${pl.id === p.id ? 'active-turn' : ''}`;
        if (!pl.alive) div.style.opacity = 0.5;

        // Disconnected visual
        if (pl.peerId && isNetworkGame && netState.isHost) {
             const client = netState.clients.find(c => c.id === pl.peerId);
             if (client && client.status === 'disconnected') {
                 div.style.border = '2px dashed red';
             }
        }

        // SECURITY FIX: Prevent XSS via player name
        const nameDiv = document.createElement('div');
        const strong = document.createElement('strong');
        strong.innerText = pl.name;
        nameDiv.appendChild(strong);
        div.appendChild(nameDiv);

        const coinsDiv = document.createElement('div');
        coinsDiv.innerText = `${pl.coins} Coins`;
        div.appendChild(coinsDiv);

        const cardsDiv = document.createElement('div');
        pl.cards.forEach(c => {
            if (!c) return;
            const span = document.createElement('span');
            span.className = 'card-back';
            if (c.dead) {
                span.classList.add('dead');
            } else if (isReplayMode) {
                span.classList.add('replay-card');
                // Apply styles directly to avoid innerHTML usage
                span.style.width = 'auto';
                span.style.minWidth = '30px';
                span.style.background = '#ddd';
                span.style.color = '#000';
                span.style.fontSize = '0.5rem';
                span.style.lineHeight = '38px';
                span.style.overflow = 'hidden';
                span.style.verticalAlign = 'middle';

                span.innerText = c.role.substr(0, 3);
            }
            cardsDiv.appendChild(span);
        });
        div.appendChild(cardsDiv);

        // OPTIMIZATION: Removed redundant innerHTML overwrite and premature append to oppContainer.
        // This prevents XSS (by using creating elements above) and improves performance (batching).
        oppFragment.appendChild(div);
    });
    oppContainer.appendChild(oppFragment);

    // Player Area
    const playerArea = document.getElementById('player-area');
    playerArea.classList.add('hidden'); // Default hidden

    let me = null;
    if (isNetworkGame) {
        if (myPlayerId !== -1) {
             me = gameState.players.find(pl => pl.id === myPlayerId);
        }
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
        // Batch card updates
        const cardFragment = document.createDocumentFragment();
        me.cards.forEach((c, idx) => {
            if (!c) return;
            const cDiv = document.createElement('div');
            const roleClass = c.role ? `role-${c.role.toLowerCase()}` : '';
            cDiv.className = `player-card ${roleClass} ${c.dead ? 'dead' : ''}`;
            cDiv.innerText = c.role;
            cardFragment.appendChild(cDiv);
        });
        cardBox.appendChild(cardFragment);
    } else {
         // Watching bots only or Spectator
         if (myPlayerId === -1) {
             // Spectator
             playerArea.classList.add('hidden'); // Hide player area for spectator entirely?
             // Or maybe show "Spectating..."
         } else {
             playerArea.classList.remove('hidden');
             document.getElementById('active-player-name').innerText = `${p.name} (AI) is thinking...`;
             document.getElementById('player-cards').innerHTML = '';
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

        const safeWinner = sanitize(entry.winner);
        const safePlayers = entry.players.map(p => sanitize(p)).join(', ');

        div.innerHTML = `
            <div style="font-weight:bold; color:#4caf50;">Winner: ${safeWinner}</div>
            <div style="font-size:0.8rem; color:#aaa;">${date}</div>
            <div style="font-size:0.8rem;">Players: ${safePlayers}</div>
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

        let roleName = actionObj.role;
        if (!roleName && ACTIONS[actionObj.type]) {
            roleName = ACTIONS[actionObj.type].role;
        }

        let msg = `${player.name}, do you want to Challenge ${actionObj.player.name}'s ${actionObj.type}`;
        if (roleName) msg += ` (claims ${roleName})`;
        msg += `?`;

        title.innerText = msg;
        btns.innerHTML = '';

        // Start Timer (if available)
        if (typeof startReactionTimer === 'function') {
            startReactionTimer(() => {
                // On Timeout
                panel.classList.add('hidden');
                resolve(false); // Auto-pass
            });
        }

        const yesBtn = document.createElement('button');
        yesBtn.innerText = 'Challenge!';
        yesBtn.className = 'red';
        yesBtn.onclick = () => {
            if (typeof clearReactionTimer === 'function') clearReactionTimer();
            panel.classList.add('hidden');
            resolve(true);
        };

        const noBtn = document.createElement('button');
        noBtn.innerText = 'Pass';
        noBtn.onclick = () => {
            if (typeof clearReactionTimer === 'function') clearReactionTimer();
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
        const blockerRoles = ACTIONS[actionObj.type].blockedBy;
        const blockerRolesStr = blockerRoles.join(' or ');
        title.innerText = `${player.name}, do you want to Block ${actionObj.type} (claims ${blockerRolesStr})?`;
        btns.innerHTML = '';

        // Start Timer (if available)
        if (typeof startReactionTimer === 'function') {
            startReactionTimer(() => {
                // On Timeout
                panel.classList.add('hidden');
                resolve(false); // Auto-pass
            });
        }

        // Create a button for each possible blocking role
        blockerRoles.forEach(role => {
            const btn = document.createElement('button');
            btn.innerText = `Block with ${role}`;
            const roleClass = role ? `role-${role.toLowerCase()}` : '';
            btn.className = roleClass;
            btn.onclick = () => {
                if (typeof clearReactionTimer === 'function') clearReactionTimer();
                panel.classList.add('hidden');
                resolve(role); // Resolve with the specific Role Name
            };
            btns.appendChild(btn);
        });

        const noBtn = document.createElement('button');
        noBtn.innerText = 'Pass';
        noBtn.onclick = () => {
            if (typeof clearReactionTimer === 'function') clearReactionTimer();
            panel.classList.add('hidden');
            resolve(false);
        };

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
            if (!card || card.dead) return;

            const btn = document.createElement('button');
            btn.innerText = card.role;
            const roleClass = card.role ? `role-${card.role.toLowerCase()}` : '';
            btn.className = `red ${roleClass}`; // Append role class for optional styling
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

function askHumanExchange(player, cardsToChoose, keepCount = 1) {
    return new Promise(resolve => {
        const panel = document.getElementById('reaction-panel');
        const title = document.getElementById('reaction-title');
        const btns = document.getElementById('reaction-buttons');

        panel.classList.remove('hidden');

        // Logic: Keep same number of ALIVE cards.
        // cardsToChoose contains (Original Alive + Drawn).
        // keepCount is explicitly provided by the core logic.

        // Sanity Check
        if (keepCount === undefined || keepCount === null || keepCount <= 0) {
             console.warn("UI askHumanExchange: keepCount invalid", keepCount);
             keepCount = 1;
        }

        title.innerText = `${player.name}, select ${keepCount} card(s) to KEEP:`;
        btns.innerHTML = '';

        const availableCards = cardsToChoose;

        // Selected IDs (using card.id for robustness)
        const selectedIds = new Set();

        const confirmBtn = document.createElement('button');
        confirmBtn.innerText = `Confirm (0/${keepCount})`;
        confirmBtn.disabled = true;
        confirmBtn.onclick = () => {
            // Return selected IDs
            panel.classList.add('hidden');
            resolve(Array.from(selectedIds));
        };

        const cardContainer = document.createElement('div');
        cardContainer.style.display = 'flex';
        cardContainer.style.gap = '10px';
        cardContainer.style.justifyContent = 'center';
        cardContainer.style.marginBottom = '10px';
        cardContainer.style.flexWrap = 'wrap'; // Ensure responsiveness

        availableCards.forEach((card, idx) => {
            const cDiv = document.createElement('div');
            const roleClass = card.role ? `role-${card.role.toLowerCase()}` : '';
            cDiv.className = `player-card ${roleClass}`;
            cDiv.innerText = card.role;
            cDiv.onclick = () => {
                if (selectedIds.has(card.id)) {
                    selectedIds.delete(card.id);
                    cDiv.classList.remove('selected');
                } else {
                    if (selectedIds.size < keepCount) {
                        selectedIds.add(card.id);
                        cDiv.classList.add('selected');
                    }
                }

                confirmBtn.innerText = `Confirm (${selectedIds.size}/${keepCount})`;
                confirmBtn.disabled = selectedIds.size !== keepCount;
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

function setupGameOverUI(winnerName, isAI) {
    document.getElementById('winner-name').innerText = `${winnerName} WINS!`;
    document.getElementById('game-end-message').innerText = `${isAI ? 'The Bot' : 'The Player'} has won.`;

    const actionContainer = document.getElementById('game-over-actions');
    actionContainer.innerHTML = ''; // Clear previous buttons

    // Common Buttons
    const downloadBtn = document.createElement('button');
    downloadBtn.innerText = 'Download Game Log';
    downloadBtn.onclick = downloadLog;
    actionContainer.appendChild(downloadBtn);

    const historyBtn = document.createElement('button');
    historyBtn.className = 'secondary';
    historyBtn.innerText = 'View Match History';
    historyBtn.onclick = showHistoryFromModal;
    actionContainer.appendChild(historyBtn);

    // Dynamic Context Buttons
    if (isNetworkGame) {
        if (netState.isHost) {
            // Host Controls
            const playAgainBtn = document.createElement('button');
            playAgainBtn.className = 'secondary';
            playAgainBtn.innerText = 'Play Again (Restart)';
            playAgainBtn.onclick = () => {
                document.getElementById('game-over-modal').classList.add('hidden');
                startNetworkGame();
            };
            actionContainer.appendChild(playAgainBtn);

            const disconnectBtn = document.createElement('button');
            disconnectBtn.className = 'secondary red'; // Optional red styling
            disconnectBtn.innerText = 'Disconnect';
            disconnectBtn.onclick = () => location.reload();
            actionContainer.appendChild(disconnectBtn);

        } else {
            // Client Controls
            const waitingBtn = document.createElement('button');
            waitingBtn.className = 'secondary';
            waitingBtn.innerText = 'Waiting for Host...';
            waitingBtn.disabled = true;
            waitingBtn.style.opacity = '0.7';
            actionContainer.appendChild(waitingBtn);

            const disconnectBtn = document.createElement('button');
            disconnectBtn.className = 'secondary red';
            disconnectBtn.innerText = 'Disconnect';
            disconnectBtn.onclick = () => location.reload();
            actionContainer.appendChild(disconnectBtn);
        }
    } else {
        // Local / Single Player
        const playAgainBtn = document.createElement('button');
        playAgainBtn.className = 'secondary';
        playAgainBtn.innerText = 'Play Again';
        playAgainBtn.onclick = () => location.reload();
        actionContainer.appendChild(playAgainBtn);
    }

    document.getElementById('game-over-modal').classList.remove('hidden');
}
