import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  collection,
  addDoc,
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

// ── Foto: vista previa + compresión a JPEG pequeño (para que quepa
//    dentro del límite de 1MB de un documento de Firestore, y para
//    no gastar los datos móviles de quien reporta) ──────────────
let fotoBase64 = null;
document.getElementById("foto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) { fotoBase64 = null; return; }
  fotoBase64 = await comprimirImagen(file, 900, 0.6);
  const preview = document.getElementById("foto-preview");
  preview.src = fotoBase64;
  preview.style.display = "block";
});

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
    foto_base64: fotoBase64,
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
  fotoBase64 = null;
  ubicacion = null;
  document.getElementById("foto-preview").style.display = "none";
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
