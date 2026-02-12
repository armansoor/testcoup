import os
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})

    cwd = os.getcwd()
    page.goto(f"file://{cwd}/index.html")

    # Click Online Mode to reveal button
    page.click("#mode-online")

    # 1. Verify Spectator Button
    spectator_btn = page.locator("text=Join as Spectator")
    if spectator_btn.is_visible():
        print("Spectator button visible.")
    else:
        print("ERROR: Spectator button NOT visible.")

    # 2. Verify Refactor didn't break game load (Switch back to Local)
    page.click("#mode-local")
    page.click("text=START GAME")

    # Wait for Game Screen
    page.wait_for_selector("#game-screen.active")

    # 3. Verify Turn Timer Bar
    # Timer starts immediately on turn
    timer_bar = page.locator("#turn-timer-bar")
    # It might be hidden or 0 width, but element should exist
    if page.query_selector("#turn-timer-bar"):
         print("Turn timer bar element exists.")
    else:
         print("ERROR: Turn timer bar NOT found.")

    # Take screenshot
    page.screenshot(path="verification/features_verify.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
