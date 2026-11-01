#!/usr/bin/env python3
"""
Lee las estadísticas de un canal con la API de YouTube Analytics (solo lectura),
para que la skill las consulte antes de proponer temas y títulos.

Uso:
    python metricas_canal.py --canal salud60                # últimos 90 días
    python metricas_canal.py --canal ordenglobal --dias 28
    python metricas_canal.py --canal salud60 --retencion VIDEO_ID   # + curva de retención

Usa el mismo permiso que upload_youtube.py (variable YT_TOKEN_<CANAL> o
tokens/<canal>.json). El permiso tiene que incluir yt-analytics.readonly: los
canales vinculados antes de añadirlo hay que volver a vincularlos.

Guarda todo en metricas_<canal>_<fecha>.json y muestra un resumen.
Códigos de salida: 0 = bien, 3 = sin credenciales o sin permiso de estadísticas.
"""
import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from upload_youtube import (
    SIN_CREDENCIALES,
    cargar_canales,
    comprobar_canal,
    credenciales_validas,
    env_name,
)

SCOPE_ANALYTICS = "https://www.googleapis.com/auth/yt-analytics.readonly"

# Se prueban de más a menos completas: si la API no acepta alguna métrica
# (p. ej. engagedViews), se repite la consulta sin ella.
METRICAS_BASE = [
    "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
    "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
]


class Analytics:
    def __init__(self, servicio, inicio: str, fin: str):
        self.servicio, self.inicio, self.fin = servicio, inicio, fin

    def consulta(self, metricas: str, **extra):
        """Devuelve (filas como dicts, None) o (None, mensaje de error)."""
        try:
            r = self.servicio.reports().query(
                ids="channel==MINE", startDate=self.inicio, endDate=self.fin,
                metrics=metricas, **extra,
            ).execute()
        except HttpError as e:
            return None, f"{e.resp.status}: {e.reason if hasattr(e, 'reason') else e}"
        cols = [c["name"] for c in r.get("columnHeaders", [])]
        return [dict(zip(cols, fila)) for fila in r.get("rows", [])], None

    def con_alternativas(self, opciones, **extra):
        error = None
        for metricas in opciones:
            filas, error = self.consulta(metricas, **extra)
            if filas is not None:
                return filas, None
        return None, error


def titulos(youtube, ids):
    datos = {}
    for i in range(0, len(ids), 50):
        r = youtube.videos().list(part="snippet,contentDetails", id=",".join(ids[i:i + 50])).execute()
        for v in r.get("items", []):
            datos[v["id"]] = {
                "titulo": v["snippet"]["title"],
                "publicado": v["snippet"]["publishedAt"][:10],
                "duracion": v["contentDetails"]["duration"],
            }
    return datos


def mmss(segundos):
    segundos = int(round(segundos or 0))
    return f"{segundos // 60}:{segundos % 60:02d}"


def resumen(res: dict):
    print(f"\n=== {res['canal_titulo']} · {res['periodo']['inicio']} a {res['periodo']['fin']} ===")

    t = (res.get("totales") or [{}])[0]
    if t:
        linea = f"Visualizaciones {int(t.get('views', 0))}"
        if "engagedViews" in t:
            linea += f" · interesadas {int(t['engagedViews'])}"
        linea += (f" · {int(t.get('estimatedMinutesWatched', 0))} min vistos"
                  f" · duración media {mmss(t.get('averageViewDuration'))}"
                  f" · {t.get('averageViewPercentage', 0):.1f} % visto"
                  f" · +{int(t.get('subscribersGained', 0))} suscriptores")
        print(linea)

    ctr = res["impresiones_ctr"]
    if ctr["disponible"]:
        print("Impresiones y CTR: disponibles por vídeo (ver JSON).")
    else:
        print(f"Impresiones y CTR: la API no los ha devuelto ({ctr['error']}). Sácalos de Studio.")

    videos = res.get("videos") or []
    if videos:
        clave = "engagedViews" if "engagedViews" in videos[0] else "views"
        print(f"\nVídeos ordenados por {'visualizaciones interesadas' if clave == 'engagedViews' else 'visualizaciones'}:")
        for v in sorted(videos, key=lambda x: -x.get(clave, 0))[:15]:
            extra = ""
            if v.get("ctr") is not None:
                extra = f" · {int(v['impresiones'])} impr · CTR {v['ctr']:.2f} %"
            print(f"  {int(v.get(clave, 0)):>6}  {v.get('averageViewPercentage', 0):5.1f} % visto"
                  f"  {mmss(v.get('averageViewDuration')):>6}  +{int(v.get('subscribersGained', 0))} subs"
                  f"{extra}  {v.get('titulo', v['video'])[:70]}")

    if res.get("trafico"):
        total = sum(f["views"] for f in res["trafico"]) or 1
        print("\nFuentes de tráfico:")
        for f in res["trafico"][:8]:
            print(f"  {f['insightTrafficSourceType']:<22} {100 * f['views'] / total:5.1f} %")

    if res.get("tipo_contenido"):
        print("\nPor tipo de contenido:")
        for f in res["tipo_contenido"]:
            print(f"  {f['creatorContentType']:<14} {int(f['views'])} visualizaciones")

    if res.get("retencion"):
        r = res["retencion"]
        print(f"\nRetención de {r['video']}: (porcentaje del vídeo -> proporción que sigue viendo)")
        for f in r["curva"][::10]:
            print(f"  {100 * f['elapsedVideoTimeRatio']:5.0f} %  ->  {f['audienceWatchRatio']:.2f}")

    for aviso in res["avisos"]:
        print(f"Aviso: {aviso}")


def main():
    p = argparse.ArgumentParser(description="Estadísticas del canal con YouTube Analytics.")
    p.add_argument("--canal", required=True)
    p.add_argument("--dias", type=int, default=90)
    p.add_argument("--retencion", metavar="VIDEO_ID", help="Añade la curva de retención de ese vídeo")
    p.add_argument("--salida", type=Path, default=Path("."), help="Carpeta donde guardar el JSON")
    args = p.parse_args()

    canales = cargar_canales()
    if args.canal not in canales:
        sys.exit(f"Canal no definido en canales.json: {args.canal}")

    creds, info = credenciales_validas(args.canal)
    if creds.scopes and SCOPE_ANALYTICS not in creds.scopes:
        print(f"El permiso de «{args.canal}» no incluye las estadísticas. Vuelve a vincular el canal "
              f"(--vincular) y actualiza {env_name(args.canal)}.", file=sys.stderr)
        sys.exit(SIN_CREDENCIALES)

    youtube = build("youtube", "v3", credentials=creds)
    comprobar_canal(youtube, args.canal, canales[args.canal], info)
    canal_titulo = youtube.channels().list(part="snippet", mine=True).execute()["items"][0]["snippet"]["title"]

    fin = date.today()
    inicio = fin - timedelta(days=args.dias)
    an = Analytics(build("youtubeAnalytics", "v2", credentials=creds), inicio.isoformat(), fin.isoformat())
    avisos = []

    totales, err = an.con_alternativas(METRICAS_BASE)
    if err:
        avisos.append(f"Totales del canal: {err}")

    videos, err = an.con_alternativas(METRICAS_BASE, dimensions="video", sort="-views", maxResults=50)
    if err:
        avisos.append(f"Vídeos: {err}")
    videos = videos or []

    # Impresiones y CTR de miniatura: se intenta y se informa de si la API los da.
    ctr_filas, ctr_err = an.consulta(
        "videoThumbnailImpressions,videoThumbnailImpressionsClickRate",
        dimensions="video", sort="-videoThumbnailImpressions", maxResults=50,
    )
    if ctr_filas is not None:
        por_id = {f["video"]: f for f in ctr_filas}
        for v in videos:
            f = por_id.get(v["video"])
            if f:
                v["impresiones"] = f["videoThumbnailImpressions"]
                v["ctr"] = f["videoThumbnailImpressionsClickRate"]

    if videos:
        meta = titulos(youtube, [v["video"] for v in videos])
        for v in videos:
            v.update(meta.get(v["video"], {}))

    trafico, err = an.consulta("views,estimatedMinutesWatched",
                               dimensions="insightTrafficSourceType", sort="-views")
    if err:
        avisos.append(f"Fuentes de tráfico: {err}")

    tipo, err = an.consulta("views,estimatedMinutesWatched", dimensions="creatorContentType")
    if err:
        avisos.append(f"Tipo de contenido: {err}")

    retencion = None
    if args.retencion:
        curva, err = an.consulta("audienceWatchRatio,relativeRetentionPerformance",
                                 dimensions="elapsedVideoTimeRatio", filters=f"video=={args.retencion}")
        if err:
            avisos.append(f"Retención: {err}")
        else:
            retencion = {"video": args.retencion, "curva": curva}

    res = {
        "canal": args.canal,
        "canal_titulo": canal_titulo,
        "periodo": {"inicio": inicio.isoformat(), "fin": fin.isoformat(), "dias": args.dias},
        "generado": date.today().isoformat(),
        "totales": totales,
        "videos": videos,
        "impresiones_ctr": {"disponible": ctr_filas is not None, "error": ctr_err},
        "trafico": trafico,
        "tipo_contenido": tipo,
        "retencion": retencion,
        "avisos": avisos,
    }

    args.salida.mkdir(parents=True, exist_ok=True)
    fichero = args.salida / f"metricas_{args.canal}_{fin.isoformat()}.json"
    fichero.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    resumen(res)
    print(f"\nGuardado en {fichero}")


if __name__ == "__main__":
    main()
