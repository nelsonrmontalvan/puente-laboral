// /api/afiches — Bolsa de la iglesia (afiches de empleo subidos por el admin).
//   GET    -> lista pública de afiches
//   POST   -> { accion: "verificar" }                        (admin) comprueba la contraseña
//             { imagen: "data:image/jpeg;base64,...", puesto, provincia }  (admin) publica
//   DELETE -> { url }                                        (admin) quita un afiche
//
// Variables en Vercel:
//   ADMIN_PASSWORD          contraseña del admin (la elegís vos)
//   BLOB_READ_WRITE_TOKEN   la agrega Vercel sola al conectar el Blob store
//
// Cada afiche es UNA imagen en Vercel Blob. El puesto y la provincia van codificados
// dentro del nombre del archivo, así no hace falta base de datos.

const crypto = require('crypto');
const { put, list, del } = require('@vercel/blob');

const PROVINCIAS = ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'];
const CARPETA = 'afiches/';
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB (el navegador ya reduce la foto antes de subirla)
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

module.exports = async (req, res) => {
     if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    return res.status(500).json({ error: 'SIN_ALMACEN', mensaje: 'Falta conectar el almacenamiento (Blob) al proyecto en Vercel.' });
  }

  try {
    if (req.method === 'GET') return await listar(res);

    // Todo lo demás requiere ser admin
    if (!esAdmin(req)) {
      return res.status(401).json({ error: 'NO_AUTORIZADO', mensaje: 'Contraseña incorrecta.' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (req.method === 'POST' && body.accion === 'verificar') return res.status(200).json({ ok: true });
    if (req.method === 'POST') return await publicar(body, res);
    if (req.method === 'DELETE') return await quitar(body, res);

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'METODO', mensaje: 'Método no permitido.' });
  } catch (err) {
    console.error('[afiches]', err);
    return res.status(500).json({ error: 'ERROR', mensaje: 'Algo falló en el servidor. Probá de nuevo.' });
  }
};

// ---------- Acciones ----------
async function listar(res) {
  const blobs = [];
  let cursor;
  do {
    const r = await list({ prefix: CARPETA, cursor, limit: 1000 });
    blobs.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);

  const afiches = blobs
    .map(b => {
      const meta = leerNombre(b.pathname);
      if (!meta) return null;
      return { id: meta.id, url: b.url, puesto: meta.puesto, provincia: meta.provincia, fecha: new Date(b.uploadedAt).toISOString() };
    })
    .filter(Boolean)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  // Caché corta: un afiche nuevo aparece en menos de un minuto
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  return res.status(200).json({ total: afiches.length, afiches });
}

async function publicar(body, res) {
  const puesto = String(body.puesto || '').trim().slice(0, 80);
  const provincia = PROVINCIAS.includes(body.provincia) ? body.provincia : '';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.imagen || ''));

  if (!puesto) return res.status(400).json({ error: 'DATOS', mensaje: 'Escribí el puesto.' });
  if (!provincia) return res.status(400).json({ error: 'DATOS', mensaje: 'Elegí una provincia.' });
  if (!m) return res.status(400).json({ error: 'DATOS', mensaje: 'La imagen debe ser JPG, PNG o WEBP.' });

  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'GRANDE', mensaje: 'La imagen es muy pesada (máximo 3 MB).' });

  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const pathname = `${CARPETA}${id}__${codificar({ p: puesto, v: provincia })}.${TIPOS[m[1]]}`;
  const blob = await put(pathname, buffer, { access: 'public', contentType: m[1], addRandomSuffix: false });

  return res.status(201).json({ ok: true, afiche: { id, url: blob.url, puesto, provincia, fecha: new Date().toISOString() } });
}

async function quitar(body, res) {
  const url = String(body.url || '');
  let pathname = '', host = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    pathname = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch (e) { /* url inválida */ }
  if (!pathname.startsWith(CARPETA) || !/\.blob\.vercel-storage\.com$/.test(host)) {
    return res.status(400).json({ error: 'DATOS', mensaje: 'Afiche no válido.' });
  }
  await del(url);
  return res.status(200).json({ ok: true });
}

// ---------- Utilidades ----------
function esAdmin(req) {
  const esperado = process.env.ADMIN_PASSWORD || '';
  const recibido = String(req.headers['x-admin-password'] || '');
  if (!esperado || !recibido) return false;
  const a = crypto.createHash('sha256').update(esperado).digest();
  const b = crypto.createHash('sha256').update(recibido).digest();
  return crypto.timingSafeEqual(a, b);
}

function codificar(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function leerNombre(pathname) {
  const m = /^afiches\/(\d+-[0-9a-f]+)__([A-Za-z0-9_-]+)\.(jpg|png|webp)$/.exec(pathname);
  if (!m) return null;
  try {
    const o = JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8'));
    return { id: m[1], puesto: String(o.p || ''), provincia: String(o.v || '') };
  } catch (e) { return null; }
}
