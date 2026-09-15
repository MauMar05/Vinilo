// ---------- Estado del reproductor de YouTube ----------
let player = null;
let playerListo = false;
let videoActualId = null;
let cancionPendiente = null;
let intervaloProgreso = null;

let listaReproduccion = [];
let indiceActual = -1;

let resultadosBusqueda = [];
let pestanaActiva = 'resultados';

// Cachés en memoria (se llenan desde el backend si hay sesión, o desde
// localStorage si es invitado). Todo el renderizado lee de aquí, así que
// no importa de dónde vinieron los datos.
let favoritosCache = {};      // { id: cancion }
let recientesCache = [];      // ['consulta1', 'consulta2', ...]
let historialCache = [];      // [cancion, cancion, ...]

const AUTENTICADO = window.USUARIO_AUTENTICADO === true;

const CLAVE_FAVORITOS = 'vinilo_favoritos';
const CLAVE_RECIENTES = 'vinilo_recientes';
const CLAVE_HISTORIAL = 'vinilo_historial';

const ICONO_CORAZON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-6.7-4.35-9.3-8.1C1.1 10.5 1.6 7.3 4 5.6 6 4.2 8.6 4.6 10 6.3l2 2.4 2-2.4c1.4-1.7 4-2.1 6-.7 2.4 1.7 2.9 4.9 1.3 7.3C18.7 16.65 12 21 12 21z"/></svg>`;

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1 },
    events: {
      onReady: () => {
        playerListo = true;
        if (cancionPendiente) {
          const { cancion, lista, indice } = cancionPendiente;
          cancionPendiente = null;
          reproducirCancion(cancion, lista, indice);
        }
      },
      onStateChange: alCambiarEstado,
      onError: alOcurrirError,
    },
  });
};

const $ = (sel) => document.querySelector(sel);

const formBuscar = $('#form-buscar');
const inputBuscar = $('#input-buscar');
const estadoBusqueda = $('#estado-busqueda');
const listaResultados = $('#lista-resultados');
const chipsRecientes = $('#chips-recientes');
const pestanas = document.querySelectorAll('.pestana');

const vacio = $('#vacio');
const reproductor = $('#reproductor');
const carratula = $('#carratula');
const tituloCancion = $('#titulo-cancion');
const canalCancion = $('#canal-cancion');
const btnFavorito = $('#btn-favorito');
const logoVinilo = $('.logo-vinilo');

const btnPlay = $('#btn-play');
const btnAnterior = $('#btn-anterior');
const btnSiguiente = $('#btn-siguiente');
const iconoPlay = $('#icono-play');
const iconoPausa = $('#icono-pausa');
const barraProgreso = $('#barra-progreso');
const tiempoActual = $('#tiempo-actual');
const tiempoTotal = $('#tiempo-total');
const barraVolumen = $('#barra-volumen');

// ==================== PERSISTENCIA: FAVORITOS ====================

function cargarFavoritosLocal() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_FAVORITOS)) || {};
  } catch {
    return {};
  }
}

async function cargarFavoritosInicial() {
  if (AUTENTICADO) {
    try {
      const resp = await fetch('/api/favoritos');
      const datos = await resp.json();
      favoritosCache = {};
      (datos.favoritos || []).forEach((f) => { favoritosCache[f.id] = f; });
    } catch {
      favoritosCache = {};
    }
  } else {
    favoritosCache = cargarFavoritosLocal();
  }
}

function esFavorito(id) {
  return Boolean(favoritosCache[id]);
}

async function alternarFavorito(cancion) {
  if (AUTENTICADO) {
    try {
      const resp = await fetch('/api/favoritos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cancion),
      });
      const datos = await resp.json();
      if (datos.favorito) {
        favoritosCache[cancion.id] = cancion;
      } else {
        delete favoritosCache[cancion.id];
      }
    } catch {
      estadoBusqueda.textContent = 'No se pudo guardar el favorito. Revisa tu conexión.';
      return;
    }
  } else {
    const favoritos = cargarFavoritosLocal();
    if (favoritos[cancion.id]) {
      delete favoritos[cancion.id];
    } else {
      favoritos[cancion.id] = cancion;
    }
    localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(favoritos));
    favoritosCache = favoritos;
  }

  actualizarBotonFavoritoPrincipal();
  actualizarCorazonesEnLista();
  if (pestanaActiva === 'favoritos') mostrarPestana('favoritos');
}

function actualizarBotonFavoritoPrincipal() {
  if (!videoActualId) return;
  btnFavorito.classList.toggle('activo', esFavorito(videoActualId));
}

function actualizarCorazonesEnLista() {
  document.querySelectorAll('.item-resultado').forEach((el) => {
    const boton = el.querySelector('.btn-corazon');
    if (boton) boton.classList.toggle('activo', esFavorito(el.dataset.id));
  });
}

// ==================== PERSISTENCIA: BÚSQUEDAS RECIENTES ====================

function cargarRecientesLocal() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_RECIENTES)) || [];
  } catch {
    return [];
  }
}

async function cargarRecientesInicial() {
  if (AUTENTICADO) {
    try {
      const resp = await fetch('/api/historial-busquedas');
      const datos = await resp.json();
      recientesCache = datos.busquedas || [];
    } catch {
      recientesCache = [];
    }
  } else {
    recientesCache = cargarRecientesLocal();
  }
}

async function guardarReciente(query) {
  if (AUTENTICADO) {
    try {
      await fetch('/api/historial-busquedas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consulta: query }),
      });
      await cargarRecientesInicial();
    } catch {
      // si falla, simplemente no se guarda; no bloquea la búsqueda
    }
  } else {
    let recientes = cargarRecientesLocal().filter((q) => q.toLowerCase() !== query.toLowerCase());
    recientes.unshift(query);
    recientes = recientes.slice(0, 8);
    localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(recientes));
    recientesCache = recientes;
  }
  renderizarChipsRecientes();
}

async function borrarBusquedasRecientes() {
  if (AUTENTICADO) {
    try {
      await fetch('/api/historial-busquedas', { method: 'DELETE' });
    } catch {
      /* no-op */
    }
  } else {
    localStorage.removeItem(CLAVE_RECIENTES);
  }
  recientesCache = [];
  renderizarChipsRecientes();
}

function renderizarChipsRecientes() {
  chipsRecientes.innerHTML = '';
  recientesCache.forEach((q) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip-reciente';
    chip.textContent = q;
    chip.addEventListener('click', () => {
      inputBuscar.value = q;
      formBuscar.requestSubmit();
    });
    chipsRecientes.appendChild(chip);
  });

  if (recientesCache.length) {
    const btnBorrar = document.createElement('button');
    btnBorrar.type = 'button';
    btnBorrar.className = 'btn-borrar-historial';
    btnBorrar.textContent = 'Borrar historial';
    btnBorrar.addEventListener('click', borrarBusquedasRecientes);
    chipsRecientes.appendChild(btnBorrar);
  }
}

// ==================== PERSISTENCIA: HISTORIAL DE REPRODUCCIÓN ====================

function cargarHistorialLocal() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_HISTORIAL)) || [];
  } catch {
    return [];
  }
}

async function cargarHistorialInicial() {
  if (AUTENTICADO) {
    try {
      const resp = await fetch('/api/historial-reproduccion');
      const datos = await resp.json();
      historialCache = datos.reproducciones || [];
    } catch {
      historialCache = [];
    }
  } else {
    historialCache = cargarHistorialLocal();
  }
}

function registrarReproduccion(cancion) {
  // No bloquea la reproducción: se guarda en segundo plano.
  historialCache = [cancion, ...historialCache.filter((h) => h.id !== cancion.id)].slice(0, 30);
  if (pestanaActiva === 'historial') renderizarLista(historialCache);

  if (AUTENTICADO) {
    fetch('/api/historial-reproduccion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cancion),
    }).catch(() => {});
  } else {
    localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(historialCache));
  }
}

async function vaciarHistorialReproduccion() {
  if (AUTENTICADO) {
    try {
      await fetch('/api/historial-reproduccion', { method: 'DELETE' });
    } catch {
      /* no-op */
    }
  } else {
    localStorage.removeItem(CLAVE_HISTORIAL);
  }
  historialCache = [];
  mostrarPestana('historial');
}

// ==================== PESTAÑAS: Resultados / Favoritos / Historial ====================

pestanas.forEach((btn) => {
  btn.addEventListener('click', () => mostrarPestana(btn.dataset.pestana));
});

function mostrarPestana(nombre) {
  pestanaActiva = nombre;
  pestanas.forEach((btn) => btn.classList.toggle('activa', btn.dataset.pestana === nombre));

  if (nombre === 'resultados') {
    if (resultadosBusqueda.length) {
      renderizarLista(resultadosBusqueda);
    } else {
      listaResultados.innerHTML = '<li class="mensaje-lista-vacia">Busca algo para ver resultados.</li>';
    }
    return;
  }

  if (nombre === 'favoritos') {
    const favoritos = Object.values(favoritosCache);
    if (favoritos.length) {
      renderizarLista(favoritos);
    } else {
      listaResultados.innerHTML = '<li class="mensaje-lista-vacia">Todavía no tienes canciones favoritas. Dale al corazón mientras escuchas algo.</li>';
    }
    return;
  }

  // historial
  if (historialCache.length) {
    renderizarLista(historialCache);
    const liAccion = document.createElement('li');
    liAccion.className = 'mensaje-lista-vacia';
    liAccion.innerHTML = '<button type="button" class="btn-borrar-historial">Vaciar historial</button>';
    liAccion.querySelector('button').addEventListener('click', vaciarHistorialReproduccion);
    listaResultados.appendChild(liAccion);
  } else {
    listaResultados.innerHTML = '<li class="mensaje-lista-vacia">Todavía no has escuchado nada.</li>';
  }
}

// ==================== Reproductor de YouTube ====================

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
  const esRestriccionEmbed = evento.data === 101 || evento.data === 150;

  if (esRestriccionEmbed && videoActualId) {
    const url = `https://www.youtube.com/watch?v=${videoActualId}`;
    estadoBusqueda.innerHTML = `${texto} <a href="${url}" target="_blank" rel="noopener" style="color:#D9A441;">Abrir en YouTube</a> o prueba otro resultado.`;
  } else {
    estadoBusqueda.textContent = `${texto} Prueba con otro resultado de la lista.`;
  }
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
    avanzarSiguiente();
  }
}

function mostrarIconoPausa() {
  iconoPlay.style.display = 'none';
  iconoPausa.style.display = 'block';
  logoVinilo.classList.add('girando');
}

function mostrarIconoPlay() {
  iconoPlay.style.display = 'block';
  iconoPausa.style.display = 'none';
  logoVinilo.classList.remove('girando');
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

// ==================== Búsqueda ====================

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
    guardarReciente(query);
    resultadosBusqueda = datos.resultados;
    mostrarPestana('resultados');
  } catch (err) {
    estadoBusqueda.textContent = 'Error de conexión con el servidor.';
  }
});

function renderizarLista(lista) {
  listaResultados.innerHTML = '';
  lista.forEach((r, indice) => {
    const li = document.createElement('li');
    li.className = 'item-resultado';
    li.dataset.id = r.id;
    li.innerHTML = `
      <img src="${r.miniatura}" alt="">
      <div class="texto">
        <div class="item-titulo">${escaparHtml(r.titulo)}</div>
        <div class="item-meta">${escaparHtml(r.canal)} · ${r.duracion}</div>
      </div>
      <button type="button" class="btn-corazon ${esFavorito(r.id) ? 'activo' : ''}" aria-label="Favorito">${ICONO_CORAZON}</button>
    `;
    li.addEventListener('click', () => reproducirCancion(r, lista, indice));
    li.querySelector('.btn-corazon').addEventListener('click', (e) => {
      e.stopPropagation();
      alternarFavorito(r);
    });
    listaResultados.appendChild(li);
  });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// ==================== Reproducción ====================

function reproducirCancion(cancion, lista, indice) {
  if (!playerListo) {
    cancionPendiente = { cancion, lista, indice };
    estadoBusqueda.textContent = 'Cargando el reproductor, ya casi empieza…';
    return;
  }

  listaReproduccion = lista || [cancion];
  indiceActual = typeof indice === 'number' ? indice : 0;

   videoActualId = cancion.id;
  vacio.style.display = 'none';
  reproductor.classList.remove('oculto');
  document.body.classList.add('hay-reproduccion');

  carratula.src = cancion.miniatura;
  tituloCancion.textContent = cancion.titulo;
  canalCancion.textContent = cancion.canal;
  barraProgreso.value = 0;
  tiempoActual.textContent = '0:00';
  tiempoTotal.textContent = cancion.duracion;

  marcarActivoEnLista(cancion.id);
  actualizarBotonFavoritoPrincipal();
  actualizarBotonesNavegacion();
  registrarReproduccion(cancion);

  player.loadVideoById(cancion.id);
  player.setVolume(Number(barraVolumen.value));
}

function marcarActivoEnLista(id) {
  document.querySelectorAll('.item-resultado').forEach((el) => {
    el.classList.toggle('activo', el.dataset.id === id);
  });
}

function actualizarBotonesNavegacion() {
  btnAnterior.disabled = indiceActual <= 0;
  btnSiguiente.disabled = indiceActual >= listaReproduccion.length - 1;
  btnAnterior.style.opacity = btnAnterior.disabled ? 0.35 : 1;
  btnSiguiente.style.opacity = btnSiguiente.disabled ? 0.35 : 1;
}

function avanzarSiguiente() {
  if (indiceActual < 0 || indiceActual >= listaReproduccion.length - 1) return;
  const nuevoIndice = indiceActual + 1;
  reproducirCancion(listaReproduccion[nuevoIndice], listaReproduccion, nuevoIndice);
}

function retrocederAnterior() {
  if (indiceActual <= 0) return;
  const nuevoIndice = indiceActual - 1;
  reproducirCancion(listaReproduccion[nuevoIndice], listaReproduccion, nuevoIndice);
}

// ==================== Controles ====================

btnPlay.addEventListener('click', () => {
  if (!player) return;
  const estado = player.getPlayerState();
  if (estado === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
});

btnSiguiente.addEventListener('click', avanzarSiguiente);
btnAnterior.addEventListener('click', retrocederAnterior);

btnFavorito.addEventListener('click', () => {
  if (!videoActualId) return;
  alternarFavorito({
    id: videoActualId,
    titulo: tituloCancion.textContent,
    canal: canalCancion.textContent,
    miniatura: carratula.src,
    duracion: tiempoTotal.textContent,
  });
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

// ==================== Inicio ====================

async function iniciar() {
  await Promise.all([cargarFavoritosInicial(), cargarRecientesInicial(), cargarHistorialInicial()]);
  renderizarChipsRecientes();
  mostrarPestana('resultados');
}

iniciar();
