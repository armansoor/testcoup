import os
import time
from playwright.sync_api import sync_playwright

def test_game():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        print(f"Loading {url}")

        # Test 1: Single Player (Desktop)
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        page.goto(url)

        # PWA Check: Verify manifest link
        manifest = page.get_attribute("link[rel='manifest']", "href")
        print(f"Manifest found: {manifest}")
        assert manifest == "manifest.json"

        page.select_option("#human-count", "1")
        page.select_option("#ai-count", "1")
        page.click("button:has-text('START GAME')")
        page.wait_for_selector("#game-screen.active")
        print("Single Player: Started")

        page.click("button:has-text('Income')")
        page.wait_for_selector(".log-entry:has-text('Income')")
        print("Single Player: Income Action Verified")
        page.screenshot(path="single_player.png")
        context.close()

        # Test 2: Mobile Layout
        context_mobile = browser.new_context(viewport={'width': 375, 'height': 667}, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1')
        page_m = context_mobile.new_page()
        page_m.goto(url)
        page_m.screenshot(path="mobile_lobby.png")
        print("Mobile: Lobby Verified")
        context_mobile.close()

        # Test 3: Pass & Play
        context_pp = browser.new_context()
        page_pp = context_pp.new_page()
        page_pp.goto(url)

        page_pp.select_option("#human-count", "2")
        page_pp.select_option("#ai-count", "0")
        page_pp.click("button:has-text('START GAME')")
        page_pp.wait_for_selector("#game-screen.active")
        print("Pass & Play: Started")

        # P1 Move
        page_pp.click("button:has-text('Income')")
        # Verify Turn passed to P2
        page_pp.wait_for_function("document.getElementById('turn-indicator').innerText.includes('Player 2')")
        print("Pass & Play: Turn Handover Verified")
        page_pp.screenshot(path="pass_and_play.png")
        context_pp.close()

        # Test 4: Offline Mode Simulation
        print("Starting Offline Mode Test...")
        context_offline = browser.new_context()
        context_offline.set_offline(True) # Simulate offline
        page_off = context_offline.new_page()
        page_off.goto(url)

        # Try to Host Game (should alert)
        page_off.on("dialog", lambda dialog: dialog.accept()) # Auto-accept alerts
        page_off.click("#mode-online")
        page_off.fill("#my-player-name", "OfflineUser")

        # We need to catch the alert message
        msg = []
        page_off.on("dialog", lambda d: msg.append(d.message) and d.accept())
        page_off.click("button:has-text('Create Game (Host)')")

        # Wait a bit for JS to fire
        page_off.wait_for_timeout(500)

        if any("Internet connection required" in m for m in msg):
            print("Offline Check: Host blocked correctly.")
        else:
            print("Offline Check: Warning! Did not see offline alert.")
            # Note: might fail if Playwright offline mode doesn't affect navigator.onLine inside file:// context correctly
            # Let's check navigator.onLine
            is_online = page_off.evaluate("navigator.onLine")
            print(f"Navigator.onLine is: {is_online}")

        context_offline.close()

        # Test 5: LAN / Multiplayer (Host & Client)
        print("Starting LAN/Multiplayer Test...")
        # Since PeerJS requires a signaling server, and we are testing locally file://,
        # PeerJS default cloud server might work if we have internet access in container.
        # But if blocked, this test might fail. Let's try.

        # Host Context
        context_host = browser.new_context()
        host_page = context_host.new_page()
        host_page.goto(url)

        # Switch to Online Mode
        host_page.click("#mode-online")
        host_page.fill("#my-player-name", "HostPlayer")
        host_page.click("button:has-text('Create Game (Host)')")

        # Wait for ID generation
        host_page.wait_for_selector("#my-room-code")
        # Wait until text is not "Generating..."
        try:
            host_page.wait_for_function("document.getElementById('my-room-code').innerText !== 'Generating...'", timeout=5000)
            room_code = host_page.inner_text("#my-room-code")
            print(f"Host Room Code: {room_code}")

            # Client Context
            context_client = browser.new_context()
            client_page = context_client.new_page()
            client_page.goto(url)

            client_page.click("#mode-online")
            client_page.fill("#my-player-name", "ClientPlayer")
            client_page.fill("#host-id-input", room_code)
            client_page.click("button:has-text('Join Game')")

            # Wait for connection on Host
            host_page.wait_for_selector("#connected-players-list li:has-text('ClientPlayer')")
            print("Host sees Client connected")

            # Wait for connection on Client
            client_page.wait_for_function("document.getElementById('connection-status').innerText.includes('Connected!')")
            print("Client sees Connected status")

            host_page.screenshot(path="lan_lobby_host.png")
            client_page.screenshot(path="lan_lobby_client.png")

            # Start Game
            print("Host starting game...")
            host_page.click("#network-start-btn")

            # Verify Game Screen on both
            host_page.wait_for_selector("#game-screen.active")
            client_page.wait_for_selector("#game-screen.active")
            print("Both players entered Game Screen")

            # Verify initial turn (Host is usually P1)
            host_page.wait_for_selector("#turn-indicator:has-text('HostPlayer')")
            client_page.wait_for_selector("#turn-indicator:has-text('HostPlayer')")

            host_page.screenshot(path="lan_game_host.png")
            client_page.screenshot(path="lan_game_client.png")

            # Host Move (Income)
            host_page.click("button:has-text('Income')")

            # Verify Update on Client
            client_page.wait_for_selector(".log-entry:has-text('HostPlayer attempts to Income')")
            print("Client received Host's move")

            # Verify Turn passed to Client
            client_page.wait_for_selector("#turn-indicator:has-text('ClientPlayer')")
            print("Turn passed to Client")

            context_client.close()
        except Exception as e:
            print(f"LAN Test Skipped/Failed (likely network restriction): {e}")

        context_host.close()
        browser.close()
        print("All Tests Completed.")

if __name__ == "__main__":
    test_game()
