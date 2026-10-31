#!/usr/bin/env python3
"""
Sube un vídeo a YouTube en PRIVADO con título, descripción, etiquetas y miniatura.

Uso:
    python upload_youtube.py --video salida/video.mp4 --meta salida/video.json

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
def get_service(client_secret: Path, token_file: Path, headless: bool):
    creds = None
    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not client_secret.exists():
                sys.exit(f"Falta {client_secret}: descárgalo de Google Cloud (credencial OAuth de escritorio).")
            flow =InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
            # La primera vez abre el navegador para dar permiso. Con --headless
            # imprime la URL y hay que abrirla a mano en un equipo con navegador.
            creds = flow.run_local_server(port=0, open_browser=not headless)
        token_file.write_text(creds.to_json(), encoding="utf-8")

    return build("youtube", "v3", credentials=creds)


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
def main():
    p = argparse.ArgumentParser(description="Sube un vídeo a YouTube en privado.")
    p.add_argument("--video", required=True, type=Path)
    p.add_argument("--meta", required=True, type=Path, help="JSON con título, descripción, etiquetas y miniatura")
    p.add_argument("--client-secret", default=Path("client_secret.json"), type=Path)
    p.add_argument("--token", default=Path("token.json"), type=Path)
    p.add_argument("--headless", action="store_true", help="No abrir navegador en la primera autorización")
    args = p.parse_args()

    if not args.video.exists():
        sys.exit(f"No existe el vídeo: {args.video}")

    meta = validate(json.loads(args.meta.read_text(encoding="utf-8")), args.meta.parent)
    youtube = get_service(args.client_secret, args.token, args.headless)

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

    # Deja constancia del ID para el resto del flujo automático.
    (args.meta.with_suffix(".youtube.json")).write_text(
        json.dumps({"videoId": video_id, "url": f"https://youtu.be/{video_id}"}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
