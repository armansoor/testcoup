// --- ERROR HANDLING & STABILITY ---

window.onbeforeunload = function() {
    if (isNetworkGame) {
        return "Are you sure you want to leave the game?";
    }
};
