// /api/empleos â€” FunciÃ³n serverless (Vercel) que consulta la API de empleos.
// La llave vive en la variable de entorno RAPIDAPI_KEY: nunca llega al navegador.
//
// Proveedores soportados (variable PROVEEDOR):
//   "jsearch"  -> JSearch (agrega LinkedIn, Indeed, Glassdoor y otros)  [por defecto]
//   "linkedin" -> LinkedIn Job Search API (solo LinkedIn)

const PROVINCIAS = ['San JosÃ©', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'LimÃ³n'];

module.exports = async (req, res) => {
  const key = process.env.RAPIDAPI_KEY;
  const proveedor = (process.env.PROVEEDOR || 'jsearch').toLowerCase();

  if (!key) {
    return res.status(500).json({ error: 'SIN_LLAVE', mensaje: 'Falta configurar RAPIDAPI_KEY en Vercel.' });
  }

  // --- Validar entrada ---
  const q = String(req.query.q || '').trim().slice(0, 80);
  const provincia = PROVINCIAS.includes(req.query.provincia) ? req.query.provincia : '';
  const remoto = req.query.remoto === '1';
  // "cursor" = token de la siguiente pÃ¡gina (JSearch v5 usa cursor; LinkedIn usa un nÃºmero)
  const cursor = String(req.query.cursor || '').slice(0, 2000);
  const debug = req.query.debug === '1';

  if (!q) return res.status(400).json({ error: 'SIN_BUSQUEDA', mensaje: 'EscribÃ­ quÃ© trabajo buscÃ¡s.' });

  try {
    const resultado = proveedor === 'linkedin'
      ? await buscarLinkedIn({ key, q, provincia, remoto, cursor })
      : await buscarJSearch({ key, q, provincia, remoto, cursor });

    // CachÃ© en el CDN de Vercel: bÃºsquedas iguales no gastan cuota de la API por 30 min.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');

    return res.status(200).json({
      proveedor,
      total: resultado.empleos.length,
      siguiente: resultado.siguiente || null,
      empleos: resultado.empleos,
      ...(debug ? { muestraCruda: resultado.crudo } : {})
    });
  } catch (err) {
    const status = err.status || 500;
    let mensaje = 'No pudimos conectar con el servicio de empleos. ProbÃ¡ de nuevo en un momento.';
    if (status === 401 || status === 403) mensaje = 'La llave no es vÃ¡lida o la cuenta no estÃ¡ suscrita a esta API en RapidAPI.';
    if (status === 429) mensaje = 'Se alcanzÃ³ el lÃ­mite de consultas del plan. IntentÃ¡ mÃ¡s tarde.';
    console.error('[empleos]', status, err.message);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'API_EXTERNA', mensaje });
  }
};

// ---------- JSearch (v5) ----------
// Respuesta v5: { status, data: { jobs: [...], cursor: "..." } }
async function buscarJSearch({ key, q, provincia, remoto, cursor }) {
  const lugar = provincia ? `${provincia}, Costa Rica` : 'Costa Rica';
  const params = new URLSearchParams({
    query: `${q} in ${lugar}`,
    num_pages: '1',
    country: 'cr',
    date_posted: 'month'
  });
  if (cursor) params.set('cursor', cursor);
  if (remoto) params.set('work_from_home', 'true');

  const data = await llamar(`https://jsearch.p.rapidapi.com/search-v2?${params}`, key, 'jsearch.p.rapidapi.com');
  // Compatibilidad: v5 trae data.jobs; versiones viejas traÃ­an data como arreglo
  const lista = Array.isArray(data?.data?.jobs) ? data.data.jobs
              : Array.isArray(data?.data) ? data.data : [];
  const siguiente = (data?.data && !Array.isArray(data.data) && data.data.cursor) || null;

  return {
    siguiente,
    crudo: lista[0] || null,
    empleos: lista.map(j => ({
      id: j.job_id,
      titulo: j.job_title,
      empresa: j.employer_name,
      logo: j.employer_logo || null,
      ubicacion: [j.job_city, j.job_state].filter(Boolean).join(', ') || j.job_location || j.job_country || 'Costa Rica',
      remoto: Boolean(j.job_is_remote),
      tipo: traducirTipo(j.job_employment_type || (Array.isArray(j.job_employment_types) ? j.job_employment_types[0] : null)),
      fecha: j.job_posted_at_datetime_utc || null,
      fuente: j.job_publisher || null,
      url: j.job_apply_link || j.job_google_link || null
    })).filter(e => e.url && e.titulo)
  };
}

// ---------- LinkedIn Job Search API ----------
async function buscarLinkedIn({ key, q, provincia, remoto, cursor }) {
  const limit = 20;
  const page = Math.min(Math.max(parseInt(cursor, 10) || 1, 1), 10);
  const params = new URLSearchParams({
    title_filter: `"${q.replace(/"/g, '')}"`,
    location_filter: '"Costa Rica"',
    offset: String((page - 1) * limit),
    description_type: 'text'
  });

  const data = await llamar(`https://linkedin-job-search-api.p.rapidapi.com/active-jb-7d?${params}`, key, 'linkedin-job-search-api.p.rapidapi.com');
  const lista = Array.isArray(data) ? data : (data.data || data.jobs || []);

  let empleos = lista.map(j => {
    const lugares = j.locations_derived || j.locations_alt_raw || [];
    const ubicacion = Array.isArray(lugares) ? lugares.join(' / ') : String(lugares || 'Costa Rica');
    return {
      id: j.id,
      titulo: j.title,
      empresa: j.organization || j.company,
      logo: j.organization_logo || null,
      ubicacion: ubicacion || 'Costa Rica',
      remoto: Boolean(j.remote_derived),
      tipo: traducirTipo(Array.isArray(j.employment_type) ? j.employment_type[0] : j.employment_type),
      fecha: j.date_posted || null,
      fuente: 'LinkedIn',
      url: j.url || null
    };
  }).filter(e => e.url && e.titulo);

  // Esta API no filtra por provincia ni remoto de forma directa: filtramos aquÃ­.
  if (provincia) {
    const p = quitarTildes(provincia);
    empleos = empleos.filter(e => quitarTildes(e.ubicacion).includes(p));
  }
  if (remoto) empleos = empleos.filter(e => e.remoto);

  return { siguiente: lista.length >= limit ? String(page + 1) : null, crudo: lista[0] || null, empleos };
}

// ---------- Utilidades ----------
async function llamar(url, key, host) {
  const r = await fetch(url, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host } });
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

function traducirTipo(t) {
  if (!t) return null;
  const mapa = {
    FULLTIME: 'Tiempo completo', FULL_TIME: 'Tiempo completo',
    PARTTIME: 'Medio tiempo', PART_TIME: 'Medio tiempo',
    CONTRACTOR: 'Por contrato', CONTRACT: 'Por contrato',
    INTERN: 'PasantÃ­a', INTERNSHIP: 'PasantÃ­a',
    TEMPORARY: 'Temporal'
  };
  return mapa[String(t).toUpperCase().replace(/\s|-/g, '_')] || null;
}

function quitarTildes(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
