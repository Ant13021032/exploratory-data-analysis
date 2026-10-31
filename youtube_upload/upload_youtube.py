#!/usr/bin/env python3
"""
Sube un vídeo a YouTube en PRIVADO con título, descripción, etiquetas y miniatura.

Uso:
    # Una vez por canal, para vincularlo (elige el canal en la pantalla de Google):
    python upload_youtube.py --canal canal1 --vincular
    python upload_youtube.py --canal canal2 --vincular

    # Subidas:
    python upload_youtube.py --canal canal1 --video salida/video.mp4 --meta salida/video.json

    El canal también puede ir en el JSON ("canal": "canal1"). Si es una lista
    (["canal1", "canal2"]) el mismo vídeo se sube a los dos.

El JSON de metadatos (ver ejemplo_metadatos.json) lo puede escribir el propio
generador de vídeos al terminar cada render.

Requisitos:
    pip install -r requirements.txt
    client_secret.json (credenciales OAuth "Aplicación de escritorio" de Google Cloud)
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
]
RETRIABLE_STATUS = {500, 502, 503, 504}
MAX_RETRIES = 8


# ---------------------------------------------------------------- autenticación
BASE_DIR = Path(__file__).resolve().parent
TOKENS_DIR = BASE_DIR / "tokens"


def get_service(canal: str, client_secret: Path, headless: bool):
    """Devuelve el cliente de la API para un canal. Cada canal tiene su propio token."""
    TOKENS_DIR.mkdir(exist_ok=True)
    token_file = TOKENS_DIR / f"{canal}.json"
    creds = None
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not client_secret.exists():
                sys.exit(f"Falta {client_secret}: descárgalo de Google Cloud (credencial OAuth de escritorio).")
            print(f"Autorizando el canal «{canal}». En la pantalla de Google elige ESE canal.")
            flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
            # Con --headless imprime la URL y hay que abrirla a mano en un equipo con navegador.
            creds = flow.run_local_server(port=0, open_browser=not headless)
        token_file.write_text(creds.to_json(), encoding="utf-8")

    youtube = build("youtube", "v3", credentials=creds)
    check_channel(youtube, canal)
    return youtube


def check_channel(youtube, canal: str):
    """Comprueba que el token apunta al canal que se vinculó la primera vez,
    para no subir nunca un vídeo al canal equivocado."""
    items = youtube.channels().list(part="snippet", mine=True).execute().get("items", [])
    if not items:
        sys.exit(f"La cuenta autorizada para «{canal}» no tiene canal de YouTube.")
    actual = {"id": items[0]["id"], "title": items[0]["snippet"]["title"]}

    id_file = TOKENS_DIR / f"{canal}.canal.json"
    if not id_file.exists():
        id_file.write_text(json.dumps(actual, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"«{canal}» vinculado a: {actual['title']} ({actual['id']})")
        return

    esperado = json.loads(id_file.read_text(encoding="utf-8"))
    if esperado["id"] != actual["id"]:
        sys.exit(
            f"ALTO: «{canal}» debería ser {esperado['title']} ({esperado['id']}) "
            f"pero el token es de {actual['title']} ({actual['id']}). "
            f"Borra tokens/{canal}.* y vuelve a vincularlo."
        )
    print(f"Canal: {actual['title']}")


# ---------------------------------------------------------------- validación
def validate(meta: dict, base_dir: Path) -> dict:
    title = meta.get("title", "").strip()
    if not title or len(title) > 100 or "<" in title or ">" in title:
        sys.exit("Título no válido: 1-100 caracteres y sin '<' ni '>'.")

    description = meta.get("description", "")
    if len(description.encode("utf-8")) > 5000 or "<" in description or ">" in description:
        sys.exit("Descripción no válida: máximo 5000 bytes y sin '<' ni '>'.")

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
            sys.exit("La miniatura supera los 2 MB.")
        meta["thumbnail"] = thumb_path

    meta["title"], meta["description"], meta["tags"] = title, description, tags
    return meta


# ---------------------------------------------------------------- subida
def upload_video(youtube, video: Path, meta: dict) -> str:
    body = {
        "snippet": {
            "title": meta["title"],
            "description": meta["description"],
            "tags": meta["tags"],
            "categoryId": str(meta.get("categoryId", "22")),  # 22 = People & Blogs
            "defaultLanguage": meta.get("language", "es"),
            "defaultAudioLanguage": meta.get("language", "es"),
        },
        "status": {
            "privacyStatus": "private",
            "selfDeclaredMadeForKids": bool(meta.get("madeForKids", False)),
            # Declaración de contenido alterado o sintético (voz/imagen generada con IA).
            "containsSyntheticMedia": bool(meta.get("containsSyntheticMedia", True)),
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


def set_thumbnail(youtube, video_id: str, thumb: Path):
    mime = "image/png" if thumb.suffix.lower() == ".png" else "image/jpeg"
    youtube.thumbnails().set(
        videoId=video_id, media_body=MediaFileUpload(str(thumb), mimetype=mime)
    ).execute()


# ---------------------------------------------------------------- main
def subir_a_canal(canal: str, args, meta: dict):
    youtube = get_service(canal, args.client_secret, args.headless)

    print(f"Subiendo «{meta['title']}» en privado...")
    video_id = upload_video(youtube, args.video, meta)
    print(f"Vídeo subido: https://youtu.be/{video_id}")

    if meta.get("thumbnail"):
        try:
            set_thumbnail(youtube, video_id, meta["thumbnail"])
            print("Miniatura aplicada.")
        except HttpError as e:
            # El error más habitual es 403: el canal no tiene verificadas las
            # funciones intermedias (verificación por teléfono).
            print(f"No se pudo poner la miniatura ({e.resp.status}): {e}")

    return {"canal": canal, "videoId": video_id, "url": f"https://youtu.be/{video_id}"}


def main():
    p = argparse.ArgumentParser(description="Sube un vídeo a YouTube en privado.")
    p.add_argument("--canal", action="append", help="Nombre del canal (se puede repetir). Si falta, se usa 'canal' del JSON")
    p.add_argument("--vincular", action="store_true", help="Solo autoriza el canal, sin subir nada")
    p.add_argument("--video", type=Path)
    p.add_argument("--meta", type=Path, help="JSON con título, descripción, etiquetas y miniatura")
    p.add_argument("--client-secret", default=BASE_DIR / "client_secret.json", type=Path)
    p.add_argument("--headless", action="store_true", help="No abrir navegador en la primera autorización")
    args = p.parse_args()

    if args.vincular:
        if not args.canal:
            sys.exit("Indica el canal: --canal NOMBRE --vincular")
        for canal in args.canal:
            get_service(canal, args.client_secret, args.headless)
        return

    if not args.video or not args.meta:
        sys.exit("Faltan --video y --meta.")
    if not args.video.exists():
        sys.exit(f"No existe el vídeo: {args.video}")

    meta = validate(json.loads(args.meta.read_text(encoding="utf-8")), args.meta.parent)

    canales = args.canal or meta.get("canal")
    if isinstance(canales, str):
        canales = [canales]
    if not canales:
        sys.exit("No sé a qué canal subirlo: usa --canal o pon \"canal\" en el JSON.")

    resultados = [subir_a_canal(c, args, meta) for c in canales]

    # Deja constancia de los IDs para el resto del flujo automático.
    args.meta.with_suffix(".youtube.json").write_text(
        json.dumps(resultados, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
