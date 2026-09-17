#!/usr/bin/env python3
"""Extrae el <script> principal de bbsuite.html a un fichero .js."""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
m = re.search(r'\n<script>\n(.*?)\n</script>', src, re.S)
if not m:
    sys.exit('ERROR: no se encuentra el <script> principal')
pathlib.Path(sys.argv[2]).write_text(m.group(1), encoding='utf-8')
print('OK: %d líneas de JavaScript extraídas' % m.group(1).count('\n'))
