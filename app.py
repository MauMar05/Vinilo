"""
Vinilo — reproductor de música con búsqueda en YouTube, cuentas de usuario
y base de datos para favoritos, historial de reproducción y búsquedas.

El backend hace 3 cosas:
  1. Buscar en YouTube (yt-dlp, solo metadata, no descarga nada).
  2. Manejar cuentas de usuario (registro/login/logout) con Flask-Login.
  3. Guardar y servir favoritos/historial por usuario en la base de datos.

Requisitos:
    pip install -r requirements.txt

Variables de entorno:
    DATABASE_URL   Cadena de conexión a Postgres (Neon, por ejemplo).
                   Si no se define, usa un archivo SQLite local (solo para
                   desarrollo — en Render el disco no es permanente).
    SECRET_KEY     Clave secreta para las sesiones. Cambiar en producción.

Uso local:
    python app.py
    Abre http://localhost:5000 en tu navegador
"""

import os
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    login_required, current_user,
)
from werkzeug.security import generate_password_hash, check_password_hash
import yt_dlp

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "cambia-esto-en-produccion")

# --- Configuración de la base de datos ---
url_bd = os.environ.get("DATABASE_URL", "sqlite:///vinilo.db")
# Algunos proveedores (Neon, Render) dan la URL como "postgres://",
# pero SQLAlchemy moderno requiere el prefijo "postgresql://".
if url_bd.startswith("postgres://"):
    url_bd = url_bd.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = url_bd
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}

db = SQLAlchemy(app)

login_manager = LoginManager(app)
login_manager.login_view = "login"
login_manager.login_message = "Inicia sesión para continuar."


# ==================== MODELOS ====================

class Usuario(UserMixin, db.Model):
    __tablename__ = "usuarios"
    id = db.Column(db.Integer, primary_key=True)
    nombre_usuario = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    creado_en = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def establecer_password(self, password):
        self.password_hash = generate_password_hash(password)

    def verificar_password(self, password):
        return check_password_hash(self.password_hash, password)


class Favorito(db.Model):
    __tablename__ = "favoritos"
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=False)
    video_id = db.Column(db.String(20), nullable=False)
    titulo = db.Column(db.String(300))
    canal = db.Column(db.String(200))
    miniatura = db.Column(db.String(300))
    duracion = db.Column(db.String(20))
    creado_en = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint("usuario_id", "video_id", name="unico_favorito_por_usuario"),
    )

    def a_dict(self):
        return {
            "id": self.video_id,
            "titulo": self.titulo,
            "canal": self.canal,
            "miniatura": self.miniatura,
            "duracion": self.duracion,
        }


class Busqueda(db.Model):
    __tablename__ = "busquedas"
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=False)
    consulta = db.Column(db.String(200), nullable=False)
    creado_en = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class Reproduccion(db.Model):
    __tablename__ = "reproducciones"
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=False)
    video_id = db.Column(db.String(20), nullable=False)
    titulo = db.Column(db.String(300))
    canal = db.Column(db.String(200))
    miniatura = db.Column(db.String(300))
    duracion = db.Column(db.String(20))
    creado_en = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def a_dict(self):
        return {
            "id": self.video_id,
            "titulo": self.titulo,
            "canal": self.canal,
            "miniatura": self.miniatura,
            "duracion": self.duracion,
        }


@login_manager.user_loader
def cargar_usuario(user_id):
    return db.session.get(Usuario, int(user_id))


# ==================== BÚSQUEDA EN YOUTUBE ====================

def buscar_en_youtube(query: str, limite: int = 12):
    opciones = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
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


# ==================== PÁGINAS ====================

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/registro", methods=["GET", "POST"])
def registro():
    if current_user.is_authenticated:
        return redirect(url_for("home"))

    if request.method == "POST":
        nombre_usuario = request.form.get("nombre_usuario", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        error = None
        if len(nombre_usuario) < 3:
            error = "El nombre de usuario debe tener al menos 3 caracteres."
        elif "@" not in email:
            error = "Ingresa un correo válido."
        elif len(password) < 6:
            error = "La contraseña debe tener al menos 6 caracteres."
        elif Usuario.query.filter_by(nombre_usuario=nombre_usuario).first():
            error = "Ese nombre de usuario ya está en uso."
        elif Usuario.query.filter_by(email=email).first():
            error = "Ya existe una cuenta con ese correo."

        if error:
            return render_template("registro.html", error=error, nombre_usuario=nombre_usuario, email=email)

        usuario = Usuario(nombre_usuario=nombre_usuario, email=email)
        usuario.establecer_password(password)
        db.session.add(usuario)
        db.session.commit()
        login_user(usuario)
        return redirect(url_for("home"))

    return render_template("registro.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("home"))

    if request.method == "POST":
        identificador = request.form.get("identificador", "").strip().lower()
        password = request.form.get("password", "")

        usuario = Usuario.query.filter(
            (db.func.lower(Usuario.email) == identificador) |
            (db.func.lower(Usuario.nombre_usuario) == identificador)
        ).first()

        if usuario and usuario.verificar_password(password):
            login_user(usuario)
            return redirect(url_for("home"))

        return render_template("login.html", error="Usuario o contraseña incorrectos.", identificador=identificador)

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("home"))


# ==================== API: BÚSQUEDA ====================

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


# ==================== API: FAVORITOS ====================

@app.route("/api/favoritos", methods=["GET"])
@login_required
def api_obtener_favoritos():
    favoritos = Favorito.query.filter_by(usuario_id=current_user.id).order_by(Favorito.creado_en.desc()).all()
    return jsonify({"favoritos": [f.a_dict() for f in favoritos]})


@app.route("/api/favoritos", methods=["POST"])
@login_required
def api_alternar_favorito():
    datos = request.get_json(silent=True) or {}
    video_id = datos.get("id")
    if not video_id:
        return jsonify({"error": "Falta el id del video."}), 400

    existente = Favorito.query.filter_by(usuario_id=current_user.id, video_id=video_id).first()
    if existente:
        db.session.delete(existente)
        db.session.commit()
        return jsonify({"favorito": False})

    nuevo = Favorito(
        usuario_id=current_user.id,
        video_id=video_id,
        titulo=datos.get("titulo", ""),
        canal=datos.get("canal", ""),
        miniatura=datos.get("miniatura", ""),
        duracion=datos.get("duracion", ""),
    )
    db.session.add(nuevo)
    db.session.commit()
    return jsonify({"favorito": True})


# ==================== API: HISTORIAL DE BÚSQUEDAS ====================

MAX_BUSQUEDAS_GUARDADAS = 8


@app.route("/api/historial-busquedas", methods=["GET"])
@login_required
def api_obtener_busquedas():
    busquedas = (
        Busqueda.query.filter_by(usuario_id=current_user.id)
        .order_by(Busqueda.creado_en.desc())
        .limit(MAX_BUSQUEDAS_GUARDADAS)
        .all()
    )
    return jsonify({"busquedas": [b.consulta for b in busquedas]})


@app.route("/api/historial-busquedas", methods=["POST"])
@login_required
def api_guardar_busqueda():
    datos = request.get_json(silent=True) or {}
    consulta = (datos.get("consulta") or "").strip()
    if not consulta:
        return jsonify({"error": "Falta la consulta."}), 400

    # Quita duplicados previos de la misma consulta para que no se repita en la lista
    Busqueda.query.filter_by(usuario_id=current_user.id, consulta=consulta).delete()
    db.session.add(Busqueda(usuario_id=current_user.id, consulta=consulta))
    db.session.commit()

    # Se queda solo con las últimas MAX_BUSQUEDAS_GUARDADAS
    todas = (
        Busqueda.query.filter_by(usuario_id=current_user.id)
        .order_by(Busqueda.creado_en.desc())
        .all()
    )
    for vieja in todas[MAX_BUSQUEDAS_GUARDADAS:]:
        db.session.delete(vieja)
    db.session.commit()

    return jsonify({"ok": True})


@app.route("/api/historial-busquedas", methods=["DELETE"])
@login_required
def api_borrar_busquedas():
    Busqueda.query.filter_by(usuario_id=current_user.id).delete()
    db.session.commit()
    return jsonify({"ok": True})


# ==================== API: HISTORIAL DE REPRODUCCIÓN ====================

MAX_REPRODUCCIONES_GUARDADAS = 30


@app.route("/api/historial-reproduccion", methods=["GET"])
@login_required
def api_obtener_reproducciones():
    reproducciones = (
        Reproduccion.query.filter_by(usuario_id=current_user.id)
        .order_by(Reproduccion.creado_en.desc())
        .limit(MAX_REPRODUCCIONES_GUARDADAS)
        .all()
    )
    return jsonify({"reproducciones": [r.a_dict() for r in reproducciones]})


@app.route("/api/historial-reproduccion", methods=["POST"])
@login_required
def api_guardar_reproduccion():
    datos = request.get_json(silent=True) or {}
    video_id = datos.get("id")
    if not video_id:
        return jsonify({"error": "Falta el id del video."}), 400

    # Evita duplicados: si ya estaba en el historial, se mueve al frente
    Reproduccion.query.filter_by(usuario_id=current_user.id, video_id=video_id).delete()
    db.session.add(Reproduccion(
        usuario_id=current_user.id,
        video_id=video_id,
        titulo=datos.get("titulo", ""),
        canal=datos.get("canal", ""),
        miniatura=datos.get("miniatura", ""),
        duracion=datos.get("duracion", ""),
    ))
    db.session.commit()

    todas = (
        Reproduccion.query.filter_by(usuario_id=current_user.id)
        .order_by(Reproduccion.creado_en.desc())
        .all()
    )
    for vieja in todas[MAX_REPRODUCCIONES_GUARDADAS:]:
        db.session.delete(vieja)
    db.session.commit()

    return jsonify({"ok": True})


@app.route("/api/historial-reproduccion", methods=["DELETE"])
@login_required
def api_borrar_reproducciones():
    Reproduccion.query.filter_by(usuario_id=current_user.id).delete()
    db.session.commit()
    return jsonify({"ok": True})


with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(debug=True, port=5000)
