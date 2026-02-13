import os
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})

    cwd = os.getcwd()
    page.goto(f"file://{cwd}/index.html")

    # Start a local game to initialize UI
    page.click("#mode-local")
    page.click("text=START GAME")
    page.wait_for_selector("#game-screen.active")

    # 1. Test Local Game Over UI
    print("Testing Local Game Over UI...")
    page.evaluate("setupGameOverUI('Player 1', false)")
    page.wait_for_selector("#game-over-modal:not(.hidden)")
    page.screenshot(path="verification/game_over_local.png")

    # Check buttons
    buttons = page.locator("#game-over-actions button")
    count = buttons.count()
    print(f"Local Buttons: {count}")
    for i in range(count):
        print(f" - {buttons.nth(i).inner_text()}")

    # Hide modal for next test
    page.evaluate("document.getElementById('game-over-modal').classList.add('hidden')")

    # 2. Test Network Host Game Over UI
    print("\nTesting Network Host Game Over UI...")
    page.evaluate("isNetworkGame = true; netState.isHost = true;")
    page.evaluate("setupGameOverUI('Player 1', false)")
    page.wait_for_selector("#game-over-modal:not(.hidden)")
    page.screenshot(path="verification/game_over_host.png")

    buttons = page.locator("#game-over-actions button")
    count = buttons.count()
    print(f"Host Buttons: {count}")
    for i in range(count):
        print(f" - {buttons.nth(i).inner_text()}")

    # Hide modal
    page.evaluate("document.getElementById('game-over-modal').classList.add('hidden')")

    # 3. Test Network Client Game Over UI
    print("\nTesting Network Client Game Over UI...")
    page.evaluate("isNetworkGame = true; netState.isHost = false;")
    page.evaluate("setupGameOverUI('Player 1', false)")
    page.wait_for_selector("#game-over-modal:not(.hidden)")
    page.screenshot(path="verification/game_over_client.png")

    buttons = page.locator("#game-over-actions button")
    count = buttons.count()
    print(f"Client Buttons: {count}")
    for i in range(count):
        print(f" - {buttons.nth(i).inner_text()}")

    # Hide modal
    page.evaluate("document.getElementById('game-over-modal').classList.add('hidden')")

    # 4. Test Quit Button (Network)
    # Ensure we are still in "Network Mode" from previous step
    print("\nTesting Quit Button (Network)...")

    # Setup dialog handler
    dialog_message = []
    page.on("dialog", lambda dialog: (dialog_message.append(dialog.message), dialog.accept()))

    # Click Quit
    page.click("#quit-btn")

    if dialog_message:
        print(f"Dialog Message: {dialog_message[0]}")
    else:
        print("ERROR: No dialog appeared!")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
