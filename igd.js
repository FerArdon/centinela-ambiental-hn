// Misma rúbrica de Centinela Ambiental-HN (escritorio), adaptada a JS.
export const DEPTOS_HN = {
  "Francisco Morazán": [14.0818, -87.2068],
  "Olancho": [14.8650, -86.2000],
  "Atlántida": [15.7794, -86.7947],
  "Yoro": [15.1264, -87.1308],
  "Cortés": [15.5000, -88.0333],
  "Colón": [15.9178, -85.9578],
  "Comayagua": [14.4500, -87.6333],
  "Copán": [14.7722, -88.7817],
  "El Paraíso": [14.0286, -86.5811],
  "Choluteca": [13.2981, -87.1933],
  "Gracias a Dios": [15.2636, -83.7750],
  "Lempira": [14.5833, -88.5500],
  "Intibucá": [14.3000, -88.1667],
  "La Paz": [14.3167, -87.6833],
  "Ocotepeque": [14.4322, -89.0500],
  "Santa Bárbara": [14.9167, -88.2333],
  "Valle": [13.5139, -87.4978],
  "Islas de la Bahía": [16.3317, -86.5353],
};

export const PILARES = ["Flora", "Fauna", "Agua", "Suelo", "Químicos", "Aire"];

export const EXTENSION_PUNTOS = {
  "Puntual (menos de 0.1 ha)": 1,
  "Localizada (0.1 a 2 ha)": 3,
  "Extensa (2 a 10 ha)": 5,
  "Masiva (más de 10 ha)": 8,
};
export const REVERSIBILIDAD_PUNTOS = {
  "Reversible en el corto plazo (semanas/meses)": 1,
  "Reversible en el largo plazo (años)": 3,
  "Irreversible": 6,
};
export const AREA_PROTEGIDA_PUNTOS = {
  "No se encuentra en área protegida o especie protegida": 0,
  "Sí involucra área protegida o especie protegida": 5,
};
export const REINCIDENCIA_PUNTOS = {
  "Primer reporte en esta zona": 0,
  "Ya existían reportes previos en la misma zona": 4,
};

export function calcularIGD(extension, reversibilidad, areaProtegida, reincidencia) {
  return (
    EXTENSION_PUNTOS[extension] +
    REVERSIBILIDAD_PUNTOS[reversibilidad] +
    AREA_PROTEGIDA_PUNTOS[areaProtegida] +
    REINCIDENCIA_PUNTOS[reincidencia]
  );
}

export function asignarUICN(igd) {
  if (igd <= 5) return "LC (Leve)";
  if (igd <= 8) return "VU (Vulnerable)";
  if (igd <= 10) return "EN (En Peligro)";
  if (igd <= 17) return "CR (En Peligro Crítico)";
  return "CO (Colapsado)";
}
