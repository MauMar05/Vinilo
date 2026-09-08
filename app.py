"""
Vinilo — reproductor de música con búsqueda en YouTube.

El backend solo se encarga de BUSCAR (usa yt-dlp para obtener
id, título, canal, miniatura y duración). La reproducción real
ocurre en el navegador con el reproductor oficial de YouTube
(IFrame Player API), así que no se extrae ni descarga audio.

Requisitos:
    pip install flask yt-dlp

Uso:
    python app.py
    Abre http://localhost:5000 en tu navegador
"""

from flask import Flask, jsonify, render_template, request
import yt_dlp

app = Flask(__name__)


def buscar_en_youtube(query: str, limite: int = 12):
    opciones = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,       # solo metadata, no descarga nada
    }

    with yt_dlp.YoutubeDL(opciones) as ydl:
        info = ydl.extract_info(f"ytsearch{limite}:{query}", download=False)

    entradas = info.get("entries", []) if info else []
    resultados = []
    for e in entradas:
        if not e:
            continue
        duracion = e.get("duration") or 0
        mins, segs = divmod(int(duracion), 60)
        resultados.append({
            "id": e.get("id"),
            "titulo": e.get("title", "Sin título"),
            "canal": e.get("uploader") or e.get("channel") or "Desconocido",
            "duracion": f"{mins}:{segs:02d}",
            "miniatura": f"https://i.ytimg.com/vi/{e.get('id')}/mqdefault.jpg",
        })
    return resultados


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/buscar")
def api_buscar():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"resultados": []})
    try:
        resultados = buscar_en_youtube(query)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"resultados": resultados})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
