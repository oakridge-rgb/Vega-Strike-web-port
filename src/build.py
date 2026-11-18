#!/usr/bin/env python3
"""Build the self-contained index.html for the Vega Strike web port."""
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(HERE, "parts")
SRC = "/home/z/my-project/download/vega-strike-web-port/src"
OUT = "/home/z/my-project/download/vega-strike-web-port/index.html"

# refresh src/data.js copy used by the browser build
data_js = open(os.path.join(SRC, "data.js"), encoding="utf-8").read()

JS_PARTS = ["22_core.js", "23_flight.js", "24_render.js", "25_ui.js", "26_boot.js"]
page = open(os.path.join(PARTS, "20_head.html"), encoding="utf-8").read()
js = data_js + "\n" + "\n".join(open(os.path.join(PARTS, p), encoding="utf-8").read() for p in JS_PARTS)
html = page + js + "\n</script>\n</body>\n</html>\n"

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf-8").write(html)
print(f"built {OUT} ({len(html)} bytes)")
