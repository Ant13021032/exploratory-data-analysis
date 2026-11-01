#!/usr/bin/env python3
"""
Sube un vídeo a YouTube en PRIVADO con título, descripción, etiquetas y miniatura.
Pensado para el último paso de las skills de vídeo (Salud a los 60+ y ORDEN GLOBAL).

Uso:
    # 1) En tu ordenador, una vez por canal (elige ESE canal en la pantalla de Google):
    python upload_youtube.py --canal salud60 --vincular
    python upload_youtube.py --canal ordenglobal --vincular

    # 2) Subida (la hace la skill al terminar el vídeo):
    python upload_youtube.py --video final.mp4 --meta publicacion.json

    El canal va en el JSON ("canal": "salud60") o con --canal. Los valores fijos de
    cada canal (categoría, idioma...) están en canales.json. "channelId" es opcional:
    el token ya guarda a qué canal pertenece.

Credenciales, por orden de preferencia:
    - Variable de entorno YT_TOKEN_<CANAL> con el contenido de tokens/<canal>.json
      (p. ej. YT_TOKEN_SALUD60). Es lo que se usa en las sesiones en la nube.
    - Fichero tokens/<canal>.json junto al script (uso en tu ordenador).

Códigos de salida: 0 = subido, 3 = no hay credenciales para ese canal (la skill
entrega el vídeo igualmente y avisa), 1 = cualquier otro error.
"""
import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

# Permisos mínimos (importante para la auditoría de la API):
#   youtube.upload         -> subir el vídeo y su miniatura
#   youtube.readonly       -> comprobar el canal y leer títulos de vídeos
#   yt-analytics.readonly  -> estadísticas para metricas_canal.py
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]
RETRIABLE_STATUS = {500, 502, 503, 504}
MAX_RETRIES = 8
SIN_CREDENCIALES = 3

BASE_DIR = Path(__file__).resolve().parent
TOKENS_DIR = BASE_DIR / "tokens"
CANALES_FILE = BASE_DIR / "canales.json"


def cargar_canales() -> dict:
    if CANALES_FILE.exists():
        return json.loads(CANALES_FILE.read_text(encoding="utf-8"))
    return {}


# ---------------------------------------------------------------- autenticación
def env_name(canal: str) -> str:
    return "YT_TOKEN_" + "".join(c if c.isalnum() else "_" for c in canal).upper()


def cargar_credenciales(canal: str):
    """Devuelve (credenciales, datos del token) o (None, None)."""
    valor = os.environ.get(env_name(canal))
    if not valor:
        token_file = TOKENS_DIR / f"{canal}.json"
        if not token_file.exists():
            return None, None
        valor = token_file.read_text(encoding="utf-8")
    info = json.loads(valor)
    # Se usan los permisos que tenga el propio token: si se pidieran otros al
    # renovarlo, Google respondería invalid_scope.
    return Credentials.from_authorized_user_info(info), info


def vincular(canal: str, client_secret: Path, headless: bool):
    """Autorización inicial con navegador. Solo se hace en el ordenador del usuario."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    if not client_secret.exists():
        sys.exit(f"Falta {client_secret}: descárgalo de Google Cloud (credencial OAuth de escritorio).")
    print(f"Autorizando «{canal}». En la pantalla de Google elige ESE canal.")
    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=not headless)
    TOKENS_DIR.mkdir(exist_ok=True)
    youtube = build("youtube", "v3", credentials=creds)
    canal_id, titulo = canal_actual(youtube, canal)

    # El token guarda también a qué canal pertenece, para detectar confusiones.
    info = json.loads(creds.to_json())
    info.update({"canal": canal, "channel_id": canal_id, "channel_title": titulo})
    token_file = TOKENS_DIR / f"{canal}.json"
    token_file.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")

    print(f"\n«{canal}» vinculado a: {titulo} ({canal_id})")
    print(f"Para las sesiones en la nube, crea el secreto {env_name(canal)} con el contenido de {token_file}")


def credenciales_validas(canal: str):
    """Credenciales renovadas y listas para usar, o sale con código 3."""
    creds, info = cargar_credenciales(canal)
    if creds is None:
        print(
            f"No hay credenciales para «{canal}»: falta la variable {env_name(canal)} "
            f"o el fichero tokens/{canal}.json.",
            file=sys.stderr,
        )
        sys.exit(SIN_CREDENCIALES)
    if not creds.valid:
        try:
            creds.refresh(Request())
        except RefreshError as e:
            print(
                f"El permiso de «{canal}» ha caducado o se ha revocado ({e}). "
                f"Vuelve a vincular el canal y actualiza {env_name(canal)}.",
                file=sys.stderr,
            )
            sys.exit(SIN_CREDENCIALES)
    return creds, info


def get_service(canal: str):
    creds, info = credenciales_validas(canal)
    return build("youtube", "v3", credentials=creds), info


def canal_actual(youtube, canal: str):
    items = youtube.channels().list(part="snippet", mine=True).execute().get("items", [])
    if not items:
        sys.exit(f"La cuenta autorizada para «{canal}» no tiene canal de YouTube.")
    return items[0]["id"], items[0]["snippet"]["title"]


def comprobar_canal(youtube, canal: str, config: dict, info: dict):
    """Evita subir un vídeo al canal equivocado: el token tiene que haberse
    vinculado para este canal y seguir apuntando al mismo channelId."""
    canal_id, titulo = canal_actual(youtube, canal)
    if info.get("canal") != canal:
        sys.exit(
            f"ALTO: el token usado para «{canal}» se vinculó para «{info.get('canal')}» "
            f"(es del canal {titulo}). Revisa el secreto {env_name(canal)}."
        )
    for esperado in (info.get("channel_id"), config.get("channelId")):
        if esperado and esperado != canal_id:
            sys.exit(f"ALTO: «{canal}» debería ser {esperado}, pero el token es de {titulo} ({canal_id}).")
    print(f"Canal: {titulo}")


# ---------------------------------------------------------------- validación
def limpiar(texto: str) -> str:
    # YouTube rechaza '<' y '>' en título y descripción.
    return texto.replace("<", "‹").replace(">", "›")


def validar(meta: dict, base_dir: Path) -> dict:
    title = limpiar(meta.get("title", "").strip())
    if not title or len(title) > 100:
        sys.exit(f"Título no válido ({len(title)} caracteres): tiene que tener de 1 a 100.")

    description = limpiar(meta.get("description", ""))
    if len(description.encode("utf-8")) > 5000:
        sys.exit("La descripción supera los 5000 bytes.")

    tags = [t.strip() for t in meta.get("tags", []) if t.strip()]
    # YouTube cuenta las etiquetas con espacios como si llevaran comillas.
    total = sum(len(t) + (2 if " " in t else 0) for t in tags) + max(len(tags) - 1, 0)
    if total > 500:
        sys.exit(f"Las etiquetas suman {total} caracteres; el límite es 500.")

    thumb = meta.get("thumbnail")
    if thumb:
        thumb_path = (base_dir / thumb).resolve()
        if not thumb_path.exists():
            sys.exit(f"No encuentro la miniatura: {thumb_path}")
        if thumb_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            sys.exit("La miniatura debe ser JPG o PNG.")
        if thumb_path.stat().st_size > 2 * 1024 * 1024:
            sys.exit("La miniatura supera los 2 MB: guárdala en JPG con menos calidad.")
        meta["thumbnail"] = thumb_path

    meta["title"], meta["description"], meta["tags"] = title, description, tags
    return meta


# ---------------------------------------------------------------- subida
def subir_video(youtube, video: Path, meta: dict) -> str:
    body = {
        "snippet": {
            "title": meta["title"],
            "description": meta["description"],
            "tags": meta["tags"],
            "categoryId": str(meta.get("categoryId", "22")),
            "defaultLanguage": meta.get("language", "es"),
            "defaultAudioLanguage": meta.get("language", "es"),
        },
        "status": {
            "privacyStatus": "private",  # siempre privado; se publica a mano en Studio
            "selfDeclaredMadeForKids": bool(meta.get("madeForKids", False)),
            "containsSyntheticMedia": bool(meta.get("containsSyntheticMedia", False)),
        },
    }

    media = MediaFileUpload(str(video), chunksize=8 * 1024 * 1024, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response, retry = None, 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                print(f"  subido {int(status.progress() * 100)} %")
        except HttpError as e:
            if e.resp.status not in RETRIABLE_STATUS:
                raise
            retry += 1
            if retry > MAX_RETRIES:
                raise
            wait = random.uniform(0, 2 ** retry)
            print(f"  error {e.resp.status}, reintento {retry} en {wait:.1f}s")
            time.sleep(wait)

    return response["id"]


def poner_miniatura(youtube, video_id: str, thumb: Path):
    mime = "image/png" if thumb.suffix.lower() == ".png" else "image/jpeg"
    youtube.thumbnails().set(
        videoId=video_id, media_body=MediaFileUpload(str(thumb), mimetype=mime)
    ).execute()


def subir_a_canal(canal: str, video: Path, meta: dict, canales: dict) -> dict:
    config = canales.get(canal, {})
    datos = {**{k: v for k, v in config.items() if k != "channelId"}, **meta}

    youtube, info = get_service(canal)
    comprobar_canal(youtube, canal, config, info)

    print(f"Subiendo «{datos['title']}» en privado...")
    video_id = subir_video(youtube, video, datos)
    resultado = {"canal": canal, "videoId": video_id, "url": f"https://youtu.be/{video_id}",
                 "studio": f"https://studio.youtube.com/video/{video_id}/edit", "miniatura": None}
    print(f"Vídeo subido: {resultado['url']}")

    if datos.get("thumbnail"):
        try:
            poner_miniatura(youtube, video_id, datos["thumbnail"])
            resultado["miniatura"] = "aplicada"
            print("Miniatura aplicada.")
        except HttpError as e:
            # El 403 más habitual: el canal no tiene verificado el teléfono.
            resultado["miniatura"] = f"error {e.resp.status}"
            print(f"No se pudo poner la miniatura ({e.resp.status}): {e}")
    return resultado


# ---------------------------------------------------------------- main
def main():
    p = argparse.ArgumentParser(description="Sube un vídeo a YouTube en privado.")
    p.add_argument("--canal", action="append", help="Canal de canales.json (se puede repetir). Si falta, se usa 'canal' del JSON")
    p.add_argument("--vincular", action="store_true", help="Autoriza el canal en este ordenador, sin subir nada")
    p.add_argument("--video", type=Path)
    p.add_argument("--meta", type=Path, help="JSON con título, descripción, etiquetas y miniatura")
    p.add_argument("--client-secret", default=BASE_DIR / "client_secret.json", type=Path)
    p.add_argument("--headless", action="store_true", help="No abrir navegador al vincular")
    args = p.parse_args()

    canales = cargar_canales()

    if args.vincular:
        if not args.canal:
            sys.exit("Indica el canal: --canal NOMBRE --vincular")
        for canal in args.canal:
            vincular(canal, args.client_secret, args.headless)
        return

    if not args.video or not args.meta:
        sys.exit("Faltan --video y --meta.")
    if not args.video.exists():
        sys.exit(f"No existe el vídeo: {args.video}")

    meta = validar(json.loads(args.meta.read_text(encoding="utf-8")), args.meta.parent)

    lista = args.canal or meta.pop("canal", None)
    if isinstance(lista, str):
        lista = [lista]
    if not lista:
        sys.exit('No sé a qué canal subirlo: usa --canal o pon "canal" en el JSON.')
    desconocidos = [c for c in lista if c not in canales]
    if desconocidos:
        sys.exit(f"Canal no definido en canales.json: {', '.join(desconocidos)}")

    resultados = [subir_a_canal(c, args.video, meta, canales) for c in lista]

    salida = args.meta.with_suffix(".youtube.json")
    salida.write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Resultado guardado en {salida}")


if __name__ == "__main__":
    main()
