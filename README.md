# Coup: The Resistance

A web-based implementation of the popular board game **Coup**, built with vanilla HTML, CSS, and JavaScript. Challenge your friends in "Pass & Play" mode, connect for an Online / LAN game, or face off against AI opponents with adjustable difficulty levels.

[**Play the Live Game**](https://armansoor.github.io/testcoup/)

## 🎮 Game Modes

-   **Single Player**: Play against up to 5 AI bots with distinct personalities.
-   **Pass & Play**: Local multiplayer on a single device for up to 6 players.
-   **Online / LAN Multiplayer**: Host and join games over the internet or local network (Peer-to-Peer).
-   **Spectator Mode**: Watch AI vs AI battles.

## 📱 Install as App (PWA)

This game is a Progressive Web App (PWA). You can install it on your device for a native-like experience (offline support, full-screen, home screen icon).

-   **Desktop (Chrome/Edge)**: Click the install icon in the address bar.
-   **Mobile (Android - Chrome)**: Tap the menu (⋮) > "Install App" or "Add to Home Screen".
-   **Mobile (iOS - Safari)**: Tap the Share button > "Add to Home Screen".

## ✨ Features

-   **5 Character Roles**: Duke, Assassin, Captain, Ambassador, Contessa.
-   **Advanced AI**: Four difficulty levels ranging from Random to "God Mode" (Hardcore).
-   **Visual Replay System**: Watch a step-by-step replay of your matches to analyze strategies and bluffs. Also includes a downloadable text log.
-   **Responsive Design**: Optimized for desktop and mobile play.

## 🌐 Online / LAN Multiplayer

Play with friends on different devices! This mode uses Peer-to-Peer (WebRTC) connections.

### How to Host
1.  Open the game and select **"Online / LAN"**.
2.  Click **"Host Game"**.
3.  Share the generated **Room Code** with your friends.
4.  Once everyone has joined, configure the game settings (AI count, difficulty) and click **"Start Game"**.

### How to Join
1.  Open the game and select **"Online / LAN"**.
2.  Enter the **Room Code** provided by the host.
3.  Click **"Join Game"**.
4.  Wait for the host to start the match.

> **Note:** An active internet connection is required to establish the initial connection (signaling). After connecting, gameplay is peer-to-peer. Supports 2-6 players total (Humans + AI).

## 🤖 AI Opponents

-   **Easy (Random)**: Makes random moves. Unpredictable.
-   **Normal (Balanced)**: Standard strategy. Taking Income/Tax when safe.
-   **Hard (Ruthless)**: Bluffs frequently and tracks known cards.
-   **Hardcore (God Mode)**: Mathematically tracks every card to disprove impossible claims.

## 🚀 How to Play

### Setup
1.  Choose your mode: **Single Player**, **Pass & Play**, or **Online**.
2.  Configure the number of players and AI difficulty.
3.  Start the game!

### Rules Summary
-   Start with **2 coins** and **2 influence cards**.
-   On your turn, choose an action. Character actions (Tax, Assassinate, etc.) require claiming a role.
-   **Bluffing** is encouraged! If challenged and caught, you lose a card.
-   **Challenges**: If someone claims a role they don't have, you can Challenge. Loser of the challenge loses a card.
-   **Blocks**: Specific roles can block actions (e.g., Contessa blocks Assassination).
-   Last player with influence wins!

### Actions Reference
| Action | Effect | Cost | Claim | Blocked By |
| :--- | :--- | :--- | :--- | :--- |
| **Income** | Take 1 coin | - | - | - |
| **Foreign Aid** | Take 2 coins | - | - | Duke |
| **Coup** | Force a player to lose a card | 7 | - | - |
| **Tax** | Take 3 coins | - | Duke | - |
| **Assassinate** | Pay 3 coins to eliminate an influence | 3 | Assassin | Contessa |
| **Steal** | Take 2 coins from another player | - | Captain | Captain / Ambassador |
| **Exchange** | Draw 2 cards, return 2 to deck | - | Ambassador | - |

## 🛠️ Tech Stack & Running Locally

Built with **HTML5**, **CSS3**, and **JavaScript (ES6+)**. No build process required.

**To run locally:**
1.  Clone the repository.
2.  Open `index.html` directly in your browser.
3.  *(Optional)* Use a local server (e.g., `python -m http.server`) for better performance.

## 📝 License

Open-source for personal and educational use.
