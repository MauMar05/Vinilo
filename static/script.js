// ---------- Estado ----------
let player = null;
let playerListo = false;
let videoActualId = null;
let intervaloProgreso = null;

const $ = (sel) => document.querySelector(sel);

const formBuscar = $('#form-buscar');
const inputBuscar = $('#input-buscar');
const estadoBusqueda = $('#estado-busqueda');
const listaResultados = $('#lista-resultados');

const vacio = $('#vacio');
const reproductor = $('#reproductor');
const carratula = $('#carratula');
const tituloCancion = $('#titulo-cancion');
const canalCancion = $('#canal-cancion');

const btnPlay = $('#btn-play');
const iconoPlay = $('#icono-play');
const iconoPausa = $('#icono-pausa');
const barraProgreso = $('#barra-progreso');
const tiempoActual = $('#tiempo-actual');
const tiempoTotal = $('#tiempo-total');
const barraVolumen = $('#barra-volumen');

// ---------- Reproductor de YouTube (oculto, solo motor de audio) ----------
// Esta función la llama automáticamente el script de la IFrame API cuando carga.
window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
    },
    events: {
      onReady: () => { playerListo = true; },
      onStateChange: alCambiarEstado,
      onError: alOcurrirError,
    },
  });
};

function alOcurrirError(evento) {
  clearInterval(intervaloProgreso);
  mostrarIconoPlay();

  const mensajes = {
    2: 'Enlace inválido para ese video.',
    5: 'Ese video no se puede reproducir en este navegador.',
    100: 'Ese video ya no existe o es privado.',
    101: 'El dueño de ese video no permite reproducirlo fuera de YouTube.',
    150: 'El dueño de ese video no permite reproducirlo fuera de YouTube.',
  };

  const texto = mensajes[evento.data] || 'No se pudo reproducir ese video.';
  estadoBusqueda.textContent = `${texto} Prueba con otro resultado de la lista.`;
}

function alCambiarEstado(evento) {
  if (evento.data === YT.PlayerState.PLAYING) {
    mostrarIconoPausa();
    iniciarSeguimientoProgreso();
    estadoBusqueda.textContent = '';
  } else {
    mostrarIconoPlay();
  }
  if (evento.data === YT.PlayerState.ENDED) {
    barraProgreso.value = 0;
  }
}

function mostrarIconoPausa() {
  iconoPlay.style.display = 'none';
  iconoPausa.style.display = 'block';
}

function mostrarIconoPlay() {
  iconoPlay.style.display = 'block';
  iconoPausa.style.display = 'none';
}

function formatearTiempo(segundos) {
  segundos = Math.floor(segundos || 0);
  const mins = Math.floor(segundos / 60);
  const segs = segundos % 60;
  return `${mins}:${segs.toString().padStart(2, '0')}`;
}

function iniciarSeguimientoProgreso() {
  clearInterval(intervaloProgreso);
  intervaloProgreso = setInterval(() => {
    if (!player || !player.getCurrentTime) return;
    const actual = player.getCurrentTime();
    const total = player.getDuration();
    if (total > 0) {
      barraProgreso.value = (actual / total) * 100;
      tiempoActual.textContent = formatearTiempo(actual);
      tiempoTotal.textContent = formatearTiempo(total);
    }
  }, 500);
}

// ---------- Búsqueda ----------
formBuscar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = inputBuscar.value.trim();
  if (!query) return;

  estadoBusqueda.textContent = 'Buscando…';
  listaResultados.innerHTML = '';

  try {
    const resp = await fetch(`/api/buscar?q=${encodeURIComponent(query)}`);
    const datos = await resp.json();

    if (datos.error) {
      estadoBusqueda.textContent = 'No se pudo buscar. Intenta de nuevo.';
      return;
    }

    if (!datos.resultados.length) {
      estadoBusqueda.textContent = 'Sin resultados.';
      return;
    }

    estadoBusqueda.textContent = '';
    renderizarResultados(datos.resultados);
  } catch (err) {
    estadoBusqueda.textContent = 'Error de conexión con el servidor.';
  }
});

function renderizarResultados(resultados) {
  listaResultados.innerHTML = '';
  resultados.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'item-resultado';
    li.dataset.id = r.id;
    li.innerHTML = `
      <img src="${r.miniatura}" alt="">
      <div class="texto">
        <div class="item-titulo">${escaparHtml(r.titulo)}</div>
        <div class="item-meta">${escaparHtml(r.canal)} · ${r.duracion}</div>
      </div>
    `;
    li.addEventListener('click', () => reproducirCancion(r));
    listaResultados.appendChild(li);
  });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// ---------- Reproducción ----------
function reproducirCancion(cancion) {
  if (!playerListo) {
    estadoBusqueda.textContent = 'El reproductor todavía está cargando, intenta de nuevo en un segundo.';
    return;
  }

  videoActualId = cancion.id;
  vacio.style.display = 'none';
  reproductor.classList.remove('oculto');

  carratula.src = cancion.miniatura;
  tituloCancion.textContent = cancion.titulo;
  canalCancion.textContent = cancion.canal;
  barraProgreso.value = 0;
  tiempoActual.textContent = '0:00';
  tiempoTotal.textContent = cancion.duracion;

  marcarActivoEnLista(cancion.id);

  player.loadVideoById(cancion.id);
  player.setVolume(Number(barraVolumen.value));
}

function marcarActivoEnLista(id) {
  document.querySelectorAll('.item-resultado').forEach((el) => {
    el.classList.toggle('activo', el.dataset.id === id);
  });
}

// ---------- Controles ----------
btnPlay.addEventListener('click', () => {
  if (!player) return;
  const estado = player.getPlayerState();
  if (estado === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
});

barraProgreso.addEventListener('input', () => {
  if (!player || !player.getDuration) return;
  const total = player.getDuration();
  const nuevoTiempo = (barraProgreso.value / 100) * total;
  player.seekTo(nuevoTiempo, true);
});

barraVolumen.addEventListener('input', () => {
  if (!player) return;
  player.setVolume(Number(barraVolumen.value));
});
