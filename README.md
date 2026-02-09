# Coup: The Resistance

A web-based implementation of the popular board game **Coup**, built with vanilla HTML, CSS, and JavaScript. Challenge your friends in "Pass & Play" mode or face off against AI opponents with adjustable difficulty levels.

[**Play the Live Demo**](https://armansoor.github.io/testcoup/)

## 🎮 Game Overview

In **Coup**, you are the head of a family in an Italian city-state run by a weak and corrupt court. You need to manipulate, bluff, and bribe your way to power. Your object is to destroy the influence of all other families, forcing them into exile. Only one family will survive.

### Key Features
-   **Single Player**: Play against up to 5 AI bots.
-   **Multiplayer**: "Pass & Play" support for up to 6 human players.
-   **Spectator Mode**: Watch AI vs AI battles unfold.
-   **Responsive Design**: Playable on desktop and mobile devices.
-   **Real-time Log**: Tracks every action, challenge, and block as it happens.
-   **Game History**: Download the full game log as a text file after the match ends.

## 🤖 AI Opponents

The game features advanced AI logic with four distinct difficulty levels to challenge players of all skills:

-   **Easy (Random)**: Makes random moves. Unpredictable but generally weak. Good for learning the mechanics.
-   **Normal (Balanced)**: Follows basic strategy. Takes Income/Tax when safe, Coups when rich, and blocks occasionally.
-   **Hard (Ruthless)**: Bluffs frequently, blocks aggressively, and tracks known cards to make informed Challenges. Will punish obvious bluffs.
-   **Hardcore (God Mode)**: Almost omniscient. Tracks every revealed card in the game (the "dead pile") to mathematically disprove impossible claims. Highly aggressive and calculated. Be prepared to lose!

## 🚀 How to Play

### Setup
1.  Open the game in your browser.
2.  Select the number of **Human Players**.
    -   *Select 0 to spectate a bot-only game.*
    -   *Select 2-6 for local "Pass & Play" multiplayer.*
3.  Select the number of **AI Players** (bots).
4.  Choose the **AI Difficulty**.
5.  Click **START GAME**.

### Multiplayer (Pass & Play)
When playing with multiple human players on the same device:
1.  The game will display whose turn it is (e.g., "Turn: Player 1").
2.  The active player should take the device and ensure only they can see the screen.
3.  After making their move and resolving any actions, they should pass the device to the next player.
4.  Be careful not to reveal your cards to opponents!

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

## 💡 Tips & Strategy

-   **Don't Bluff the Hardcore AI**: If the Hardcore AI challenges you, it's usually because it *knows* you're lying based on the visible cards.
-   **Use the Log**: The game log on the left (or top on mobile) is crucial for tracking who claimed what role earlier in the game.
-   **Coup Early**: If you have 7+ coins, consider launching a Coup to remove a threat without risk of being blocked.
-   **Watch for Patterns**: AI bots (especially on Normal/Hard) tend to follow logical patterns. Exploit their predictability!

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

## 📝 License

This project is open-source and available for personal and educational use. Enjoy the game!
