// Main Game Entry Point - Aggregates Core Modules
// This file is now a shell that delegates to Core Modules,
// or we can just remove it if index.html loads the new files.
// However, to keep existing calls working without changing EVERY function signature globally,
// we ensure the functions are globally available.

// Since the new files define functions in the global scope (window),
// `game.js` can simply contain the remaining utility or glue code,
// OR act as the "Interaction Handler" for network requests which was previously inside it.

// --- INTERACTION REQUEST HANDLER (Client) ---
async function handleInteractionRequest(data) {
    // data = { reqId, requestType, args }
    const p = gameState.players.find(pl => pl.id === data.args.playerId);
    let response = null;

    switch(data.requestType) {
        case 'CHALLENGE': {
            const actor = gameState.players.find(pl => pl.id === data.args.actionPlayerId);
            const actionObj = {
                type: data.args.actionType,
                player: actor,
                role: data.args.role
            };
            response = await askHumanChallenge(p, actionObj);
            break;
        }
        case 'BLOCK': {
            const actorB = gameState.players.find(pl => pl.id === data.args.actionPlayerId);
            const actionObjB = {
                type: data.args.actionType,
                player: actorB,
                role: data.args.role,
                target: data.args.targetId ? gameState.players.find(pl => pl.id === data.args.targetId) : null
            };
            response = await askHumanBlock(p, actionObjB);
            break;
        }
        case 'LOSE_CARD':
            response = await askHumanToLoseCard(p);
            break;

        case 'EXCHANGE':
            response = await askHumanExchange(p);
            break;
    }

    if (netState.hostConn && netState.hostConn.open) {
        netState.hostConn.send({
            type: 'INTERACTION_RESPONSE',
            reqId: data.reqId,
            response: response
        });
    }
}
