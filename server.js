// ═══════════════════════════════════════════════════════════════
// server.js — API REST para Report de Preparaciones
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const sql = require('mssql');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const config = require('./config');

const JWT_SECRET = process.env.JWT_SECRET || 'change-in-production';
const PORT = process.env.PORT || 3002;
const REPORT_SLUG = 'preparaciones';
const REPORT_HTML = 'preparaciones_hub.html';
const REPORT_NAME = 'Eficiencia de Preparaciones';

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ── Middleware: extraer token y validar ──────────────────────────
const extractToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') ||
                req.query.token ||
                req.query.appToken ||
                req.body?.token ||
                req.cookies?.reportToken;

  if (!token) {
    req.user = { reports: [REPORT_SLUG] };
    return next();
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (!Array.isArray(req.user.reports)) req.user.reports = [REPORT_SLUG];
  } catch (err) {
    console.warn('[Token validation failed]', err.message);
    req.user = { reports: [REPORT_SLUG] };
  }
  next();
};

app.use(extractToken);

// ── Servir assets estáticos ──────────────────────────────────────
const ROOT = __dirname;
app.use('/img',    express.static(path.join(ROOT, 'img')));
app.use('/vendor', express.static(path.join(ROOT, 'vendor')));
app.get('/corporate-style.css', (req, res) => res.sendFile(path.join(ROOT, '/corporate-style.css')));

// ── Servir HTML del report ───────────────────────────────────────
app.get(`/${REPORT_HTML}`, (req, res) => {
  res.sendFile(path.join(ROOT, REPORT_HTML));
});

// ── Índice de bienvenida ─────────────────────────────────────────
app.get('/', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token || req.query.appToken;
  if (token) {
    res.cookie('reportToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    });
  }

  res.send(`<!doctype html><html><head><meta charset="utf-8">
<title>${REPORT_NAME}</title>
<link rel="stylesheet" href="/corporate-style.css">
<style>
  body { padding:40px; max-width:600px; margin:auto }
  h1 { color:var(--primary) }
  a { display:block; padding:14px 18px; background:var(--card); border:1px solid var(--border);
      border-left:4px solid var(--primary); border-radius:8px; color:var(--text); text-decoration:none;
      box-shadow:var(--shadow-sm); font-weight:600; margin-top:20px }
  a:hover { background:var(--card-2) }
</style>
</head><body>
<h1>⚙️ ${REPORT_NAME}</h1>
<a href="/${REPORT_HTML}">Ir al reporte →</a>
</body></html>`);
});

// ── Pool de conexión global ──────────────────────────────────────
let pool = null;

async function getPool() {
  if (!pool) {
    console.log(`Conectando a ${config.sql.server}/${config.sql.database}...`);
    pool = await sql.connect(config.sql);
    console.log('✓ Conexión SQL Server establecida');
  }
  return pool;
}

// ── ENDPOINT: Test de conexión ───────────────────────────────────
app.get('/api/test', async (req, res) => {
  try {
    const p = await getPool();
    const result = await p.request().query('SELECT 1 AS ok');
    res.json({ status: 'ok', message: 'Conexión SQL Server activa', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── ENDPOINT: Datos de preparaciones ─────────────────────────────
// GET /api/preparaciones?centro=&desde=&hasta=&limit=20000
app.get('/api/preparaciones', async (req, res) => {
  try {
    const p = await getPool();
    const tabla = config.tabla_notificaciones;
    const { centro, desde, hasta, limit } = req.query;

    let where = ['[Tiempo_prep] IS NOT NULL', '[Tiempo_prep] <> 0',
                 '[PREPARACION] IS NOT NULL', '[PREPARACION] <> 0'];
    const request = p.request();

    if (centro) {
      const centros = centro.split(',').map(c => c.trim());
      centros.forEach((c, i) => request.input('c' + i, sql.NVarChar, c));
      where.push(`[CENTRO] IN (${centros.map((_, i) => '@c' + i).join(',')})`);
    }
    if (desde) {
      request.input('desde', sql.NVarChar, desde);
      where.push('[FECHA] >= @desde');
    }
    if (hasta) {
      request.input('hasta', sql.NVarChar, hasta);
      where.push('[FECHA] <= @hasta');
    }

    const whereClause = ' WHERE ' + where.join(' AND ');
    const limitClause = limit ? `TOP ${parseInt(limit)}` : 'TOP 20000';

    const query = `
      SELECT ${limitClause}
        CENTRO, SECCION, PUESTO, FECHA, MES, SEMANA, TURNO,
        MATERIAL, [OF] AS OF_NUM, NOTIFICACION, OPERACIONOF, OPERACIONDESCOF,
        OPERARIO, NOMBRE,
        INICIO_DIA, INICIO_HORA, FIN_DIA, FIN_HORA,
        (PREPARACION * ISNULL(BMSCH, 1)) AS prep_std,
        PREPARACION AS prep_std_unit,
        ISNULL(BMSCH, 1)  AS bmsch,
        (Tiempo_prep * 60) AS prep_real,
        CANTNOTIFBUENA, DURACION
      FROM ${tabla}${whereClause}
      ORDER BY FECHA DESC, INICIO_HORA DESC
    `;

    const t0 = Date.now();
    const r = await request.query(query);
    const ms = Date.now() - t0;

    let sumStd = 0, sumReal = 0, bajoStd = 0, sobreStd = 0;
    r.recordset.forEach(row => {
      const s = Number(row.prep_std) || 0;
      const re = Number(row.prep_real) || 0;
      sumStd += s; sumReal += re;
      if (re > 0 && s > 0) {
        if (re <= s) bajoStd++; else sobreStd++;
      }
    });
    const efic = sumReal > 0 ? (sumStd / sumReal) * 100 : 0;
    const n = r.recordset.length;

    res.json({
      status: 'ok', count: n, ms,
      kpis: {
        registros: n,
        prep_std_total: sumStd,
        prep_real_total: sumReal,
        eficiencia_pct: efic,
        desviacion_total: sumReal - sumStd,
        desviacion_media: n ? (sumReal - sumStd) / n : 0,
        bajo_std: bajoStd,
        sobre_std: sobreStd,
        bajo_std_pct: n ? (bajoStd / n) * 100 : 0
      },
      data: r.recordset
    });
  } catch (err) {
    console.error('Error /api/preparaciones:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── ENDPOINT: Filtros para combos ────────────────────────────────
app.get('/api/preparaciones/filtros', async (req, res) => {
  try {
    const p = await getPool();
    const tabla = config.tabla_notificaciones;
    const baseWhere = ' WHERE [Tiempo_prep] IS NOT NULL AND [Tiempo_prep] <> 0 AND [PREPARACION] IS NOT NULL AND [PREPARACION] <> 0';
    const cols = ['CENTRO','SECCION','TURNO','MES','SEMANA','PUESTO'];
    const out = {};
    for (const c of cols) {
      const q = `SELECT DISTINCT [${c}] AS v FROM ${tabla}${baseWhere} AND [${c}] IS NOT NULL ORDER BY v`;
      const r = await p.request().query(q);
      out[c] = r.recordset.map(x => x.v);
    }
    res.json({ status: 'ok', data: out });
  } catch (err) {
    console.error('Error /api/preparaciones/filtros:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Health check y error handling ────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error no capturado:', err);
  res.status(500).json({ status: 'error', message: err.message });
});

// ── Iniciar servidor ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log(`  ${REPORT_NAME}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Reports: http://localhost:${PORT}/${REPORT_HTML}`);
  console.log('═══════════════════════════════════════════════');
});
