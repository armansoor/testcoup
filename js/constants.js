// --- CONSTANTS ---

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
