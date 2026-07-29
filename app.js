import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import {
  DEPTOS_HN, PILARES,
  EXTENSION_PUNTOS, REVERSIBILIDAD_PUNTOS, AREA_PROTEGIDA_PUNTOS, REINCIDENCIA_PUNTOS,
  calcularIGD, asignarUICN,
} from "./igd.js";

// ── Firebase, con caché local persistente (esto es lo que permite
//    que la app funcione y guarde datos SIN internet: Firestore
//    guarda localmente en el teléfono y sincroniza solo cuando
//    vuelve la conexión) ──────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
});

// ── Selects dinámicos ──────────────────────────────────────────
function llenarSelect(id, opciones) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  opciones.forEach((op) => {
    const opt = document.createElement("option");
    opt.value = op;
    opt.textContent = op;
    el.appendChild(opt);
  });
}
llenarSelect("departamento", Object.keys(DEPTOS_HN).sort());
llenarSelect("pilar", PILARES);

function crearRadios(containerId, opciones, name) {
  const cont = document.getElementById(containerId);
  cont.innerHTML = "";
  Object.keys(opciones).forEach((texto, i) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="${name}" value="${texto}" ${i === 0 ? "checked" : ""}> ${texto}`;
    if (i === 0) label.classList.add("checked");
    label.addEventListener("click", () => {
      cont.querySelectorAll("label").forEach((l) => l.classList.remove("checked"));
      label.classList.add("checked");
    });
    cont.appendChild(label);
  });
}
crearRadios("grupo-extension", EXTENSION_PUNTOS, "extension");
crearRadios("grupo-reversibilidad", REVERSIBILIDAD_PUNTOS, "reversibilidad");
crearRadios("grupo-area", AREA_PROTEGIDA_PUNTOS, "area");
crearRadios("grupo-reincidencia", REINCIDENCIA_PUNTOS, "reincidencia");

function valorSeleccionado(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

// ── Estado de conexión ──────────────────────────────────────────
const statusBar = document.getElementById("status-bar");
function actualizarEstadoConexion() {
  if (navigator.onLine) {
    statusBar.textContent = "🟢 Conectado — los reportes se envían al instante";
    statusBar.className = "online";
  } else {
    statusBar.textContent = "🟡 Sin conexión — tu reporte se guardará en el teléfono y se enviará cuando vuelva la señal";
    statusBar.className = "offline";
  }
}
window.addEventListener("online", actualizarEstadoConexion);
window.addEventListener("offline", actualizarEstadoConexion);
actualizarEstadoConexion();

// ── Ubicación GPS (funciona sin internet, usa el chip GPS del teléfono) ──
let ubicacion = null;
document.getElementById("btn-ubicacion").addEventListener("click", () => {
  const estado = document.getElementById("ubicacion-estado");
  if (!navigator.geolocation) {
    estado.textContent = "Este navegador no soporta GPS.";
    return;
  }
  estado.textContent = "Buscando señal GPS...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ubicacion = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      estado.textContent = `✅ Ubicación capturada: ${ubicacion.lat.toFixed(5)}, ${ubicacion.lon.toFixed(5)}`;
    },
    (err) => {
      estado.textContent = "No se pudo obtener el GPS (revisa permisos de ubicación). Puedes continuar sin esto.";
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

// ── Fotos (hasta 3): vista previa + compresión a JPEG pequeño (para
//    que quepan dentro del límite de 1MB de un documento de Firestore,
//    y para no gastar los datos móviles de quien reporta) ──────────
const MAX_FOTOS = 3;
let fotosBase64 = [];

document.getElementById("foto").addEventListener("change", async (e) => {
  const archivos = Array.from(e.target.files).slice(0, MAX_FOTOS - fotosBase64.length);
  for (const file of archivos) {
    if (fotosBase64.length >= MAX_FOTOS) break;
    const comprimida = await comprimirImagen(file, 700, 0.55);
    fotosBase64.push(comprimida);
  }
  e.target.value = ""; // permite volver a elegir sin que el navegador ignore el cambio
  renderizarMiniaturas();
});

function renderizarMiniaturas() {
  const cont = document.getElementById("fotos-preview");
  cont.innerHTML = "";
  fotosBase64.forEach((src, i) => {
    const div = document.createElement("div");
    div.className = "miniatura";
    div.innerHTML = `<img src="${src}" alt="Foto ${i + 1}"><button type="button" data-i="${i}">✕</button>`;
    div.querySelector("button").addEventListener("click", () => {
      fotosBase64.splice(i, 1);
      renderizarMiniaturas();
    });
    cont.appendChild(div);
  });
  document.getElementById("foto").disabled = fotosBase64.length >= MAX_FOTOS;
}

function comprimirImagen(file, maxAncho, calidad) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxAncho / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * escala;
        canvas.height = img.height * escala;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", calidad));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Envío del formulario ──────────────────────────────────────────
const form = document.getElementById("form-hallazgo");
const btnGuardar = document.getElementById("btn-guardar");
const formError = document.getElementById("form-error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";

  const nombreSitio = document.getElementById("nombre_sitio").value.trim();
  const descripcion = document.getElementById("descripcion").value.trim();
  if (!nombreSitio || !descripcion) {
    formError.textContent = "Por favor completa el nombre del sitio y la descripción.";
    return;
  }

  const extension = valorSeleccionado("extension");
  const reversibilidad = valorSeleccionado("reversibilidad");
  const areaProtegida = valorSeleccionado("area");
  const reincidencia = valorSeleccionado("reincidencia");
  const igd = calcularIGD(extension, reversibilidad, areaProtegida, reincidencia);
  const uicn = asignarUICN(igd);
  const departamento = document.getElementById("departamento").value;
  const [latDepto, lonDepto] = DEPTOS_HN[departamento];

  const reporte = {
    nombre_sitio: nombreSitio,
    departamento,
    pilar: document.getElementById("pilar").value,
    descripcion,
    extension,
    reversibilidad,
    area_protegida: areaProtegida,
    reincidencia,
    igd,
    uicn,
    alias: document.getElementById("alias").value.trim() || "Anónimo",
    latitud: ubicacion ? ubicacion.lat : latDepto,
    longitud: ubicacion ? ubicacion.lon : lonDepto,
    ubicacion_gps: !!ubicacion,
    fotos_base64: fotosBase64,
    creado_en: serverTimestamp(),
    creado_en_dispositivo: new Date().toISOString(),
    estado: "Abierto",
  };

  btnGuardar.disabled = true;
  btnGuardar.textContent = "Guardando...";

  try {
    // addDoc con caché persistente: esto NO espera a tener internet.
    // Si no hay conexión, Firestore lo guarda localmente en el
    // teléfono y lo sincroniza solo cuando vuelva la señal.
    await addDoc(collection(db, "hallazgos"), reporte);
    mostrarResultado(igd, uicn, navigator.onLine);
  } catch (err) {
    formError.textContent = "Ocurrió un error al guardar: " + err.message;
    btnGuardar.disabled = false;
    btnGuardar.textContent = "✅ Guardar Reporte";
  }
});

function mostrarResultado(igd, uicn, enviadoYa) {
  form.style.display = "none";
  const resultado = document.getElementById("resultado");
  resultado.classList.add("show");
  document.getElementById("resultado-titulo").textContent = enviadoYa
    ? "Reporte enviado"
    : "Reporte guardado en tu teléfono";
  document.getElementById("resultado-mensaje").textContent = enviadoYa
    ? "Tu reporte ya fue enviado correctamente. ¡Gracias por contribuir a la protección ambiental de Honduras!"
    : "No hay conexión ahora mismo, pero tu reporte ya quedó guardado en este teléfono. Se enviará automáticamente en cuanto tengas señal — no necesitas hacer nada más.";
  document.getElementById("resultado-acta").textContent =
    `Gravedad calculada: IGD ${igd} — ${uicn}`;
}

document.getElementById("btn-nuevo").addEventListener("click", () => {
  form.reset();
  fotosBase64 = [];
  renderizarMiniaturas();
  ubicacion = null;
  document.getElementById("ubicacion-estado").textContent =
    "No se ha capturado ubicación GPS todavía (opcional, pero recomendado).";
  document.getElementById("resultado").classList.remove("show");
  form.style.display = "block";
  btnGuardar.disabled = false;
  btnGuardar.textContent = "✅ Guardar Reporte";
  crearRadios("grupo-extension", EXTENSION_PUNTOS, "extension");
  crearRadios("grupo-reversibilidad", REVERSIBILIDAD_PUNTOS, "reversibilidad");
  crearRadios("grupo-area", AREA_PROTEGIDA_PUNTOS, "area");
  crearRadios("grupo-reincidencia", REINCIDENCIA_PUNTOS, "reincidencia");
});

// ── Pestañas: Reportar / Ver Mapa ──────────────────────────────────
const tabReportar = document.getElementById("tab-reportar");
const tabMapa = document.getElementById("tab-mapa");
const vistaReportar = document.getElementById("vista-reportar");
const vistaMapa = document.getElementById("vista-mapa");
let mapaCargado = false;
let mapaLeaflet = null;

function activarPestana(nombre) {
  const esReportar = nombre === "reportar";
  tabReportar.classList.toggle("activo", esReportar);
  tabMapa.classList.toggle("activo", !esReportar);
  vistaReportar.classList.toggle("activa", esReportar);
  vistaMapa.classList.toggle("activa", !esReportar);
  if (!esReportar) {
    // El mapa necesita medirse en un contenedor ya visible, y solo
    // cargamos los datos de Firestore la primera vez que se abre.
    setTimeout(() => {
      if (mapaLeaflet) mapaLeaflet.invalidateSize();
      if (!mapaCargado) cargarMapa();
    }, 50);
  }
}
tabReportar.addEventListener("click", () => activarPestana("reportar"));
tabMapa.addEventListener("click", () => activarPestana("mapa"));

const btnIrReportar = document.getElementById("btn-ir-reportar");
if (btnIrReportar) {
  btnIrReportar.addEventListener("click", () => {
    activarPestana("reportar");
    document.getElementById("form-hallazgo").scrollIntoView({ behavior: "smooth" });
  });
}

// Si alguien llega directo al link con #instalar, que se vea esa seccion
// (ya esta siempre visible al final de la pagina, esto solo hace scroll).
if (window.location.hash === "#instalar") {
  document.getElementById("instalar")?.scrollIntoView();
}

const COLORES_UICN = {
  "LC (Leve)": "#22c55e",
  "VU (Vulnerable)": "#eab308",
  "EN (En Peligro)": "#f97316",
  "CR (En Peligro Crítico)": "#ef4444",
  "CO (Colapsado)": "#111827",
};

async function cargarMapa() {
  const estado = document.getElementById("mapa-estado");
  const lista = document.getElementById("lista-reportes");

  if (!navigator.onLine) {
    estado.textContent = "⚠️ Sin conexión — no se puede cargar el mapa de reportes públicos ahora mismo (esta vista sí necesita internet, a diferencia del formulario).";
    return;
  }

  try {
    const q = query(collection(db, "hallazgos"), orderBy("creado_en_dispositivo", "desc"), limit(200));
    const snap = await getDocs(q);
    mapaCargado = true;

    if (snap.empty) {
      estado.textContent = "Todavía no hay reportes públicos. ¡Sé el primero en registrar uno!";
      return;
    }
    estado.style.display = "none";

    mapaLeaflet = L.map("mapa").setView([14.8, -86.5], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 18,
    }).addTo(mapaLeaflet);

    const reportes = [];
    snap.forEach((d) => reportes.push(d.data()));

    // KPIs
    document.getElementById("kpi-total").textContent = reportes.length;
    const conteoPilar = {};
    let sumaIGD = 0;
    reportes.forEach((r) => {
      conteoPilar[r.pilar] = (conteoPilar[r.pilar] || 0) + 1;
      sumaIGD += r.igd || 0;
    });
    const pilarFrecuente = Object.entries(conteoPilar).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
    document.getElementById("kpi-frecuente").textContent = pilarFrecuente;
    document.getElementById("kpi-promedio").textContent = (sumaIGD / reportes.length).toFixed(1);

    // Marcadores + lista
    lista.innerHTML = "";
    reportes.forEach((r) => {
      if (typeof r.latitud !== "number" || typeof r.longitud !== "number") return;
      const color = COLORES_UICN[r.uicn] || "#3b82f6";

      // Compatibilidad: reportes viejos guardaron "foto_base64" (una sola),
      // los nuevos guardan "fotos_base64" (arreglo de hasta 3).
      const fotos = obtenerFotos(r);
      const fotosHtml = fotos.length
        ? `<div style="display:flex;gap:4px;margin-top:6px;">` +
          fotos.map((f) => `<img src="${f}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;">`).join("") +
          `</div>`
        : "";

      L.circleMarker([r.latitud, r.longitud], {
        radius: 9,
        fillColor: color,
        color: "#fff",
        weight: 2,
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<b>${escapeHtml(r.nombre_sitio || "Sin nombre")}</b><br>` +
          `${escapeHtml(r.departamento || "")} · ${escapeHtml(r.pilar || "")}<br>` +
          `IGD ${r.igd ?? "?"} — ${escapeHtml(r.uicn || "")}<br>` +
          `<small>${escapeHtml((r.descripcion || "").slice(0, 100))}...</small>` +
          fotosHtml,
          { maxWidth: 220 }
        )
        .addTo(mapaLeaflet);

      const item = document.createElement("div");
      item.className = "reporte-item";
      item.innerHTML =
        `<b>${escapeHtml(r.nombre_sitio || "Sin nombre")}</b> — ${escapeHtml(r.departamento || "")} · ${escapeHtml(r.pilar || "")}<br>` +
        `IGD ${r.igd ?? "?"} (${escapeHtml(r.uicn || "")}) · reportado por ${escapeHtml(r.alias || "Anónimo")}` +
        fotosHtml;
      lista.appendChild(item);
    });
  } catch (err) {
    estado.textContent = "No se pudieron cargar los reportes: " + err.message;
    estado.style.display = "block";
  }
}

function obtenerFotos(reporte) {
  if (Array.isArray(reporte.fotos_base64) && reporte.fotos_base64.length) {
    return reporte.fotos_base64;
  }
  if (typeof reporte.foto_base64 === "string" && reporte.foto_base64) {
    return [reporte.foto_base64]; // reportes guardados antes de esta actualización
  }
  return [];
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}
