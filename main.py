"""
CosmoLens HPC: High-Performance JWST Deep-Field Processing & Gravitational Lens Discovery Engine
Primary entrypoint script.
"""

import sys
import os
import uvicorn

# Ensure repository root is on Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    # Windows defaults stdout to cp1252 when it is not a console (piped to a
    # file, run under a service manager), and the banner below is not
    # encodable there. Force UTF-8 so startup does not die on a print.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"🚀 Launching CosmoLens HPC Observatory Server on http://localhost:{port}")
    uvicorn.run("cosmolens.server.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
