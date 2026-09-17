#!/usr/bin/env python3
"""Sustituye un bloque exacto dentro de bbsuite.html.
Uso: splice.py <fichero> <fichero_viejo.txt> <fichero_nuevo.txt>
Falla si el bloque viejo no aparece exactamente una vez."""
import sys, pathlib
target, old_f, new_f = (pathlib.Path(p) for p in sys.argv[1:4])
src = target.read_text(encoding='utf-8')
old = old_f.read_text(encoding='utf-8')
new = new_f.read_text(encoding='utf-8')
n = src.count(old)
if n != 1:
    sys.exit(f"ERROR: el bloque aparece {n} veces (se esperaba 1) en {target}")
target.write_text(src.replace(old, new), encoding='utf-8')
print(f"OK: {target.name} actualizado ({len(old)} -> {len(new)} caracteres)")
