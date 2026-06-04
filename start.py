"""
start.py — launch both the FastAPI backend and the Vite frontend together.

Usage:  python start.py
Stop:   Ctrl+C
"""

import subprocess
import sys
import os
import time
import threading
import webbrowser

ROOT     = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(ROOT, "frontend")
IS_WIN   = sys.platform == "win32"


def run_backend():
    subprocess.run(
        [sys.executable, os.path.join(ROOT, "backend", "main.py")],
        cwd=ROOT,
    )


def open_browser():
    time.sleep(3)
    webbrowser.open("http://localhost:5173")


if __name__ == "__main__":
    print("Starting Writing Assistant…")
    print("  Backend  → http://localhost:8000")
    print("  Frontend → http://localhost:5173")
    print("Press Ctrl+C to stop.\n")

    threading.Thread(target=run_backend, daemon=True).start()
    threading.Thread(target=open_browser, daemon=True).start()

    # npm run dev blocks in the foreground — Ctrl+C here kills everything
    try:
        subprocess.run(
            ["npm", "run", "dev"],
            cwd=FRONTEND,
            shell=IS_WIN,
        )
    except KeyboardInterrupt:
        print("\nShutting down.")
