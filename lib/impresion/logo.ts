const LOGO_URL = "/logo-ticket.png";
const ANCHO_LOGO_TICKET = 384;

const cache = new Map<number, Promise<string | null>>();

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const imagen = new Image();
    imagen.onload = () => resolve(imagen);
    imagen.onerror = () => reject(new Error("No se pudo cargar el logo del ticket"));
    imagen.src = url;
  });
}

async function logoRedimensionado(maxWidth: number) {
  const imagen = await cargarImagen(LOGO_URL);
  const escala = Math.min(1, maxWidth / imagen.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imagen.naturalWidth * escala));
  canvas.height = Math.max(1, Math.round(imagen.naturalHeight * escala));

  const contexto = canvas.getContext("2d");
  if (!contexto) throw new Error("No se pudo preparar el logo del ticket");

  contexto.imageSmoothingEnabled = true;
  contexto.imageSmoothingQuality = "high";
  contexto.drawImage(imagen, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/png");
  const coma = dataUrl.indexOf(",");
  return coma >= 0 ? dataUrl.slice(coma + 1) : dataUrl;
}

export function cargarLogoBase64(maxWidth = ANCHO_LOGO_TICKET): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  const ancho = Math.max(1, Math.round(maxWidth));
  const existente = cache.get(ancho);
  if (existente) return existente;

  const promesa = logoRedimensionado(ancho).catch(() => null);
  cache.set(ancho, promesa);
  return promesa;
}
