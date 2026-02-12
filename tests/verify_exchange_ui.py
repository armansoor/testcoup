
import os
import time
from playwright.sync_api import sync_playwright

def test_exchange_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"

        context = browser.new_context(viewport={'width': 400, 'height': 800}) # Mobile view
        page = context.new_page()
        page.goto(url)

        # Start 2 Human Game (Pass & Play) to control both sides
        page.select_option("#human-count", "2")
        page.select_option("#ai-count", "0")
        page.click("button:has-text('START GAME')")
        page.wait_for_selector("#game-screen.active")

        # Cheat: Inject Ambassador into Player 1's hand via console
        page.evaluate("""
            gameState.players[0].cards[0].role = 'Ambassador';
            gameState.players[0].cards[0].dead = false;
            updateUI();
        """)

        # Verify Exchange Button is enabled (or we can use it)
        # Exchange is always available (bluffable)
        page.click("button:has-text('Exchange')")

        # Should ask P2 for Challenge (since P2 is human)
        # Verify Reaction Panel
        page.wait_for_selector("#reaction-panel:not(.hidden)")
        assert page.is_visible("text=do you want to Challenge Player 1's Exchange?")
        print("Challenge Prompt Visible")

        # P2 Passes
        page.click("button:has-text('Pass')")

        # Now Exchange Modal should appear
        # Verify Modal content
        page.wait_for_selector("#reaction-panel:not(.hidden)")
        assert page.is_visible("text=select 2 card(s) to KEEP")
        print("Exchange Selection Modal Visible")

        # Take Screenshot
        page.screenshot(path="exchange_modal.png")
        print("Screenshot saved to exchange_modal.png")

        # Select 2 cards
        # Find cards in modal
        cards = page.query_selector_all("#reaction-buttons .player-card")
        assert len(cards) == 4 # 2 original + 2 drawn

        # Click first two
        cards[0].click()
        cards[1].click()

        # Click Confirm
        page.click("button:has-text('Confirm')")

        # Verify Modal closed and Game continues
        page.wait_for_selector("#reaction-panel", state="hidden")
        print("Exchange Completed Successfully")

        browser.close()

if __name__ == "__main__":
    test_exchange_ui()
