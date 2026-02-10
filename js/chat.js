function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    let myName = 'Me';
    if (isNetworkGame) {
         myName = document.getElementById('my-player-name').value.trim();
    } else {
         // Local game, use active player? No, chat is mainly for network.
         // But we can support it for fun.
         myName = getCurrentPlayer() ? getCurrentPlayer().name : 'Player';
    }

    addChatMessage(myName, msg);
    input.value = '';

    if (isNetworkGame) {
        const payload = { type: 'CHAT', sender: myName, message: msg };

        if (netState.isHost) {
            broadcast(payload);
        } else {
            // Client sends to Host, Host broadcasts
            if (netState.hostConn) netState.hostConn.send(payload);
        }
    } else {
        // Local echo for fun (Pass & Play)
        // No network send
    }
}

function addChatMessage(sender, msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<strong>${sender}:</strong> ${msg}`;

    const box = document.getElementById('chat-messages');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;

    if (window.audio) window.audio.playChat();
}

// Enter key support
document.getElementById('chat-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendChat();
});
