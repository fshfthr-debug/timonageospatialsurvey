
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

// Initialize Express
const app = express();

// ==================== SECURITY HEADERS ====================
// Applied to every response, including the built frontend the API serves.
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // The frontend, its assets and the API are all on this one origin.
      connectSrc: ["'self'"],
      // The app is never embedded in another page.
      frameAncestors: ["'none'"],
      // Switched off deliberately: on a plain-HTTP deployment (no domain yet) this
      // rewrites asset URLs to https:// and the page loads with no script or CSS.
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false,   // nothing here needs cross-origin isolation
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' }
}));

// ==================== CORS ====================
// Only the browser origins listed in CORS_ORIGIN (comma separated) may read API
// responses. Same-origin requests need no CORS at all, so an empty list is the safe
// default for the single-service deployment. A "*" wildcard is refused on purpose.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(value => value.trim().replace(/\/+$/, ''))
  .filter(value => value && value !== '*');

if ((process.env.CORS_ORIGIN || '').includes('*')) {
  console.warn('⚠️ CORS_ORIGIN contains "*", which is not accepted. List real origins instead.');
}

const normaliseOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '');

app.use(cors({
  origin(origin, callback) {
    // No Origin header: curl, same-origin GETs, server-to-server. No cross-origin
    // risk, and blocking these would break ordinary use.
    if (!origin) return callback(null, true);
    // Echo the configured value, never the raw header, so only a known origin is
    // ever reflected back.
    const requested = normaliseOrigin(origin);
    return callback(null, ALLOWED_ORIGINS.includes(requested) ? requested : false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Behind Caddy/nginx the client IP arrives in X-Forwarded-For. Without this every
// request looks like it came from the proxy, so one person guessing passwords would
// lock out everyone. TRUST_PROXY=false when the API is exposed directly.
if (process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

// Initialize Multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Initialize PostgreSQL Pool
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  // Self-hosted PostgreSQL normally runs without TLS. Managed providers (Neon,
  // Supabase, Render, Aiven) refuse unencrypted connections, so DB_SSL=true turns
  // TLS on. Their certificates are not in the node trust store, hence
  // rejectUnauthorized: false — only acceptable because the traffic is still
  // encrypted, not authenticated.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

// JWT Secret
// ==================== CONFIGURATION GUARDS ====================
// A publicly known signing key lets anybody mint a login token for any account, so
// the app refuses to start instead of running insecurely.
const PLACEHOLDER_SECRETS = new Set([
  'your-secret-key-change-in-production',
  'your-super-secret-jwt-key-change-in-production-12345',
  'replace-with-output-of-openssl-rand-hex-32',
  'changeme', 'change-me', 'secret', 'jwt-secret', 'sitetrackerpro'
]);

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const problems = [];

  if (!secret) {
    problems.push('JWT_SECRET is not set.');
  } else if (secret !== secret.trim()) {
    problems.push('JWT_SECRET has leading or trailing spaces.');
  } else if (secret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters (this one is ' + secret.length + ').');
  } else if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    problems.push('JWT_SECRET is still an example or placeholder value.');
  } else if (new Set(secret).size < 8) {
    problems.push('JWT_SECRET repeats too few distinct characters.');
  }

  if (problems.length > 0) {
    console.error('\n❌ Refusing to start: ' + problems.join(' '));
    console.error('   Generate a real key with:  openssl rand -hex 32');
    console.error('   Then set it as JWT_SECRET (DEPLOYMENT.md, section 0).\n');
    process.exit(1);
  }

  return secret;
}

const JWT_SECRET = requireJwtSecret();

// ==================== ERROR REPORTING ====================
// Responses never carry database text, table names or stack traces - those tell an
// attacker exactly how the app is built. The full error is logged on the server,
// where the person running the deployment can see it.
const serverError = (res, where, err) => {
  console.error('[' + new Date().toISOString() + '] ' + where + ' failed:', err);
  return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
};

// ==================== PASSWORD POLICY ====================
// Length does the real work (NIST SP 800-63B), so there is no forced symbol soup.
// What is refused: short passwords, obvious ones, the account's own email, a single
// repeated pattern, and anything longer than bcrypt can actually read (72 bytes -
// bcrypt silently ignores the rest, which would let two different passwords match).
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_BYTES = 72;

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd',
  '123456789012', '1234567890123', '12345678910', 'qwertyuiopas', 'qwerty123456',
  'administrator', 'letmein12345', 'welcome123456', 'changeme1234', 'iloveyou1234',
  'sitetrackerpro', 'construction', 'construction1', 'abyssinia1234'
]);

// Returns a list of readable problems; empty means the password is acceptable.
function validatePassword(password, email) {
  if (typeof password !== 'string' || password.length === 0) {
    return ['A password is required.'];
  }

  const problems = [];
  const characters = Array.from(password);
  const lower = password.toLowerCase();

  if (characters.length < PASSWORD_MIN_LENGTH) {
    problems.push('Use at least ' + PASSWORD_MIN_LENGTH + ' characters.');
  }

  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    problems.push('That password is too long - keep it under ' + PASSWORD_MAX_BYTES + ' characters.');
  }

  if (password !== password.trim()) {
    problems.push('Remove spaces from the start or end of the password.');
  }

  if (COMMON_PASSWORDS.has(lower)) {
    problems.push('That password is too common. Choose something less guessable.');
  }

  if (new Set(characters).size < 4) {
    problems.push('Use a mix of characters, not the same pattern repeated.');
  }

  const emailName = String(email || '').split('@')[0].toLowerCase();
  if (emailName.length >= 4 && lower.includes(emailName)) {
    problems.push('Do not use your email address inside the password.');
  }

  return problems;
}

// ==================== RATE LIMITING ====================
// Failed sign-ins are the cheapest thing to brute-force, so they get the tightest
// budget. Successful logins are not counted, so normal use is never punished.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Please try again later.' }
});

// ==================== NUMERIC HELPERS ====================
// PostgreSQL returns DECIMAL/NUMERIC columns (and COUNT()) as strings, e.g. "6000.00".
// Convert them at the API boundary so every response holds real numbers.
const toNum = (value, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Budget allocation shares. These MUST total 1.00 (100% of the project budget).
// The guard below fails fast at boot so the split can never drift again.
const BUDGET_SPLIT = {
  materials: 0.59,
  labor: 0.31,
  equipment: 0.05,
  contingency: 0.05
};

const BUDGET_SPLIT_TOTAL = Object.values(BUDGET_SPLIT).reduce((sum, share) => sum + share, 0);
if (Math.abs(BUDGET_SPLIT_TOTAL - 1) > 1e-9) {
  throw new Error(`BUDGET_SPLIT must total 1.00 (100%), but totals ${BUDGET_SPLIT_TOTAL}`);
}

// ==================== TASK-OFF (CSV / TSV) PARSER ====================
// Turns an exported quantity take-off into bim_components rows. No external
// parser dependency: this handles quoted fields, embedded commas, CRLF, BOM and
// thousands separators ("1,250.50" and "12 m³").
const MAX_IMPORT_ROWS = 2000;
const SUPPORTED_TAKEOFF_EXTENSIONS = ['.csv', '.tsv', '.txt'];

const HEADER_ALIASES = {
  component_name: ['component', 'component name', 'name', 'element', 'element name', 'item', 'description', 'material description'],
  material_type: ['material', 'material type', 'type', 'category', 'material category'],
  quantity: ['quantity', 'qty', 'volume', 'area', 'length', 'count', 'amount', 'total'],
  unit: ['unit', 'uom', 'units', 'measure'],
  phase: ['phase', 'stage', 'level', 'zone', 'storey', 'work package']
};

const normaliseKey = (value) => String(value ?? '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

// Splits delimited text into rows of cells, honouring quoted fields.
function parseDelimited(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n').find(line => line.trim() !== '') || '';

  const delimiter = [',', '\t', ';']
    .map(candidate => ({ candidate, count: firstLine.split(candidate).length - 1 }))
    .sort((a, b) => b.count - a.count)[0].candidate;

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows.filter(cells => cells.some(cell => String(cell).trim() !== ''));
}

// Finds the column index of each known field in a header row (-1 when absent).
function mapHeaderRow(row) {
  const indexes = { component_name: -1, material_type: -1, quantity: -1, unit: -1, phase: -1 };

  (row || []).forEach((cell, columnIndex) => {
    const key = normaliseKey(cell);
    if (!key) return;

    Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
      if (indexes[field] === -1 && aliases.includes(key)) indexes[field] = columnIndex;
    });
  });

  return indexes;
}

// "1,250.50", "12 m³", 12.5 -> 12.5 ; "abc", "" -> null
function parseQuantity(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const cleaned = String(raw ?? '').replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;

  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

// Maps parsed rows onto bim_components records, reporting unusable rows instead
// of silently dropping them.
function rowsToComponents(rows) {
  const components = [];
  const errors = [];

  if (!rows || rows.length === 0) {
    return { components, errors: [{ row: 0, message: 'No rows found in the file.' }] };
  }

  const headerIndexes = mapHeaderRow(rows[0]);
  const hasHeader = Object.values(headerIndexes).some(index => index >= 0);
  const indexes = hasHeader
    ? headerIndexes
    : { component_name: 0, material_type: 1, quantity: 2, unit: 3, phase: 4 };
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (!hasHeader) {
    errors.push({
      row: 1,
      message: 'No recognised header row: columns were read as component, material, quantity, unit, phase.'
    });
  }

  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      components: [],
      errors: [{
        row: 0,
        message: `Too many rows (${dataRows.length}). Split the take-off into files of ${MAX_IMPORT_ROWS} rows or fewer.`
      }]
    };
  }

  dataRows.forEach((row, index) => {
    const lineNumber = hasHeader ? index + 2 : index + 1;
    const pick = (field) => (indexes[field] >= 0 ? String(row[indexes[field]] ?? '').trim() : '');

    const rawQuantity = pick('quantity');
    const quantity = parseQuantity(rawQuantity);

    if (quantity === null) {
      errors.push({ row: lineNumber, message: `Quantity "${rawQuantity}" is not a number` });
      return;
    }

    if (!(quantity > 0)) {
      errors.push({ row: lineNumber, message: `Quantity must be greater than zero (got ${quantity})` });
      return;
    }

    components.push({
      component_name: pick('component_name') || `Component ${lineNumber}`,
      material_type: pick('material_type') || 'Unspecified',
      quantity: Math.round(quantity * 100) / 100,
      unit: pick('unit') || 'units',
      phase: pick('phase') || null
    });
  });

  return { components, errors };
}

// Inserts parsed components in a single statement (atomic).
async function insertComponents(projectId, components) {
  if (components.length === 0) return [];

  const placeholders = [];
  const params = [];

  components.forEach((component, index) => {
    const base = index * 6;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(
      projectId,
      component.component_name,
      component.material_type,
      component.quantity,
      component.unit,
      component.phase
    );
  });

  const result = await pool.query(
    `INSERT INTO bim_components (project_id, component_name, material_type, quantity, unit, phase)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    params
  );

  return result.rows.map(row => ({ ...row, quantity: toNum(row.quantity) }));
}

// Ownership check: a token alone must not grant access to someone else's project.
async function userOwnsProject(userId, projectId) {
  if (!userId || !projectId) return false;
  const result = await pool.query('SELECT 1 FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId]);
  return result.rows.length > 0;
}

function requireProjectAccess(getProjectId) {
  return async (req, res, next) => {
    try {
      const projectId = getProjectId(req);
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });

      if (!(await userOwnsProject(req.userId, projectId))) {
        return res.status(404).json({ error: 'Project not found' });
      }

      req.projectId = projectId;
      next();
    } catch (err) {
      serverError(res, req.method + ' ' + req.path, err);
    }
  };
}

// ==================== AUTHENTICATION ENDPOINTS ====================

// Register
app.post('/auth/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, fullName, company } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    const problems = [];

    if (!cleanEmail) {
      problems.push('Email is required.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      problems.push('That email address does not look valid.');
    }

    problems.push(...validatePassword(password, cleanEmail));

    if (problems.length > 0) {
      return res.status(400).json({ error: problems[0], problems });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password, full_name, company) VALUES ($1, $2, $3, $4) RETURNING id, email',
      [cleanEmail, hashedPassword, fullName, company]
    );

    const token = jwt.sign({ userId: result.rows[0].id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, token, user: result.rows[0] });
  } catch (err) {
    // 23505 = unique violation, i.e. the email is taken. Everything else is ours.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That email is already registered. Sign in instead.' });
    }
    serverError(res, 'POST /auth/register', err);
  }
});

// Login
app.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!cleanEmail || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // LOWER(email) so an account created before addresses were normalised still works.
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, token, user: { id: user.id, email: user.email, fullName: user.full_name } });
  } catch (err) {
    serverError(res, 'POST /auth/login', err);
  }
});

// Middleware to verify JWT
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ==================== PROJECT ENDPOINTS ====================

// Create project
app.post('/api/projects', verifyToken, async (req, res) => {
  try {
    const { name, description, budget, location, timeline } = req.body;
    
    const result = await pool.query(
      'INSERT INTO projects (user_id, name, description, budget, location, timeline) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.userId, name, description, budget, location, timeline]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get all projects for user
app.get('/api/projects', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [req.userId]);
    res.json(result.rows);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get project details
app.get('/api/projects/:id', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== BIM INTEGRATION ENDPOINTS ====================

// Import a BIM model / take-off file: stores the upload, then parses it into
// bim_components so quantity survey, BOM and the 3D viewer have real rows.
app.post('/api/bim/import', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded (send it as the "file" field).' });
    }

    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    if (!(await userOwnsProject(req.userId, projectId))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const modelResult = await pool.query(
      'INSERT INTO bim_models (project_id, file_name, file_path, file_type) VALUES ($1, $2, $3, $4) RETURNING *',
      [projectId, req.file.originalname, req.file.path, req.file.mimetype]
    );

    const extension = path.extname(req.file.originalname || '').toLowerCase();

    if (!SUPPORTED_TAKEOFF_EXTENSIONS.includes(extension)) {
      return res.status(415).json({
        success: false,
        model: modelResult.rows[0],
        error: `Cannot extract components from ${extension || 'this file type'}. Export a CSV or TSV quantity take-off from your BIM tool and import that.`,
        supportedExtensions: SUPPORTED_TAKEOFF_EXTENSIONS
      });
    }

    const text = await fs.promises.readFile(req.file.path, 'utf8');
    const { components, errors } = rowsToComponents(parseDelimited(text));
    const inserted = await insertComponents(projectId, components);

    res.json({
      success: true,
      model: modelResult.rows[0],
      parsed: {
        rowsFound: components.length + errors.length,
        imported: inserted.length,
        skipped: errors.length,
        errors: errors.slice(0, 25)
      },
      components: inserted
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Import pasted rows (copy a range straight out of Excel/Numbers -> TSV).
app.post('/api/bim/components', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const raw = typeof req.body.raw === 'string' ? req.body.raw : '';

    if (!raw.trim()) {
      return res.status(400).json({ error: 'Nothing to import - paste your take-off rows first.' });
    }

    const { components, errors } = rowsToComponents(parseDelimited(raw));
    const inserted = await insertComponents(req.projectId, components);

    if (inserted.length === 0) {
      return res.status(400).json({
        error: 'No usable rows found. Check that the file has a quantity column.',
        parsed: { rowsFound: errors.length, imported: 0, skipped: errors.length, errors: errors.slice(0, 25) }
      });
    }

    res.json({
      success: true,
      parsed: {
        rowsFound: components.length + errors.length,
        imported: inserted.length,
        skipped: errors.length,
        errors: errors.slice(0, 25)
      },
      components: inserted
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Components already imported for a project
app.get('/api/bim/components/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bim_components WHERE project_id = $1 ORDER BY material_type, component_name',
      [req.projectId]
    );

    res.json(result.rows.map(row => ({ ...row, quantity: toNum(row.quantity) })));
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Clear a project's take-off (imports are additive, so re-uploading duplicates)
app.delete('/api/bim/components/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM bim_components WHERE project_id = $1', [req.projectId]);
    res.json({ success: true, deleted: toNum(result.rowCount) });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get BIM models for project
app.get('/api/bim/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bim_models WHERE project_id = $1', [req.projectId]);
    res.json(result.rows);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== SURVEYING & EARTHWORKS ENDPOINTS (NEW) ====================

// Save surveying control points
app.post('/api/surveying/control-points', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const { projectId, latitude, longitude, benchmarkElevation, groundLevel, floorLevel, foundationDepth, buildingFootprint } = req.body;
    
    const result = await pool.query(
      'INSERT INTO surveying_control_points (project_id, latitude, longitude, benchmark_elevation, ground_level, floor_level, foundation_depth, building_footprint) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [projectId, latitude, longitude, benchmarkElevation, groundLevel, floorLevel, foundationDepth, buildingFootprint]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get surveying control points
app.get('/api/surveying/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM surveying_control_points WHERE project_id = $1', [req.params.projectId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No control points found' });
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Calculate cut & fill volumes
app.post('/api/earthworks/calculate', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const { projectId } = req.body;

    // Parse before multiplying: unparsed values became NaN and were written to
    // the database as a 500 instead of a clear 400.
    const buildingFootprint = toNum(req.body.buildingFootprint, NaN);
    const foundationDepth = toNum(req.body.foundationDepth, NaN);
    const fillNeeded = toNum(req.body.fillNeeded, NaN);

    // Footprint and depth must be positive (a zero-area site is not a volume);
    // fillNeeded may legitimately be zero or negative on a sloping site.
    const missing = [
      ['buildingFootprint', buildingFootprint],
      ['foundationDepth', foundationDepth]
    ].filter(([, value]) => !Number.isFinite(value) || value <= 0).map(([name]) => name);

    if (!Number.isFinite(fillNeeded)) missing.push('fillNeeded');

    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing, non-numeric or not positive: ${missing.join(', ')}` });
    }

    // Calculate volumes
    const cutVolume = buildingFootprint * foundationDepth;
    const netVolume = fillNeeded * buildingFootprint;
    
    const result = await pool.query(
      'INSERT INTO earthworks_calculations (project_id, cut_volume, fill_volume, net_volume) VALUES ($1, $2, $3, $4) RETURNING *',
      [projectId, cutVolume, netVolume, netVolume - cutVolume]
    );
    
    res.json({
      cutVolume,
      fillVolume: netVolume,
      netImport: netVolume - cutVolume,
      calculation: result.rows[0]
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get earthwork calculations
app.get('/api/earthworks/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM earthworks_calculations WHERE project_id = $1 ORDER BY calculated_at DESC LIMIT 1', [req.params.projectId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No calculations found' });
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== RATE BUILD-UP / BOM PRICING ====================
// Money is handled as a number of ETB, rounded to 2 decimals at each boundary so
// the stored total always equals the sum of the printed line amounts.
const round2 = (value) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

// One take-off line per material *and* unit, so different units are never added
// together ("12 bags" + "8 m³" is not 20 of anything).
async function loadSurveyLines(projectId) {
  const result = await pool.query(
    `SELECT material_type,
            unit,
            SUM(quantity) AS quantity,
            COUNT(*) AS component_count
       FROM bim_components
      WHERE project_id = $1
      GROUP BY material_type, unit
      ORDER BY material_type, unit`,
    [projectId]
  );

  return result.rows.map(row => ({
    materialType: row.material_type,
    unit: row.unit,
    quantity: round2(toNum(row.quantity)),
    componentCount: toNum(row.component_count)
  }));
}

// Rates are keyed by material + unit, because the rate is "per m³" or "per kg".
async function loadRates(projectId) {
  const result = await pool.query(
    'SELECT material_type, unit, rate FROM project_material_rates WHERE project_id = $1',
    [projectId]
  );

  const rates = new Map();
  result.rows.forEach(row => {
    rates.set(`${row.material_type}|${row.unit}`, toNum(row.rate));
  });
  return rates;
}

// Applies rates to survey lines. An unpriced line contributes 0 and is flagged,
// so a zero total can never be mistaken for a complete one.
function priceLines(lines, rates) {
  let total = 0;

  const priced = lines.map(line => {
    const rate = rates.get(`${line.materialType}|${line.unit}`);
    const hasRate = Number.isFinite(rate);
    const quantity = toNum(line.quantity);
    const amount = hasRate ? round2(rate * quantity) : 0;

    if (hasRate) total += amount;

    return {
      materialType: line.materialType,
      unit: line.unit,
      quantity,
      componentCount: toNum(line.componentCount, 0),
      rate: hasRate ? round2(rate) : null,
      amount,
      priced: hasRate
    };
  });

  const pricedLines = priced.filter(line => line.priced).length;

  return {
    lines: priced,
    totalAmount: round2(total),
    pricedLines,
    unpricedLines: priced.length - pricedLines
  };
}

// ==================== QUANTITY SURVEY ENDPOINTS ====================

// Get quantity survey for project, priced with the project's rates
app.get('/api/quantity-survey/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const lines = await loadSurveyLines(req.params.projectId);
    const priced = priceLines(lines, await loadRates(req.params.projectId));

    res.json({
      items: priced.lines,
      summary: priced.lines,
      totalComponents: lines.reduce((sum, line) => sum + line.componentCount, 0),
      totalAmount: priced.totalAmount,
      pricedLines: priced.pricedLines,
      unpricedLines: priced.unpricedLines,
      currency: 'ETB'
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== RATE BUILD-UP ENDPOINTS ====================

// The rate sheet: every current take-off line with its editable rate
app.get('/api/rates/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const lines = await loadSurveyLines(req.projectId);
    const rates = await loadRates(req.projectId);

    res.json({
      lines: lines.map(line => {
        const rate = rates.get(`${line.materialType}|${line.unit}`);
        return { ...line, rate: Number.isFinite(rate) ? round2(rate) : null };
      }),
      currency: 'ETB'
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Save edited rates. A null/blank rate clears it.
app.put('/api/rates/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const { rates } = req.body;

    if (!Array.isArray(rates)) {
      return res.status(400).json({ error: 'rates must be an array of { materialType, unit, rate }.' });
    }

    const problems = [];
    const clean = [];

    rates.forEach((entry, index) => {
      const position = index + 1;

      if (!entry || typeof entry.materialType !== 'string' || !entry.materialType.trim()) {
        problems.push(`entry ${position}: materialType is required`);
        return;
      }
      if (typeof entry.unit !== 'string' || !entry.unit.trim()) {
        problems.push(`entry ${position}: unit is required`);
        return;
      }

      const raw = entry.rate;
      if (raw === null || raw === undefined || raw === '') {
        clean.push({ materialType: entry.materialType.trim(), unit: entry.unit.trim(), rate: null });
        return;
      }

      const rate = toNum(raw, NaN);
      if (!Number.isFinite(rate) || rate < 0) {
        problems.push(`entry ${position}: rate must be zero or more`);
        return;
      }

      clean.push({ materialType: entry.materialType.trim(), unit: entry.unit.trim(), rate: round2(rate) });
    });

    if (problems.length > 0) {
      return res.status(400).json({ error: `Check the rates: ${problems.join('; ')}`, problems });
    }

    for (const entry of clean) {
      if (entry.rate === null) {
        await pool.query(
          'DELETE FROM project_material_rates WHERE project_id = $1 AND material_type = $2 AND unit = $3',
          [req.projectId, entry.materialType, entry.unit]
        );
      } else {
        await pool.query(
          `INSERT INTO project_material_rates (project_id, material_type, unit, rate, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (project_id, material_type, unit)
           DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()`,
          [req.projectId, entry.materialType, entry.unit, entry.rate]
        );
      }
    }

    const lines = await loadSurveyLines(req.projectId);
    const priced = priceLines(lines, await loadRates(req.projectId));

    res.json({
      saved: clean.length,
      lines: priced.lines,
      totalAmount: priced.totalAmount,
      pricedLines: priced.pricedLines,
      unpricedLines: priced.unpricedLines,
      currency: 'ETB'
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== ETHIOPIAN MATERIALS DATABASE ENDPOINTS (NEW) ====================

// Get all Ethiopian standard materials
app.get('/api/materials/ethiopian-standard', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM materials_ethiopian_standards ORDER BY category, material_type');
    res.json(result.rows);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get materials by category
app.get('/api/materials/category/:category', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM materials_ethiopian_standards WHERE category = $1 ORDER BY material_type', [req.params.category]);
    res.json(result.rows);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get project materials
app.get('/api/materials/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM materials_custom WHERE project_id = $1 ORDER BY material_type', [req.params.projectId]);
    res.json(result.rows);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Add custom material to project
app.post('/api/materials/custom', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const { projectId, materialType, unit, quantity, cost, category } = req.body;
    
    const result = await pool.query(
      'INSERT INTO materials_custom (project_id, material_type, unit, quantity, cost, category) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [projectId, materialType, unit, quantity, cost, category]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== 3D MODEL ENDPOINT (NEW) ====================

// Get 3D model for viewing
app.get('/api/3d/model/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    // Get BIM model
    const bimResult = await pool.query('SELECT * FROM bim_models WHERE project_id = $1 LIMIT 1', [req.params.projectId]);
    
    // Get quantity survey data for 3D visualization
    const qtyResult = await pool.query('SELECT * FROM bim_components WHERE project_id = $1', [req.params.projectId]);
    
    // Get earthworks data
    const earthResult = await pool.query('SELECT * FROM earthworks_calculations WHERE project_id = $1 ORDER BY calculated_at DESC LIMIT 1', [req.params.projectId]);
    
    const earthworks = earthResult.rows[0];

    res.json({
      bimModel: bimResult.rows[0] || null,
      components: qtyResult.rows.map(row => ({ ...row, quantity: toNum(row.quantity) })),
      // DECIMAL columns arrive as strings; cast them so the viewer can format them.
      earthworks: earthworks
        ? {
            ...earthworks,
            cut_volume: toNum(earthworks.cut_volume),
            fill_volume: toNum(earthworks.fill_volume),
            net_volume: toNum(earthworks.net_volume)
          }
        : null,
      status: 'ready for 3D rendering'
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== BOM ENDPOINTS ====================

// Generate BOM. Always priced server-side from the current take-off and rates, so
// a BOM can never be saved unpriced or with rates that have since changed.
app.post('/api/bom/generate', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const projectId = req.projectId;

    if (req.body.components !== undefined && !Array.isArray(req.body.components)) {
      return res.status(400).json({ error: 'components must be an array of quantity-survey lines.' });
    }

    const lines = await loadSurveyLines(projectId);
    const priced = priceLines(lines, await loadRates(projectId));

    if (lines.length > 0 && priced.pricedLines === 0) {
      return res.status(400).json({
        error: `No rates are set for this project yet. Set a rate for at least one of the ${lines.length} material lines, then generate the BOM.`,
        unpricedLines: priced.unpricedLines
      });
    }

    const result = await pool.query(
      `INSERT INTO bom (project_id, components, total_cost, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, project_id, components, total_cost, created_at`,
      [projectId, JSON.stringify(priced.lines), priced.totalAmount]
    );

    res.json({
      ...result.rows[0],
      total_cost: round2(toNum(result.rows[0].total_cost)),
      totalAmount: priced.totalAmount,
      pricedLines: priced.pricedLines,
      unpricedLines: priced.unpricedLines,
      currency: 'ETB'
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get BOM. Lines are re-priced with the project's current rates so editing a rate
// updates the BOM total immediately; total_cost keeps the saved snapshot.
app.get('/api/bom/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bom WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.projectId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'BOM not found' });

    const record = result.rows[0];

    let stored = [];
    try {
      const parsed = JSON.parse(record.components);
      stored = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      stored = [];
    }

    const repriced = priceLines(stored, await loadRates(req.projectId));

    res.json({
      ...record,
      components: JSON.stringify(repriced.lines),
      total_cost: round2(toNum(record.total_cost)),
      storedTotal: round2(toNum(record.total_cost)),
      totalAmount: repriced.totalAmount,
      pricedLines: repriced.pricedLines,
      unpricedLines: repriced.unpricedLines,
      currency: 'ETB'
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== BUDGET FORECAST ENDPOINTS ====================

// Generate budget forecast
app.post('/api/budget/forecast', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const projectId = req.projectId;
    const totalBudget = toNum(req.body.totalBudget, NaN);

    if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
      return res.status(400).json({ error: 'totalBudget must be a positive number' });
    }

    // Shares come from BUDGET_SPLIT, which is validated at boot and totals 100%.
    // Previously: 59% + 31% + 8% + 10% = 108% of the budget.
    const forecast = {
      materials: totalBudget * BUDGET_SPLIT.materials,
      labor: totalBudget * BUDGET_SPLIT.labor,
      equipment: totalBudget * BUDGET_SPLIT.equipment,
      contingency: totalBudget * BUDGET_SPLIT.contingency
    };

    const allocated = forecast.materials + forecast.labor + forecast.equipment + forecast.contingency;

    const result = await pool.query(
      'INSERT INTO budget_forecast (project_id, materials, labor, equipment, contingency) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [projectId, forecast.materials, forecast.labor, forecast.equipment, forecast.contingency]
    );

    // Return numbers (not pg DECIMAL strings) plus the allocation total so callers
    // can see the split adds up to the budget.
    res.json({
      ...result.rows[0],
      materials: forecast.materials,
      labor: forecast.labor,
      equipment: forecast.equipment,
      contingency: forecast.contingency,
      totalBudget,
      allocated,
      remaining: totalBudget - allocated
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Latest saved budget forecast for a project
app.get('/api/budget/forecast/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM budget_forecast WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.projectId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No budget forecast for this project yet' });
    }

    const row = result.rows[0];
    const materials = toNum(row.materials);
    const labor = toNum(row.labor);
    const equipment = toNum(row.equipment);
    const contingency = toNum(row.contingency);

    res.json({
      ...row,
      materials,
      labor,
      equipment,
      contingency,
      allocated: round2(materials + labor + equipment + contingency)
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== FRAUD DETECTION ENDPOINTS ====================

// ---- Fraud scoring model ----
// Each factor scores independently on a linear ramp: 0 points at its tolerance
// (ordinary trade variation) and its full cap at its saturation point (an overcharge
// nobody can explain away). The caps add up to 100, so the total reads as a
// confidence percentage and every point in it traces back to one factor.
//
// Price carries the most weight because over-invoicing is where the money leaves:
// a 20% overcharge alone earns the full 75 points and blocks payment, where the
// previous model scored that same case at 8 points and approved it.
// The numbers are deliberately simple, so a site manager can check the arithmetic.
const FRAUD_SCORING = {
  price: {
    label: 'Unit price vs market price',
    cap: 75,
    tolerance: 5,       // % difference that is ordinary market variation
    saturation: 20,     // % above market that earns the whole cap
    unit: '%'
  },
  quantity: {
    label: 'Delivered quantity vs expected quantity',
    cap: 20,
    tolerance: 5,
    saturation: 25,
    unit: '%'
  },
  timing: {
    label: 'Delivery date vs expected date',
    cap: 8,
    tolerance: 1,       // weeks of slippage that is ordinary
    saturation: 5,
    unit: ' wk'
  }
};

const FRAUD_BLOCK_THRESHOLD = 70;
const FRAUD_SCORE_CEILING = 99;
const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

const toOneDecimal = (value) => Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;

// 0 at the tolerance, the full cap at the saturation point, linear in between.
function rampPoints(magnitude, rule) {
  const span = rule.saturation - rule.tolerance;
  if (!Number.isFinite(magnitude) || span <= 0) return 0;
  const ratio = (magnitude - rule.tolerance) / span;
  return rule.cap * Math.min(Math.max(ratio, 0), 1);
}

// One measured difference -> a scored factor, with the reason it scored that way.
// `note` overrides the explanation when the factor needs special wording.
function scoreFactor(key, magnitude, rule, note) {
  const points = rampPoints(magnitude, rule);
  const withinTolerance = !(magnitude > rule.tolerance);

  return {
    key,
    label: rule.label,
    measured: toOneDecimal(magnitude),
    unit: rule.unit,
    tolerance: rule.tolerance,
    saturation: rule.saturation,
    maxPoints: rule.cap,
    points: toOneDecimal(points),
    withinTolerance,
    explanation: note || (withinTolerance
      ? 'Inside the ' + rule.tolerance + rule.unit + ' tolerance - no points.'
      : 'Scores from ' + rule.tolerance + rule.unit + '; reaches the full ' + rule.cap +
        ' points at ' + rule.saturation + rule.unit + '.')
  };
}

// Pure: takes the checked numbers, returns the score and its breakdown.
function scoreFraud({ actualQty, expectedQty, actualPrice, marketPrice, deliveredDate, expectedDate }) {
  const qtyVariance = (actualQty - expectedQty) / expectedQty;
  const priceVariance = (actualPrice - marketPrice) / marketPrice;
  const datesDiff = Math.abs(deliveredDate - expectedDate) / WEEK_MS;

  // Only paying above market is an overcharge worth blocking. A below-market invoice
  // carries no payment risk (it may raise a quality question, which is a different
  // check), so it scores nothing rather than being treated as fraud.
  const priceOverchargePct = Math.max(0, priceVariance) * 100;

  const factors = [
    scoreFactor('price', priceOverchargePct, FRAUD_SCORING.price,
      priceVariance < 0 ? 'Invoiced below market price - no overcharge to flag.' : null),
    scoreFactor('quantity', Math.abs(qtyVariance) * 100, FRAUD_SCORING.quantity),
    scoreFactor('timing', datesDiff, FRAUD_SCORING.timing)
  ];

  const rawScore = factors.reduce((sum, factor) => sum + factor.points, 0);
  const fraudScore = toOneDecimal(Math.min(rawScore, FRAUD_SCORE_CEILING));
  const blocked = fraudScore >= FRAUD_BLOCK_THRESHOLD;

  // What was invoiced above the expected quantity priced at the market rate.
  const excessClaimed = round2(Math.max(0, actualQty * actualPrice - expectedQty * marketPrice));

  return {
    fraudScore,
    recommendation: blocked ? 'BLOCK_PAYMENT' : 'APPROVE',
    riskLevel: blocked ? 'high' : 'low',
    threshold: FRAUD_BLOCK_THRESHOLD,
    factors,
    totalPoints: toOneDecimal(rawScore),
    capped: rawScore > FRAUD_SCORE_CEILING,
    excessClaimed,
    // qtyVariance / priceVariance / datesDiff are kept for the existing screens.
    details: {
      qtyVariance,
      priceVariance,
      datesDiff,
      excessClaimed,
      totalPoints: toOneDecimal(rawScore),
      threshold: FRAUD_BLOCK_THRESHOLD,
      factors
    }
  };
}
// ---- End of fraud scoring model ----


// Smart fraud detection
app.post('/api/fraud-detection/smart', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const projectId = req.projectId;
    const actualQty = toNum(req.body.actualQty, NaN);
    const expectedQty = toNum(req.body.expectedQty, NaN);
    const actualPrice = toNum(req.body.actualPrice, NaN);
    const marketPrice = toNum(req.body.marketPrice, NaN);
    const { deliveryDate, expectedDate } = req.body;

    // expectedQty and marketPrice are divisors: a zero (or missing) value used to
    // produce Infinity, cap at 99 and block a payment on no evidence at all.
    const problems = [];
    if (!Number.isFinite(actualQty)) problems.push('actualQty must be a number');
    if (!Number.isFinite(expectedQty) || expectedQty <= 0) problems.push('expectedQty must be greater than zero');
    if (!Number.isFinite(actualPrice)) problems.push('actualPrice must be a number');
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) problems.push('marketPrice must be greater than zero');

    const deliveredDate = new Date(deliveryDate);
    const expectedDateParsed = new Date(expectedDate);
    if (Number.isNaN(deliveredDate.getTime())) problems.push('deliveryDate is not a valid date');
    if (Number.isNaN(expectedDateParsed.getTime())) problems.push('expectedDate is not a valid date');

    if (problems.length > 0) {
      return res.status(400).json({ error: `Check the input: ${problems.join('; ')}`, problems });
    }

    const scoring = scoreFraud({
      actualQty,
      expectedQty,
      actualPrice,
      marketPrice,
      deliveredDate,
      expectedDate: expectedDateParsed
    });

    const result = await pool.query(
      'INSERT INTO fraud_detections (project_id, fraud_score, recommendation, details) VALUES ($1, $2, $3, $4) RETURNING *',
      [projectId, scoring.fraudScore, scoring.recommendation, JSON.stringify(scoring.details)]
    );

    res.json({
      fraudScore: scoring.fraudScore,
      recommendation: scoring.recommendation,
      riskLevel: scoring.riskLevel,
      threshold: scoring.threshold,
      factors: scoring.factors,
      totalPoints: scoring.totalPoints,
      capped: scoring.capped,
      excessClaimed: scoring.excessClaimed,
      calculation: result.rows[0]
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get fraud detections
app.get('/api/fraud-detection/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fraud_detections WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10', [req.params.projectId]);
    res.json(result.rows);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== PROGRESS TRACKING ENDPOINTS ====================

// Update progress
app.post('/api/progress/update', verifyToken, requireProjectAccess(req => req.body.projectId), async (req, res) => {
  try {
    const { projectId, progressPercent, budgetSpent, notes } = req.body;
    
    const result = await pool.query(
      'INSERT INTO project_progress (project_id, progress_percent, budget_spent, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [projectId, progressPercent, budgetSpent, notes]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Progress history: every saved entry, oldest first, for trend display
app.get('/api/progress/:projectId/history', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM project_progress WHERE project_id = $1 ORDER BY created_at ASC, id ASC',
      [req.params.projectId]
    );

    res.json(result.rows.map(row => ({
      ...row,
      progress_percent: toNum(row.progress_percent),
      budget_spent: toNum(row.budget_spent)
    })));
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// Get progress
app.get('/api/progress/:projectId', verifyToken, requireProjectAccess(req => req.params.projectId), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM project_progress WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [req.params.projectId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No progress found' });
    res.json(result.rows[0]);
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== DASHBOARD ENDPOINTS ====================

// Get dashboard summary
app.get('/api/dashboard', verifyToken, async (req, res) => {
  try {
    const projects = await pool.query('SELECT COUNT(*) AS count FROM projects WHERE user_id = $1', [req.userId]);

    // Scoped through projects: the previous query counted every blocked payment in
    // the database, so each account saw other companies' alerts.
    const fraudAlerts = await pool.query(
      `SELECT COUNT(*) AS count
         FROM fraud_detections fd
         JOIN projects p ON p.id = fd.project_id
        WHERE fd.recommendation = 'BLOCK_PAYMENT' AND p.user_id = $1`,
      [req.userId]
    );

    res.json({
      totalProjects: toNum(projects.rows[0].count),
      activeAlerts: toNum(fraudAlerts.rows[0].count),
      status: 'Dashboard summary'
    });
  } catch (err) {
    serverError(res, req.method + ' ' + req.path, err);
  }
});

// ==================== HEALTH CHECK ====================

app.get('/health', (req, res) => {
  res.json({ status: 'SiteTrackerPro v3.0 Enhanced - Backend Running', timestamp: new Date() });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

// Fresh installs get this table from schema.sql; this keeps an existing database
// working after the rate build-up was added.
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_material_rates (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      material_type VARCHAR(255) NOT NULL,
      unit VARCHAR(50) NOT NULL,
      rate DECIMAL(15,2),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (project_id, material_type, unit)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rates_project_id ON project_material_rates(project_id)');
}

app.listen(PORT, () => {
  console.log(`🚀 SiteTrackerPro v3.0 Enhanced Backend running on port ${PORT}`);
  console.log('🔐 CORS allowed origins:', ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'none (same-origin only)');
  console.log('✅ Features: BIM Integration, Fraud Detection, Quantity Survey, Cut & Fill, 3D Viewer Ready');

  ensureSchema()
    .then(() => console.log('✅ Rate build-up table ready'))
    .catch(err => console.error('⚠️ Could not prepare the rate build-up table:', err.message));
});

module.exports = app;
// Exposed for tests; attached to app so existing `require(...)` callers still work.
module.exports.parseDelimited = parseDelimited;
module.exports.rowsToComponents = rowsToComponents;
