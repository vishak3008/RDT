"""One-click launcher for the Network Reliability Simulator dashboard.

Run this file (for example with the Run button in VS Code). It installs Flask if it
is missing, starts the simulator at http://127.0.0.1:5000 and opens the dashboard in
your browser. Stop it with Ctrl+C in the terminal, or the stop button in VS Code.
"""

import importlib.util
import os
import subprocess
import sys
import threading
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:5000"


def ensure_flask() -> None:
    if importlib.util.find_spec("flask") is None:
        print("Installing Flask ...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "Flask>=3.0,<4.0"])


def main() -> None:
    ensure_flask()
    os.chdir(HERE)
    sys.path.insert(0, HERE)
    from backend.app import app  # imported after Flask is available

    threading.Timer(1.2, lambda: webbrowser.open(URL)).start()
    print(f"Network Reliability Simulator running at {URL}  (Ctrl+C to stop)")
    app.run(host="127.0.0.1", port=5000, debug=False)


if __name__ == "__main__":
    main()
