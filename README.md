# Coup: The Resistance

A web-based implementation of the popular board game **Coup**, built with vanilla HTML, CSS, and JavaScript. Challenge your friends in "Pass & Play" mode or face off against AI opponents with adjustable difficulty levels.

[**Play the Live Demo**](https://armansoor.github.io/testcoup/)

## 🎮 Game Overview

In **Coup**, you are the head of a family in an Italian city-state run by a weak and corrupt court. You need to manipulate, bluff, and bribe your way to power. Your object is to destroy the influence of all other families, forcing them into exile. Only one family will survive.

This implementation features:
-   **Single Player**: Play against AI bots.
-   **Multiplayer**: Support for up to 6 players in "Pass & Play" mode.
-   **AI Opponents**: Bots with different strategies and difficulty levels.
-   **Responsive Design**: Playable on desktop and mobile devices.

## ✨ Features

-   **5 Character Roles**: Duke, Assassin, Captain, Ambassador, Contessa.
-   **7 Actions**: Income, Foreign Aid, Coup, Tax, Assassinate, Steal, Exchange.
-   **AI Difficulty Levels**:
    -   **Easy**: Makes random moves.
    -   **Normal**: Balanced play, basic strategy.
    -   **Hard**: Aggressive, bluffs often, and challenges suspicious plays.
    -   **Hardcore**: "God Mode" – almost omniscient, ruthless, and highly calculated.
-   **Game Log**: Tracks all actions and events during the game.
-   **Downloadable Logs**: Save the game history as a text file after the match ends.

## 🚀 How to Play

### Setup
1.  Open the game in your browser.
2.  Select the number of **Human Players** (for local multiplayer) and **AI Players**.
3.  Choose the **AI Difficulty**.
4.  Click **START GAME**.

### Rules Summary
-   Each player starts with **2 coins** and **2 influence cards** (face down).
-   On your turn, choose an action.
-   **Character Actions** (Tax, Assassinate, Steal, Exchange) require claiming a specific character role. You can **bluff** if you don't have the card!
-   Other players can **Challenge** your claim.
    -   If caught lying, you lose a card.
    -   If you were telling the truth, the challenger loses a card.
-   Some actions can be **Blocked** by specific characters (e.g., Captain blocks Steal). Blocks can also be challenged.
-   The last player with influence (cards) wins!

### Actions & Counteractions
| Action | Effect | Cost | Claim | Blocked By |
| :--- | :--- | :--- | :--- | :--- |
| **Income** | Take 1 coin | - | - | - |
| **Foreign Aid** | Take 2 coins | - | - | Duke |
| **Coup** | Force a player to lose a card | 7 | - | - |
| **Tax** | Take 3 coins | - | Duke | - |
| **Assassinate** | Pay 3 coins to eliminate an influence | 3 | Assassin | Contessa |
| **Steal** | Take 2 coins from another player | - | Captain | Captain / Ambassador |
| **Exchange** | Draw 2 cards, return 2 to deck | - | Ambassador | - |

## 🛠️ Tech Stack

-   **HTML5**: Structure and layout.
-   **CSS3**: Styling, animations, and responsive design (Flexbox/Grid).
-   **JavaScript (ES6+)**: Game logic, AI behavior, DOM manipulation.

## 📂 Project Structure

```
.
├── index.html      # Main game interface and structure
├── script.js       # Core game logic, AI implementation, and UI updates
├── style.css       # Visual styling and responsive layout
└── README.md       # Project documentation
```

## 🔧 Installation & Running

Since this is a static web application, no build process is required.

### Local Execution
1.  Clone or download the repository.
2.  Open `index.html` in your web browser.

### Development Server (Optional)
For a better experience (avoiding CORS issues with some browsers/features), use a simple HTTP server:

**Using Python:**
```bash
# Python 3
python -m http.server 8000
```
Then navigate to `http://localhost:8000`.

**Using Node.js (http-server):**
```bash
npx http-server .
```

## 🤖 AI Logic

The AI decision-making process is handled in the `Player` class within `script.js`. Bots evaluate their hand, coin count, and the game state to choose actions. Higher difficulty levels incorporate:
-   **Bluffing Heuristics**: Calculating the risk/reward of lying about a role.
-   **Memory**: Tracking revealed cards to deduce probabilities.
-   **Aggression**: Prioritizing elimination of the strongest opponent.

## 📝 License

This project is open-source and available for personal and educational use. Enjoy the game!
