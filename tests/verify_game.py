import os
import time
from playwright.sync_api import sync_playwright

def test_game():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)

        # Test 1: Desktop View
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()

        # Load local file
        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        print(f"Loading {url}")
        page.goto(url)

        # Check Title
        title = page.title()
        print(f"Title: {title}")
        assert "COUP" in title

        # Check Lobby
        assert page.is_visible("#lobby-screen")
        print("Lobby visible")

        # Screenshot Lobby
        page.screenshot(path="lobby_desktop.png")

        # Start Single Player Game
        # Select 1 Human, 1 AI
        page.select_option("#human-count", "1")
        page.select_option("#ai-count", "1")

        # Click Start
        page.click("button:has-text('START GAME')")

        # Check Game Screen
        page.wait_for_selector("#game-screen.active")
        print("Game Screen visible")

        # Check Player Area
        page.wait_for_selector("#player-area")
        print("Player Area visible")

        # Check Cards (should have 2 cards)
        cards = page.query_selector_all(".player-card")
        print(f"Player has {len(cards)} cards")
        assert len(cards) >= 2

        # Check Coins
        coins = page.inner_text("#player-coins")
        print(f"Coins: {coins}")
        assert coins == "2"

        # Check Opponents
        opponents = page.query_selector_all(".opponent-card")
        print(f"Opponents visible: {len(opponents)}")
        assert len(opponents) == 1

        # Screenshot Game
        page.screenshot(path="game_desktop.png")

        # Perform an Action (Income)
        print("Clicking Income...")
        page.click("button:has-text('Income (1)')")

        # Verify coins increased (Turn might pass to bot and back, so it might take a second)
        # But for local play, it's instant update for us, then bot turn.
        # Wait for log update
        page.wait_for_selector(".log-entry:has-text('Income')")
        print("Income action logged")

        page.screenshot(path="game_action.png")

        context.close()

        # Test 2: Mobile View
        context_mobile = browser.new_context(viewport={'width': 375, 'height': 667}, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1')
        page_m = context_mobile.new_page()
        page_m.goto(url)

        # Check Lobby Mobile
        page_m.screenshot(path="lobby_mobile.png")
        print("Mobile Lobby screenshot taken")

        # Start Game Mobile
        page_m.click("button:has-text('START GAME')")
        page_m.wait_for_selector("#game-screen.active")

        # Check Layout
        page_m.screenshot(path="game_mobile.png")
        print("Mobile Game screenshot taken")

        context_mobile.close()

        # Test 3: Pass & Play
        context_pp = browser.new_context()
        page_pp = context_pp.new_page()
        page_pp.goto(url)

        # Select 2 Humans, 0 AI
        page_pp.select_option("#human-count", "2")
        page_pp.select_option("#ai-count", "0")

        page_pp.click("button:has-text('START GAME')")
        page_pp.wait_for_selector("#game-screen.active")

        # Player 1 should be active
        # Check if Player 2 is listed as opponent
        opps = page_pp.query_selector_all(".opponent-card")
        assert len(opps) == 1
        assert "Player 2" in opps[0].inner_text()
        print("Pass & Play: Player 2 visible as opponent")

        # Player 1 takes Income
        page_pp.click("button:has-text('Income')")
        page_pp.wait_for_selector(".log-entry:has-text('Player 1 attempts to Income')")

        # Wait for Turn change
        # Logic: Income is instant. Turn should go to Player 2.
        # Check Turn Indicator
        page_pp.wait_for_function("document.getElementById('turn-indicator').innerText.includes('Player 2')")
        print("Turn passed to Player 2")

        # Check Player 2 is now Active Player (in player-area)
        page_pp.wait_for_function("document.getElementById('active-player-name').innerText.includes('Player 2')")
        print("Player 2 is now active in UI")

        page_pp.screenshot(path="game_pass_play.png")

        context_pp.close()

        browser.close()
        print("Tests completed successfully.")

if __name__ == "__main__":
    test_game()
