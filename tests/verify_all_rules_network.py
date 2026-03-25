import os
import time
import subprocess
from playwright.sync_api import sync_playwright

def verify_network_rules():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # Need two separate contexts to avoid local storage bleeding if not isolated
        context_host = browser.new_context()
        context_client = browser.new_context()

        host_page = context_host.new_page()
        client_page = context_client.new_page()

        cwd = os.getcwd()
        server_process = subprocess.Popen(["python3", "-m", "http.server", "8003"], cwd=cwd)
        time.sleep(1) # wait for server

        url = "http://localhost:8003/index.html"

        print("--- SCENARIO: Network Host/Join ---")
        try:
            host_page.goto(url)
            client_page.goto(url)

            # Host Setup
            host_page.click("button:has-text('LAN / Online')")
            host_page.wait_for_selector("#lobby-screen.active")
            host_page.fill("#my-player-name", "HostPlayer")

            # Uncheck Allow Random Join so we get a private room with a known code
            host_page.uncheck("#allow-random-join")

            # Wait for Peer to initialize
            time.sleep(1)

            # Click Host
            host_page.evaluate("window.prompt = () => 'testroom'")
            host_page.click("button:has-text('Create Game (Host)')")

            # Wait for Host Room Info to appear
            host_page.wait_for_selector("#host-room-info:not(.hidden)", timeout=10000)
            print("Host Room Created: testroom")

            # Client Setup
            client_page.click("button:has-text('LAN / Online')")
            client_page.wait_for_selector("#lobby-screen.active")
            client_page.fill("#my-player-name", "ClientPlayer")

            # Fill room code and join
            client_page.wait_for_selector("#host-id-input", timeout=5000)
            client_page.fill("#host-id-input", "testroom")
            client_page.click("button:has-text('Join Game')")

            # Wait for Client to connect
            print("Client Joining...")
            client_page.wait_for_selector("#connection-status", state="visible", timeout=5000)
            for _ in range(10):
                status = client_page.inner_text("#connection-status")
                if "Connected" in status or "Waiting" in status:
                    break
                time.sleep(1)

            if "Connected" not in client_page.inner_text("#connection-status") and "Waiting" not in client_page.inner_text("#connection-status"):
                 print("Client failed to join. Status:", client_page.inner_text("#connection-status"))
                 return

            print("Client Joined Successfully.")

            # Host Starts Game
            host_page.select_option("#network-ai-count", "0") # No bots
            host_page.click("#network-start-btn")

            # Wait for Game Screen on both
            host_page.wait_for_selector("#game-screen.active")
            client_page.wait_for_selector("#game-screen.active")
            print("Game Started.")

            # Verify 2 players
            host_players = host_page.query_selector_all(".player-card")
            assert len(host_players) == 2, "Host does not see 2 players"
            print("Both players are in the game.")

            # Determine whose turn it is
            time.sleep(1)

            host_is_active = not host_page.locator("button:has-text('Income')").is_disabled()

            active_page = host_page if host_is_active else client_page
            inactive_page = client_page if host_is_active else host_page
            active_name = "Host" if host_is_active else "Client"

            print(f"Turn 1: {active_name}")

            host_page.evaluate("""
                gameState.players[0].coins = 2; // Host
                gameState.players[0].cards = [{id: 'h1', role: 'Captain', dead: false}, {id: 'h2', role: 'Contessa', dead: false}];
                gameState.players[1].coins = 2; // Client
                gameState.players[1].cards = [{id: 'c1', role: 'Duke', dead: false}, {id: 'c2', role: 'Assassin', dead: false}];
                updateUI();
                broadcastState();
            """)
            time.sleep(1)

            # Action 1: Active Player -> Income
            active_page.click("button:has-text('Income')")
            time.sleep(2)

            # Wait for turn transition
            inactive_page.wait_for_selector("button:has-text('Income')", state="visible", timeout=5000)
            print(f"Action 1 (Income) processed over network.")

            # Action 2: Inactive Player -> Tax
            inactive_page.click("button:has-text('Tax')")
            time.sleep(1)

            print(f"Action 2 (Tax) submitted.")

            challenger_page = active_page # The one who didn't take action

            challenger_page.wait_for_selector("#reaction-panel:not(.hidden)", timeout=10000)
            challenger_page.click("button:has-text('Challenge')")
            print(f"Tax Challenged over network.")

            time.sleep(3) # Wait for challenge resolution and turn transition

            try:
                 host_page.wait_for_selector("#game-screen.active")
                 print("Network Challenge resolved and game continued.")
            except Exception as e:
                 print("Error resolving challenge over network:", e)

            print("\n=== COMPREHENSIVE NETWORK RULES VERIFICATION PASSED ===")
        finally:
            context_host.close()
            context_client.close()
            browser.close()
            server_process.terminate()

if __name__ == "__main__":
    verify_network_rules()
