
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { buildCsv, downloadCsv, safeFilePart, todayStamp } from './csv';

// Relative by default: the CRA dev server proxies /api and /auth to the backend
// (see "proxy" in package.json), and in production the build is served from the
// same origin as the API. Set REACT_APP_API_URL only to point at a separate host.
const API_URL = process.env.REACT_APP_API_URL || '';

// PostgreSQL returns DECIMAL/NUMERIC columns as strings (e.g. "6000.00"), and a
// string has no .toFixed(). Coerce anything before formatting it.
const num = (value) => {
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmt = (value, decimals = 0) => num(value).toFixed(decimals);
const money = (value) => num(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ratesMissing = (lines) => (lines || []).some(line => !line.priced);

// ===================== MAIN APPLICATION COMPONENT =====================
export default function SiteTrackerPro() {
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    if (token) {
      fetchProjects();
    }
  }, [token]);

  const fetchProjects = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProjects(response.data);
    } catch (err) {
      console.error('Error fetching projects:', err);
    }
  };

  if (!token) {
    return <AuthScreen setToken={setToken} />;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <h1>🏗️ SiteTrackerPro v3.0 Enhanced</h1>
        <p>BIM Integration • Cut & Fill • Fraud Detection • 3D Viewer</p>
      </header>

      {/* Navigation */}
      <nav style={styles.nav}>
        <button onClick={() => setCurrentScreen('dashboard')} style={currentScreen === 'dashboard' ? styles.navButtonActive : styles.navButton}>
          📊 Dashboard
        </button>
        <button onClick={() => setCurrentScreen('projects')} style={currentScreen === 'projects' ? styles.navButtonActive : styles.navButton}>
          📁 Projects
        </button>
        <button onClick={() => setCurrentScreen('new-project')} style={currentScreen === 'new-project' ? styles.navButtonActive : styles.navButton}>
          ➕ New Project
        </button>
        <button onClick={() => setCurrentScreen('bim-import')} style={currentScreen === 'bim-import' ? styles.navButtonActive : styles.navButton}>
          📥 BIM Import
        </button>
        <button onClick={() => setCurrentScreen('quantity-survey')} style={currentScreen === 'quantity-survey' ? styles.navButtonActive : styles.navButton}>
          📋 Quantity Survey
        </button>
        <button onClick={() => setCurrentScreen('project-dashboard')} style={currentScreen === 'project-dashboard' ? styles.navButtonActive : styles.navButton}>
          📈 Progress & Budget
        </button>
        <button onClick={() => setCurrentScreen('surveying')} style={currentScreen === 'surveying' ? styles.navButtonActive : styles.navButton}>
          📍 Surveying
        </button>
        <button onClick={() => setCurrentScreen('3d-viewer')} style={currentScreen === '3d-viewer' ? styles.navButtonActive : styles.navButton}>
          🎨 3D Viewer
        </button>
        <button onClick={() => setCurrentScreen('materials')} style={currentScreen === 'materials' ? styles.navButtonActive : styles.navButton}>
          📦 Materials
        </button>
        <button onClick={() => setCurrentScreen('fraud')} style={currentScreen === 'fraud' ? styles.navButtonActive : styles.navButton}>
          🚨 Fraud Check
        </button>
        <button onClick={() => { localStorage.removeItem('token'); setToken(null); }} style={styles.navButtonLogout}>
          🚪 Logout
        </button>
      </nav>

      {/* Main Content */}
      <main style={styles.main}>
        {currentScreen === 'dashboard' && <DashboardScreen token={token} projects={projects} />}
        {currentScreen === 'projects' && <ProjectsScreen token={token} projects={projects} setSelectedProject={setSelectedProject} setCurrentScreen={setCurrentScreen} />}
        {currentScreen === 'project-details' && <ProjectDetailsScreen token={token} project={selectedProject} setCurrentScreen={setCurrentScreen} />}
        {currentScreen === 'new-project' && <NewProjectScreen token={token} fetchProjects={fetchProjects} setCurrentScreen={setCurrentScreen} />}
        {currentScreen === 'bim-import' && <BimImportScreen token={token} projects={projects} />}
        {currentScreen === 'quantity-survey' && <QuantitySurveyScreen token={token} projects={projects} />}
        {currentScreen === 'project-dashboard' && <ProjectDashboardScreen token={token} projects={projects} />}
        {currentScreen === 'surveying' && <SurveyingControlPointsScreen token={token} projects={projects} />}
        {currentScreen === '3d-viewer' && <ThreeDViewerScreen token={token} projects={projects} />}
        {currentScreen === 'materials' && <MaterialsDatabaseScreen token={token} projects={projects} />}
        {currentScreen === 'fraud' && <FraudDetectionScreen token={token} projects={projects} />}
      </main>
    </div>
  );
}

// ===================== AUTHENTICATION SCREEN =====================
function AuthScreen({ setToken }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLogin, setIsLogin] = useState(true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const response = await axios.post(`${API_URL}${endpoint}`, {
        email,
        password,
        fullName: !isLogin ? fullName : undefined,
        company: !isLogin ? 'Construction Company' : undefined
      });
      
      localStorage.setItem('token', response.data.token);
      setToken(response.data.token);
    } catch (err) {
      // The server can return several password problems at once; show them all.
      const data = err.response?.data;
      const detail = Array.isArray(data?.problems) && data.problems.length > 1
        ? data.problems.join(' ')
        : data?.error || err.message;
      alert('Authentication failed: ' + detail);
    }
  };

  return (
    <div style={styles.authContainer}>
      <div style={styles.authBox}>
        <h2>{isLogin ? 'Login' : 'Register'}</h2>
        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <input
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={styles.input}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            required
          />
          <input
            type="password"
            placeholder="Password"
            name="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            minLength={isLogin ? undefined : 12}
            maxLength={72}
            required
          />
          {!isLogin && (
            <p style={styles.helper}>
              At least 12 characters. Do not use your email address, a common password, or the
              same characters repeated.
            </p>
          )}
          <button type="submit" style={styles.button}>{isLogin ? 'Login' : 'Register'}</button>
        </form>
        <button onClick={() => setIsLogin(!isLogin)} style={styles.toggleButton}>
          {isLogin ? 'Need an account? Register' : 'Have an account? Login'}
        </button>
      </div>
    </div>
  );
}

// ===================== DASHBOARD SCREEN =====================
function DashboardScreen({ token, projects }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (err) {
      console.error('Error fetching dashboard:', err);
    }
  };

  return (
    <div>
      <h2>📊 Dashboard</h2>
      <div style={styles.grid}>
        <div style={styles.card}>
          <h3>Total Projects</h3>
          <p style={styles.largeNumber}>{projects.length}</p>
        </div>
        <div style={styles.card}>
          <h3>Active Fraud Alerts</h3>
          <p style={styles.largeNumber}>{stats?.activeAlerts || 0}</p>
        </div>
        <div style={styles.card}>
          <h3>System Status</h3>
          <p style={styles.status}>✅ Running</p>
        </div>
        <div style={styles.card}>
          <h3>Surveying Module</h3>
          <p style={styles.status}>✅ Active</p>
        </div>
      </div>
      <div style={styles.card}>
        <h3>Features Available</h3>
        <ul style={styles.featureList}>
          <li>✅ BIM Integration (Revit, IFC, SketchUp)</li>
          <li>✅ Quantity Survey & Takeoffs</li>
          <li>✅ Fraud Detection (transparent 3-factor scoring)</li>
          <li>✅ Budget Forecasting</li>
          <li>✅ Surveying Control Points (NEW)</li>
          <li>✅ Cut & Fill Calculations (NEW)</li>
          <li>✅ 3D BIM Viewer (NEW)</li>
          <li>✅ Ethiopian Materials Database (NEW)</li>
        </ul>
      </div>
    </div>
  );
}

// ===================== BIM IMPORT SCREEN (NEW) =====================
function BimImportScreen({ token, projects }) {
  const [projectId, setProjectId] = useState('');
  const [file, setFile] = useState(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  const [components, setComponents] = useState([]);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const loadComponents = async (id) => {
    if (!id) { setComponents([]); return; }

    try {
      const response = await axios.get(`${API_URL}/api/bim/components/${id}`, { headers: authHeaders });
      setComponents(response.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    loadComponents(projectId);
  }, [projectId]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!projectId) { setError('Select a project first.'); return; }
    if (!file) { setError('Choose a CSV or TSV take-off file first.'); return; }

    const form = new FormData();
    form.append('file', file);
    form.append('projectId', projectId);

    setBusy(true); setError(''); setReport(null);

    try {
      const response = await axios.post(`${API_URL}/api/bim/import`, form, { headers: authHeaders });
      setReport({ source: file.name, ...response.data.parsed });
      setFile(null);
      e.target.reset();
      await loadComponents(projectId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = async (e) => {
    e.preventDefault();
    if (!projectId) { setError('Select a project first.'); return; }
    if (!paste.trim()) { setError('Paste some take-off rows first.'); return; }

    setBusy(true); setError(''); setReport(null);

    try {
      const response = await axios.post(`${API_URL}/api/bim/components`, { projectId, raw: paste }, { headers: authHeaders });
      setReport({ source: 'pasted rows', ...response.data.parsed });
      setPaste('');
      await loadComponents(projectId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setReport(err.response?.data?.parsed || null);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!projectId) return;
    if (!window.confirm('Delete every component in this project? The quantity survey, BOM and 3D viewer will be empty again.')) return;

    setBusy(true); setError(''); setReport(null);

    try {
      await axios.delete(`${API_URL}/api/bim/components/${projectId}`, { headers: authHeaders });
      await loadComponents(projectId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const csv = [
      'Component,Material Type,Quantity,Unit,Phase',
      'Ground floor slab,Concrete,24.50,m3,Substructure',
      'Column C1 (300x300),Concrete,1.80,m3,Superstructure',
      'External wall,CMU Blocks,410,units,Superstructure',
      'Distribution board,Electrical,1,units,MEP'
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bim-components-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  // Totals grouped by material *and* unit, mirroring the quantity-survey API.
  const totals = Object.values(components.reduce((acc, row) => {
    const key = `${row.material_type}|${row.unit}`;
    if (!acc[key]) acc[key] = { materialType: row.material_type, unit: row.unit, quantity: 0, count: 0 };
    acc[key].quantity += num(row.quantity);
    acc[key].count += 1;
    return acc;
  }, {})).sort((a, b) => String(a.materialType).localeCompare(String(b.materialType)));

  return (
    <div>
      <h2>📥 BIM Import & Take-off</h2>

      <div style={styles.card}>
        <label>Select Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={styles.input}>
          <option value="">-- Select Project --</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <p style={styles.helper}>
          Import a quantity take-off exported from Revit, ArchiCAD, Navisworks, Excel or any IFC tool.
          Imported components feed the quantity survey, the BOM and the 3D viewer.
        </p>
        <button onClick={downloadTemplate} style={styles.buttonSmall} type="button">⬇️ Download CSV template</button>
      </div>

      <div style={styles.grid2}>
        <form onSubmit={handleUpload} style={styles.card}>
          <h3>1. Upload a file</h3>
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={styles.fileInput}
          />
          <p style={styles.helper}>
            CSV, TSV or TXT. Expected columns (any order, extra columns ignored):
            Component, Material Type, Quantity, Unit, Phase.
          </p>
          <button type="submit" style={styles.button} disabled={busy}>
            {busy ? '⏳ Importing…' : '📤 Import Take-off'}
          </button>
        </form>

        <form onSubmit={handlePaste} style={styles.card}>
          <h3>2. Or paste from Excel</h3>
          <textarea
            placeholder={'Component\tMaterial Type\tQuantity\tUnit\tPhase\nGround floor slab\tConcrete\t24.5\tm3\tSubstructure'}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            style={{...styles.textarea, fontFamily: 'monospace', fontSize: '12px'}}
          />
          <p style={styles.helper}>Select a range in Excel, copy it, and paste here.</p>
          <button type="submit" style={styles.button} disabled={busy}>
            {busy ? '⏳ Importing…' : '📋 Import Pasted Rows'}
          </button>
        </form>
      </div>

      {error && <div style={styles.errorBox}>⚠️ {error}</div>}

      {report && (
        <div style={styles.reportBox}>
          <h3>Import Report {report.source ? `— ${report.source}` : ''}</h3>
          <p>
            ✅ Imported <strong>{report.imported}</strong> components ·
            ⚠️ Skipped <strong>{report.skipped}</strong> of <strong>{report.rowsFound}</strong> rows read
          </p>

          {report.errors && report.errors.length > 0 && (
            <div>
              <h4>Skipped rows</h4>
              <table style={styles.table}>
                <thead>
                  <tr><th>Line</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {report.errors.map((issue, index) => (
                    <tr key={index}>
                      <td>{issue.row || '-'}</td>
                      <td>{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={styles.card}>
        <h3>Take-off for this project ({components.length} components)</h3>

        {!projectId ? (
          <p style={styles.helper}>Select a project to see its imported components.</p>
        ) : components.length === 0 ? (
          <p style={styles.helper}>
            No components yet. Import a take-off above and the quantity survey, BOM and 3D viewer
            will have data to work with.
          </p>
        ) : (
          <>
            <table style={styles.table}>
              <thead>
                <tr><th>Material</th><th>Unit</th><th>Total Quantity</th><th>Components</th></tr>
              </thead>
              <tbody>
                {totals.map((row, index) => (
                  <tr key={index}>
                    <td>{row.materialType}</td>
                    <td>{row.unit}</td>
                    <td>{num(row.quantity).toLocaleString()}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4 style={{marginTop: '20px'}}>Imported rows</h4>
            <table style={styles.table}>
              <thead>
                <tr><th>Component</th><th>Material</th><th>Quantity</th><th>Unit</th><th>Phase</th></tr>
              </thead>
              <tbody>
                {components.map(row => (
                  <tr key={row.id}>
                    <td>{row.component_name}</td>
                    <td>{row.material_type}</td>
                    <td>{num(row.quantity).toLocaleString()}</td>
                    <td>{row.unit}</td>
                    <td>{row.phase || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button onClick={handleClear} style={{...styles.buttonSmall, color: '#d62828', borderColor: '#d62828', marginTop: '15px'}} disabled={busy}>
              🗑️ Clear this project's take-off
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ===================== PROGRESS TREND CHART =====================
function ProgressTrendChart({ rows, budget }) {
  const width = 720;
  const height = 220;
  const padLeft = 46;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 30;

  const progressOf = (row) => Math.max(0, num(row.progress_percent));
  const spendOf = (row) => (budget > 0 ? (num(row.budget_spent) / budget) * 100 : 0);

  // The axis fits 100% by default, and stretches when spending has gone past budget.
  const peak = Math.max(100, ...rows.map(spendOf), ...rows.map(progressOf));
  const domainMax = Math.max(100, Math.ceil(peak / 25) * 25);

  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const x = (index) => (rows.length === 1
    ? padLeft + plotWidth / 2
    : padLeft + (index / (rows.length - 1)) * plotWidth);
  const y = (value) => padTop + plotHeight - (Math.max(0, Math.min(domainMax, value)) / domainMax) * plotHeight;
  const path = (values) => values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');

  const gridValues = [];
  for (let value = 0; value <= domainMax; value += 25) gridValues.push(value);

  const progressValues = rows.map(progressOf);
  const spendValues = rows.map(spendOf);

  // Several entries often land on one day, so label by time unless the series spans longer.
  const firstTime = new Date(rows[0].created_at).getTime();
  const lastTime = new Date(rows[rows.length - 1].created_at).getTime();
  const sameDay = lastTime - firstTime < 24 * 60 * 60 * 1000;
  const labelStep = Math.max(1, Math.ceil(rows.length / 7));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Progress and budget used over time"
      style={{width: '100%', height: 'auto', display: 'block', marginTop: '10px'}}
    >
      {gridValues.map((value) => (
        <g key={value}>
          <line
            x1={padLeft} x2={width - padRight} y1={y(value)} y2={y(value)}
            stroke="#e7edf4" strokeWidth="1"
          />
          <text x={padLeft - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="#6b7785">
            {value}%
          </text>
        </g>
      ))}

      <line x1={padLeft} x2={width - padRight} y1={height - padBottom} y2={height - padBottom} stroke="#c3cdd8" strokeWidth="1" />

      <path d={path(spendValues)} fill="none" stroke="#FF6B35" strokeWidth="2.5" strokeLinejoin="round" />
      <path d={path(progressValues)} fill="none" stroke="#06a77d" strokeWidth="2.5" strokeLinejoin="round" />

      {rows.map((row, index) => (
        <g key={row.id ?? index}>
          <circle cx={x(index)} cy={y(spendOf(row))} r="3.5" fill="#FF6B35" />
          <circle cx={x(index)} cy={y(progressOf(row))} r="3.5" fill="#06a77d" />
        </g>
      ))}

      {rows.map((row, index) => {
        if (index % labelStep !== 0 && index !== rows.length - 1) return null;

        return (
          <text
            key={`label-${row.id ?? index}`}
            x={x(index)} y={height - padBottom + 16}
            textAnchor="middle" fontSize="10" fill="#6b7785"
          >
            {sameDay
              ? new Date(row.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              : new Date(row.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        );
      })}
    </svg>
  );
}

// ===================== PROJECT DASHBOARD (PROGRESS vs BUDGET + FRAUD ALERTS) =====================
function ProjectDashboardScreen({ token, projects }) {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState(null);
  const [progress, setProgress] = useState(null);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ progressPercent: '', budgetSpent: '', notes: '' });

  const authHeaders = { Authorization: `Bearer ${token}` };

  const load = async (id) => {
    if (!id) {
      setProject(null); setProgress(null); setHistory([]); setAlerts([]); setForecast(null); setEstimate(null);
      return;
    }

    try {
      // Progress, survey and forecast all 404 until something has been recorded,
      // so they are optional rather than failures of the screen.
      const optional = (url) => axios.get(url, { headers: authHeaders }).catch(() => null);

      const [projectResponse, progressResponse, historyResponse, alertsResponse, surveyResponse, forecastResponse] = await Promise.all([
        axios.get(`${API_URL}/api/projects/${id}`, { headers: authHeaders }),
        optional(`${API_URL}/api/progress/${id}`),
        optional(`${API_URL}/api/progress/${id}/history`),
        axios.get(`${API_URL}/api/fraud-detection/${id}`, { headers: authHeaders }),
        optional(`${API_URL}/api/quantity-survey/${id}`),
        optional(`${API_URL}/api/budget/forecast/${id}`)
      ]);

      setProject(projectResponse.data);
      setProgress(progressResponse?.data || null);
      setHistory(Array.isArray(historyResponse?.data) ? historyResponse.data : []);
      setAlerts(alertsResponse.data || []);
      setEstimate(surveyResponse?.data || null);
      setForecast(forecastResponse?.data || null);

      const latest = progressResponse?.data || {};
      setForm({
        progressPercent: latest.progress_percent == null ? '' : String(num(latest.progress_percent)),
        budgetSpent: latest.budget_spent == null ? '' : String(num(latest.budget_spent)),
        notes: latest.notes || ''
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    setError(''); setNotice('');
    load(projectId);
  }, [projectId]);

  const saveProgress = async (e) => {
    e.preventDefault();

    const percent = form.progressPercent === '' ? null : Number(form.progressPercent);
    const spent = form.budgetSpent === '' ? null : Number(form.budgetSpent);

    if (percent === null || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      setError('Progress must be a number between 0 and 100.');
      return;
    }
    if (spent === null || !Number.isFinite(spent) || spent < 0) {
      setError('Budget spent must be zero or more.');
      return;
    }

    setBusy(true); setError(''); setNotice('');

    try {
      await axios.post(`${API_URL}/api/progress/update`, {
        projectId,
        progressPercent: percent,
        budgetSpent: spent,
        notes: form.notes
      }, { headers: authHeaders });

      setNotice('Progress recorded.');
      await load(projectId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const generateForecast = async () => {
    const budget = num(project?.budget);

    if (!budget || budget <= 0) {
      setError('This project has no budget set, so there is nothing to split.');
      return;
    }

    setBusy(true); setError(''); setNotice('');

    try {
      await axios.post(`${API_URL}/api/budget/forecast`, { projectId, totalBudget: budget }, { headers: authHeaders });
      setNotice('Budget forecast generated.');
      await load(projectId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const budget = num(project?.budget);
  const spent = num(progress?.budget_spent);
  const progressPct = Math.max(0, Math.min(100, num(progress?.progress_percent)));
  const spentPct = budget > 0 ? (spent / budget) * 100 : 0;
  const remaining = budget - spent;
  const burnGap = spentPct - progressPct;
  const estimateTotal = num(estimate?.totalAmount);
  const blockedAlerts = alerts.filter(a => String(a.recommendation).toUpperCase() === 'BLOCK_PAYMENT').length;

  const Bar = ({ percent, colour }) => (
    <div style={{height: '14px', background: '#e7edf4', borderRadius: '7px', overflow: 'hidden', margin: '8px 0 4px'}}>
      <div style={{width: `${Math.max(0, Math.min(100, percent))}%`, height: '100%', background: colour}} />
    </div>
  );

  const readDetails = (value) => {
    try { return JSON.parse(value) || {}; } catch (err) { return {}; }
  };

  return (
    <div>
      <h2>📈 Project Dashboard</h2>

      <div style={styles.card}>
        <label>Select Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={styles.input}>
          <option value="">-- Select Project --</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <p style={styles.helper}>
          Progress and spend are recorded below and compared against the project budget. Fraud alerts
          are the checks run for this project on the Fraud Check screen.
        </p>
      </div>

      {error && <div style={styles.errorBox}>⚠️ {error}</div>}
      {notice && <div style={styles.reportBox}>✅ {notice}</div>}

      {!projectId ? (
        <div style={styles.card}><p style={styles.helper}>Select a project to see its dashboard.</p></div>
      ) : (
        <>
          <div style={styles.grid}>
            <div style={styles.card}>
              <h3>Budget</h3>
              <p style={styles.largeNumber}>{money(budget)}</p>
              <p style={styles.resultDescription}>ETB · {project?.name}</p>
            </div>
            <div style={styles.card}>
              <h3>Spent</h3>
              <p style={styles.largeNumber}>{money(spent)}</p>
              <p style={styles.resultDescription}>ETB · {money(spentPct)}% of budget</p>
            </div>
            <div style={styles.card}>
              <h3>Remaining</h3>
              <p style={{...styles.largeNumber, color: remaining < 0 ? '#d62828' : '#06a77d'}}>{money(remaining)}</p>
              <p style={styles.resultDescription}>ETB · {remaining < 0 ? 'over budget' : 'left to spend'}</p>
            </div>
            <div style={styles.card}>
              <h3>Progress</h3>
              <p style={styles.largeNumber}>{fmt(progressPct, 1)}%</p>
              <p style={styles.resultDescription}>
                {progress ? `recorded ${new Date(progress.created_at).toLocaleDateString()}` : 'not recorded yet'}
              </p>
            </div>
          </div>

          <div style={styles.card}>
            <h3>Progress against budget</h3>

            <p style={{margin: '12px 0 0', fontWeight: 'bold'}}>Work complete — {fmt(progressPct, 1)}%</p>
            <Bar percent={progressPct} colour="#06a77d" />

            <p style={{margin: '12px 0 0', fontWeight: 'bold'}}>Budget used — {fmt(spentPct, 1)}%</p>
            <Bar percent={spentPct} colour={spentPct > progressPct ? '#d62828' : '#FF6B35'} />

            <p style={{...styles.helper, marginTop: '14px'}}>
              {burnGap > 1
                ? `Spending is ${fmt(burnGap, 1)} percentage points ahead of progress — cost is outrunning the work done.`
                : burnGap < -1
                  ? `Spending is ${fmt(Math.abs(burnGap), 1)} percentage points behind progress — the project is earning faster than it is consuming budget.`
                  : 'Spending and progress are roughly in step.'}
            </p>

            {estimateTotal > 0 && (
              <p style={styles.helper}>
                Rated take-off total from the quantity survey: {money(estimateTotal)} ETB
                {budget > 0 && ` (${fmt((estimateTotal / budget) * 100, 1)}% of budget)`}.
              </p>
            )}
          </div>

          <div style={styles.card}>
            <h3>Progress and spend over time</h3>
            {history.length === 0 ? (
              <p style={styles.helper}>
                No progress entries yet. Each save below is kept, and this chart plots them.
              </p>
            ) : (
              <>
                <p style={styles.helper}>
                  {history.length} entr{history.length === 1 ? 'y' : 'ies'}, oldest first.
                  {history.length === 1 && ' Record another to see a trend.'}
                </p>

                <ProgressTrendChart rows={history} budget={budget} />

                <p style={{...styles.helper, marginTop: '6px'}}>
                  <span style={{color: '#06a77d', fontWeight: 'bold'}}>— Progress</span>
                  {'   '}
                  <span style={{color: '#FF6B35', fontWeight: 'bold'}}>— Budget used</span>
                </p>

                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th>Recorded</th>
                      <th>Progress</th>
                      <th>Spent (ETB)</th>
                      <th>% of budget</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().map((entry) => {
                      const entryProgress = num(entry.progress_percent);
                      const entrySpent = num(entry.budget_spent);
                      const entrySpentPct = budget > 0 ? (entrySpent / budget) * 100 : 0;

                      return (
                        <tr key={entry.id}>
                          <td>{new Date(entry.created_at).toLocaleString()}</td>
                          <td>{fmt(entryProgress, 1)}%</td>
                          <td>{money(entrySpent)}</td>
                          <td style={{color: entrySpentPct > entryProgress + 1 ? '#d62828' : '#06a77d'}}>
                            {fmt(entrySpentPct, 1)}%
                          </td>
                          <td>{entry.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <form onSubmit={saveProgress} style={styles.card}>
            <h3>Record progress</h3>
            <div style={styles.grid2}>
              <div>
                <label>Progress complete (%)</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={form.progressPercent}
                  onChange={(e) => setForm({ ...form, progressPercent: e.target.value })}
                  style={styles.input}
                  required
                />
              </div>
              <div>
                <label>Budget spent (ETB)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={form.budgetSpent}
                  onChange={(e) => setForm({ ...form, budgetSpent: e.target.value })}
                  style={styles.input}
                  required
                />
              </div>
            </div>
            <textarea
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={styles.textarea}
            />
            <button type="submit" style={styles.button} disabled={busy}>
              {busy ? '⏳ Saving…' : '💾 Save progress'}
            </button>
            <p style={styles.helper}>
              Each save adds a progress entry; the dashboard shows the most recent one.
            </p>
          </form>

          <div style={styles.card}>
            <h3>Fraud alerts for this project ({alerts.length})</h3>
            {alerts.length === 0 ? (
              <p style={styles.helper}>
                No fraud checks recorded for this project yet. Run one on the Fraud Check screen and
                it will appear here with its score and recommendation.
              </p>
            ) : (
              <>
                <p style={styles.helper}>
                  {blockedAlerts} of {alerts.length} recommendation{alerts.length === 1 ? '' : 's'} blocked payment.
                </p>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th>Checked</th>
                      <th>Score</th>
                      <th>Recommendation</th>
                      <th>Quantity variance</th>
                      <th>Price variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert) => {
                      const details = readDetails(alert.details);
                      const blocked = String(alert.recommendation).toUpperCase() === 'BLOCK_PAYMENT';

                      return (
                        <tr key={alert.id}>
                          <td>{new Date(alert.created_at).toLocaleString()}</td>
                          <td style={{fontWeight: 'bold', color: blocked ? '#d62828' : '#06a77d'}}>
                            {fmt(alert.fraud_score, 1)}%
                          </td>
                          <td style={{color: blocked ? '#d62828' : '#06a77d', fontWeight: 'bold'}}>
                            {blocked ? '❌ BLOCK PAYMENT' : '✅ APPROVE'}
                          </td>
                          <td>{details.qtyVariance == null ? '—' : fmt(num(details.qtyVariance) * 100, 1) + '%'}</td>
                          <td>{details.priceVariance == null ? '—' : fmt(num(details.priceVariance) * 100, 1) + '%'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div style={styles.card}>
            <h3>Budget forecast</h3>
            {!forecast ? (
              <p style={styles.helper}>
                No forecast generated for this project yet. A forecast splits the project budget across
                materials, labour, equipment and contingency.
              </p>
            ) : (
              <>
                <p style={styles.helper}>
                  Generated {new Date(forecast.created_at).toLocaleString()}
                </p>
                <table style={styles.table}>
                  <thead>
                    <tr><th>Category</th><th>Allocated (ETB)</th><th>Share</th></tr>
                  </thead>
                  <tbody>
                    {[['Materials', forecast.materials], ['Labour', forecast.labor], ['Equipment', forecast.equipment], ['Contingency', forecast.contingency]].map(([label, value]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td>{money(value)}</td>
                        <td>{forecast.allocated > 0 ? fmt((num(value) / forecast.allocated) * 100, 1) + '%' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{fontWeight: 'bold', paddingTop: '12px'}}>Total allocated</td>
                      <td style={{fontWeight: 'bold', paddingTop: '12px'}}>{money(forecast.allocated)}</td>
                      <td style={{paddingTop: '12px'}}>100%</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
            <button
              onClick={generateForecast}
              style={{...styles.buttonSmall, marginTop: '15px'}}
              disabled={busy || !(budget > 0)}
            >
              {busy ? '⏳ Working…' : forecast ? '↻ Regenerate forecast' : '📊 Generate budget forecast'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ===================== SURVEYING CONTROL POINTS SCREEN (NEW) =====================
function SurveyingControlPointsScreen({ token, projects }) {
  const [projectId, setProjectId] = useState('');
  const [latitude, setLatitude] = useState('9.0320');
  const [longitude, setLongitude] = useState('38.7469');
  const [benchmarkElevation, setBenchmarkElevation] = useState('2355');
  const [groundLevel, setGroundLevel] = useState('2350');
  const [floorLevel, setFloorLevel] = useState('2360');
  const [foundationDepth, setFoundationDepth] = useState('2.5');
  const [buildingFootprint, setBuildingFootprint] = useState('2400');
  const [results, setResults] = useState(null);
  const [saved, setSaved] = useState(null);

  const handleCalculate = async (e) => {
    e.preventDefault();
    
    try {
      // Save control points
      const saveResponse = await axios.post(`${API_URL}/api/surveying/control-points`, {
        projectId,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        benchmarkElevation: parseFloat(benchmarkElevation),
        groundLevel: parseFloat(groundLevel),
        floorLevel: parseFloat(floorLevel),
        foundationDepth: parseFloat(foundationDepth),
        buildingFootprint: parseFloat(buildingFootprint)
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setSaved(saveResponse.data);

      // Calculate cut & fill
      const fillNeeded = parseFloat(floorLevel) - parseFloat(groundLevel);
      const calcResponse = await axios.post(`${API_URL}/api/earthworks/calculate`, {
        projectId,
        buildingFootprint: parseFloat(buildingFootprint),
        foundationDepth: parseFloat(foundationDepth),
        fillNeeded
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setResults(calcResponse.data);
    } catch (err) {
      alert('Error: ' + err.response?.data?.error);
    }
  };

  return (
    <div>
      <h2>📍 Surveying Control Points & Cut & Fill Calculation</h2>
      
      <form onSubmit={handleCalculate} style={styles.form}>
        <h3>1. Select Project</h3>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={styles.input} required>
          <option value="">-- Select Project --</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <h3>2. Site Location</h3>
        <div style={styles.grid2}>
          <div>
            <label>Latitude (°N)</label>
            <input type="number" step="0.0001" value={latitude} onChange={(e) => setLatitude(e.target.value)} style={styles.input} />
          </div>
          <div>
            <label>Longitude (°E)</label>
            <input type="number" step="0.0001" value={longitude} onChange={(e) => setLongitude(e.target.value)} style={styles.input} />
          </div>
        </div>

        <h3>3. Elevation Data (meters MSL)</h3>
        <div style={styles.grid2}>
          <div>
            <label>Benchmark Elevation</label>
            <input type="number" step="0.1" value={benchmarkElevation} onChange={(e) => setBenchmarkElevation(e.target.value)} style={styles.input} />
          </div>
          <div>
            <label>Current Ground Level</label>
            <input type="number" step="0.1" value={groundLevel} onChange={(e) => setGroundLevel(e.target.value)} style={styles.input} />
          </div>
          <div>
            <label>Designed Floor Level</label>
            <input type="number" step="0.1" value={floorLevel} onChange={(e) => setFloorLevel(e.target.value)} style={styles.input} />
          </div>
        </div>

        <h3>4. Building Specifications</h3>
        <div style={styles.grid2}>
          <div>
            <label>Foundation Depth (meters)</label>
            <input type="number" step="0.1" value={foundationDepth} onChange={(e) => setFoundationDepth(e.target.value)} style={styles.input} />
          </div>
          <div>
            <label>Building Footprint (m²)</label>
            <input type="number" step="1" value={buildingFootprint} onChange={(e) => setBuildingFootprint(e.target.value)} style={styles.input} />
          </div>
        </div>

        <button type="submit" style={styles.button}>🔢 CALCULATE CUT & FILL</button>
      </form>

      {results && (
        <div style={styles.resultsBox}>
          <h2>📊 Earthworks Calculation Results</h2>
          <div style={styles.grid}>
            <div style={styles.resultCard}>
              <h4>Excavation Volume (CUT)</h4>
              <p style={styles.resultValue}>{fmt(results.cutVolume)} m³</p>
              <p style={styles.resultDescription}>Cubic meters to remove</p>
            </div>
            <div style={styles.resultCard}>
              <h4>Fill Volume Required</h4>
              <p style={styles.resultValue}>{fmt(results.fillVolume)} m³</p>
              <p style={styles.resultDescription}>Cubic meters needed</p>
            </div>
            <div style={styles.resultCard}>
              <h4>Net Import Required</h4>
              <p style={{...styles.resultValue, color: num(results.netImport) > 0 ? '#d62828' : '#06a77d'}}>
                {fmt(results.netImport)} m³
              </p>
              <p style={styles.resultDescription}>{results.netImport > 0 ? 'Import from outside' : 'Export surplus'}</p>
            </div>
          </div>

          <div style={styles.card}>
            <h3>Material Requirements from Excavation</h3>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Unit</th>
                  <th>Quantity</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Foundation Concrete</td>
                  <td>m³</td>
                  <td>{fmt(num(results.cutVolume) * 0.35)}</td>
                  <td>35% of excavation volume</td>
                </tr>
                <tr>
                  <td>Rebar Steel (Foundation)</td>
                  <td>kg</td>
                  <td>{fmt(num(results.cutVolume) * 0.35 * 50)}</td>
                  <td>50 kg per m³ of concrete (not per m³ excavated)</td>
                </tr>
                <tr>
                  <td>PCC Base Course</td>
                  <td>m³</td>
                  <td>{fmt(num(results.cutVolume) * 0.10)}</td>
                  <td>10% of excavation volume</td>
                </tr>
                <tr>
                  <td>Earth Backfill</td>
                  <td>m³</td>
                  <td>{fmt(num(results.cutVolume) * 0.65)}</td>
                  <td>From excavation surplus</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {saved && (
        <div style={styles.successBox}>
          ✅ Control points saved successfully! You can now view in 3D Viewer and generate cut & fill reports.
        </div>
      )}
    </div>
  );
}

// ===================== 3D VIEWER SCREEN (Three.js, built from imported components) =====================
// Stable colour per material name, so a material keeps its colour across reloads.
const MATERIAL_COLOURS = new Map();
const colourForMaterial = (name) => {
  const key = String(name || 'Unspecified');
  if (!MATERIAL_COLOURS.has(key)) {
    let hue = 0;
    for (let i = 0; i < key.length; i++) hue = (hue * 31 + key.charCodeAt(i)) % 360;
    MATERIAL_COLOURS.set(key, new THREE.Color().setHSL(hue / 360, 0.55, 0.5));
  }
  return MATERIAL_COLOURS.get(key);
};

function ThreeDViewerScreen({ token, projects }) {
  const [projectId, setProjectId] = useState('');
  const [modelData, setModelData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const mountRef = useRef(null);

  const authHeaders = { Authorization: `Bearer ${token}` };
  const components = modelData?.components || [];
  const phases = [...new Set(components.map(c => c.phase || 'Unassigned'))];

  const loadModel = async (id) => {
    if (!id) { setModelData(null); return; }

    setLoading(true); setError(''); setSelected(null);

    try {
      const response = await axios.get(`${API_URL}/api/3d/model/${id}`, { headers: authHeaders });
      setModelData(response.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setModelData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModel(projectId);
  }, [projectId]);

  // Builds the scene from the project's components, and tears it down completely
  // when the data changes or the screen is left (Three.js objects are not GC'd).
  useEffect(() => {
    const mount = mountRef.current;
    const rows = modelData?.components || [];
    if (!mount || rows.length === 0) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f7);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.borderRadius = '8px';
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8fa3b8, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(22, 38, 18);
    scene.add(sun);

    // One block per imported component. Blocks are sized relative to the largest
    // quantity in their own unit group, because 500 kg and 500 m³ are not
    // comparable magnitudes.
    const maxByUnit = rows.reduce((acc, row) => {
      const unit = row.unit || 'units';
      acc[unit] = Math.max(acc[unit] || 0, num(row.quantity));
      return acc;
    }, {});

    const byPhase = rows.reduce((acc, row) => {
      const phase = row.phase || 'Unassigned';
      (acc[phase] = acc[phase] || []).push(row);
      return acc;
    }, {});
    const phaseNames = Object.keys(byPhase).sort();

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0); // blocks grow upward from the ground plane
    const materials = [];
    const blocks = new THREE.Group();
    const spacing = 2.8;

    phaseNames.forEach((phase, rowIndex) => {
      const row = byPhase[phase];
      const centring = (row.length - 1) / 2;

      row.forEach((component, columnIndex) => {
        const unit = component.unit || 'units';
        const share = maxByUnit[unit] > 0 ? num(component.quantity) / maxByUnit[unit] : 0;
        const side = Math.max(0.35, 2.7 * Math.cbrt(share)); // volume ∝ quantity

        const material = new THREE.MeshStandardMaterial({
          color: colourForMaterial(component.material_type),
          roughness: 0.45,
          metalness: 0.1
        });
        materials.push(material);

        const block = new THREE.Mesh(geometry, material);
        block.scale.set(side, side, side);
        block.position.set((columnIndex - centring) * spacing, 0, rowIndex * spacing);
        block.userData = component;
        blocks.add(block);
      });
    });

    scene.add(blocks);

    const span = Math.max(12, phaseNames.length * spacing, Math.max(...phaseNames.map(p => byPhase[p].length)) * spacing);
    const grid = new THREE.GridHelper(span * 1.6, 12, 0xbfc9d6, 0xdde4ec);
    scene.add(grid);

    const bounds = new THREE.Box3().setFromObject(blocks);
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);

    camera.position.set(centre.x + radius * 1.5, centre.y + radius * 1.2, centre.z + radius * 1.9);
    camera.lookAt(centre);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(centre);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.maxPolarAngle = Math.PI / 2.02; // stay above the ground plane

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    // Clicking a block reads its component back out.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(blocks.children, false)[0];
      setSelected(hit ? hit.object.userData : null);
    };
    renderer.domElement.addEventListener('click', handleClick);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      controls.dispose();
      geometry.dispose();
      materials.forEach(material => material.dispose());
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [modelData]);

  const legend = Object.values(components.reduce((acc, row) => {
    const key = `${row.material_type}|${row.unit}`;
    if (!acc[key]) acc[key] = { material: row.material_type, unit: row.unit, quantity: 0, count: 0 };
    acc[key].quantity += num(row.quantity);
    acc[key].count += 1;
    return acc;
  }, {})).sort((a, b) => String(a.material).localeCompare(String(b.material)));

  return (
    <div>
      <h2>🎨 3D Component Viewer</h2>
      
      <div style={styles.card}>
        <label>Select Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={styles.input}>
          <option value="">-- Select Project --</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <p style={styles.helper}>
          Each block is one component imported on the BIM Import screen, sized so its volume is
          proportional to its quantity within its own unit group — m³, kg and units are not
          comparable magnitudes, so they are scaled separately. Drag to rotate, scroll to zoom,
          click a block to read its component.
        </p>
      </div>

      {error && <div style={styles.errorBox}>⚠️ {error}</div>}

      {loading && (
        <div style={styles.card}><p style={styles.helper}>Loading components…</p></div>
      )}

      {!projectId ? (
        <div style={styles.card}>
          <p style={styles.helper}>Select a project to build its 3D view.</p>
        </div>
      ) : components.length === 0 && !loading ? (
        <div style={styles.card}>
          <p style={styles.helper}>
            No components for this project yet. Import a take-off on the BIM Import screen and
            each component will appear here as a block.
          </p>
        </div>
      ) : (
        <>
          {components.length > 0 && (
            <div style={{position: 'relative'}}>
              <div ref={mountRef} style={{...styles.viewer3d, height: '520px', background: '#eef2f7', overflow: 'hidden'}} />
              <div style={styles.viewerBadge}>
                {components.length} blocks · {phases.length} phase{phases.length === 1 ? '' : 's'} · drag to rotate, scroll to zoom
              </div>
            </div>
          )}

          {selected && (
            <div style={styles.card}>
              <h4 style={{marginTop: 0}}>{selected.component_name}</h4>
              <p style={styles.helper}>
                Material: {selected.material_type} · Quantity: {num(selected.quantity).toLocaleString()} {selected.unit} · Phase: {selected.phase || 'Unassigned'}
              </p>
            </div>
          )}

          <div style={styles.grid2}>
            <div style={styles.card}>
              <h3>Colour legend</h3>
              {legend.length === 0 ? (
                <p style={styles.helper}>Nothing to show yet.</p>
              ) : (
                <ul style={styles.featureList}>
                  {legend.map((line, index) => (
                    <li key={index} style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px'}}>
                      <span style={{width: '14px', height: '14px', borderRadius: '3px', flex: '0 0 14px', background: `#${colourForMaterial(line.material).getHexString()}`}} />
                      <span>{line.material} — {num(line.quantity).toLocaleString()} {line.unit} ({line.count} block{line.count === 1 ? '' : 's'})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={styles.card}>
              <h3>Scene contents</h3>
              <p>Phases: {phases.join(', ') || 'none'}</p>
              <p>Model files recorded: {modelData?.bimModel ? 1 : 0}</p>
              {modelData?.earthworks ? (
                <>
                  <p>Cut volume: {fmt(modelData.earthworks.cut_volume)} m³</p>
                  <p>Fill volume: {fmt(modelData.earthworks.fill_volume)} m³</p>
                </>
              ) : (
                <p style={styles.helper}>No earthworks calculation saved for this project yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===================== QUANTITY SURVEY SCREEN (NEW) =====================
function QuantitySurveyScreen({ token, projects }) {
  const [projectId, setProjectId] = useState('');
  const [survey, setSurvey] = useState(null);
  const [bom, setBom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftRates, setDraftRates] = useState({});
  const [savingRates, setSavingRates] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const loadSurvey = async (id) => {
    if (!id) { setSurvey(null); setBom(null); return; }

    try {
      // The BOM endpoint returns 404 until one has been generated, so it is
      // optional rather than a failure of the screen.
      const [surveyResponse, bomResponse] = await Promise.all([
        axios.get(`${API_URL}/api/quantity-survey/${id}`, { headers: authHeaders }),
        axios.get(`${API_URL}/api/bom/${id}`, { headers: authHeaders }).catch(() => null)
      ]);

      setSurvey(surveyResponse.data);
      setBom(bomResponse?.data || null);
      setDraftRates(
        (surveyResponse.data.summary || []).reduce((acc, line) => {
          acc[`${line.materialType}|${line.unit}`] = line.rate === null || line.rate === undefined ? '' : String(line.rate);
          return acc;
        }, {})
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    setError('');
    setNotice('');
    loadSurvey(projectId);
  }, [projectId]);

  const handleGenerate = async () => {
    if (!projectId) { setError('Select a project first.'); return; }

    if (!survey || survey.summary.length === 0) {
      setError('Nothing to put in a BOM yet — import a take-off on the BIM Import screen first.');
      return;
    }

    setBusy(true); setError(''); setNotice('');

    try {
      // The backend prices the BOM itself from the take-off and the saved rates.
      await axios.post(`${API_URL}/api/bom/generate`, { projectId }, { headers: authHeaders });
      setNotice('BOM generated and saved.');
      await loadSurvey(projectId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  // bom.components is stored as JSON text, so a malformed or old row must not
  // break the page.
  const bomLines = (() => {
    if (!bom?.components) return [];
    try {
      const parsed = JSON.parse(bom.components);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const summary = survey?.summary || [];
  const projectName = projects.find(p => String(p.id) === String(projectId))?.name;
  const stamp = todayStamp();
  const totalAmount = num(survey?.totalAmount);
  const pricedLines = survey?.pricedLines ?? 0;
  const unpricedLines = survey?.unpricedLines ?? 0;
  const bomTotal = num(bom?.totalAmount);
  const bomStoredTotal = num(bom?.storedTotal ?? bom?.total_cost);

  const handleRateChange = (line, value) => {
    setDraftRates({ ...draftRates, [`${line.materialType}|${line.unit}`]: value });
  };

  const handleSaveRates = async () => {
    setSavingRates(true); setError(''); setNotice('');

    try {
      const rates = summary.map(line => {
        const draft = draftRates[`${line.materialType}|${line.unit}`];
        return {
          materialType: line.materialType,
          unit: line.unit,
          rate: draft === '' || draft === undefined || draft === null ? null : draft
        };
      });

      const response = await axios.put(`${API_URL}/api/rates/${projectId}`, { rates }, { headers: authHeaders });
      setNotice(`Rates saved — ${response.data.pricedLines} of ${response.data.lines.length} lines now priced.`);
      await loadSurvey(projectId);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSavingRates(false);
    }
  };

  const exportSurvey = () => {
    const csv = buildCsv(
      ['Material', 'Unit', 'Total Quantity', 'Components', 'Rate (ETB/unit)', 'Amount (ETB)'],
      [
        ...summary.map(line => [
          line.materialType,
          line.unit,
          num(line.quantity).toFixed(2),
          line.componentCount,
          line.priced ? num(line.rate).toFixed(2) : '',
          line.priced ? num(line.amount).toFixed(2) : ''
        ]),
        ['Total', '', '', '', '', totalAmount.toFixed(2)]
      ]
    );
    downloadCsv(`quantity-survey-${safeFilePart(projectName)}-${stamp}.csv`, csv);
  };

  const exportBom = () => {
    const csv = buildCsv(
      ['Material', 'Unit', 'Quantity', 'Components', 'Rate (ETB/unit)', 'Amount (ETB)'],
      [
        ...bomLines.map(line => [
          line.materialType ?? line.material_type ?? '',
          line.unit ?? '',
          num(line.quantity).toFixed(2),
          line.componentCount ?? line.component_count ?? '',
          line.priced ? num(line.rate).toFixed(2) : '',
          line.priced ? num(line.amount).toFixed(2) : ''
        ]),
        ['Total', '', '', '', '', bomTotal.toFixed(2)]
      ]
    );
    downloadCsv(`bill-of-materials-${safeFilePart(projectName)}-${stamp}.csv`, csv);
  };

  return (
    <div>
      <h2>📋 Quantity Survey & Bill of Materials</h2>

      <div style={styles.card}>
        <label>Select Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={styles.input}>
          <option value="">-- Select Project --</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <p style={styles.helper}>
          Totals come from the components imported on the BIM Import screen, grouped by material and unit.
        </p>
      </div>

      {error && <div style={styles.errorBox}>⚠️ {error}</div>}
      {notice && <div style={styles.reportBox}>✅ {notice}</div>}

      {!projectId ? (
        <div style={styles.card}>
          <p style={styles.helper}>Select a project to see its quantity survey.</p>
        </div>
      ) : (
        <>
          <div style={styles.grid}>
            <div style={styles.card}>
              <h3>Materials</h3>
              <p style={styles.largeNumber}>{summary.length}</p>
              <p style={styles.resultDescription}>distinct material / unit lines</p>
            </div>
            <div style={styles.card}>
              <h3>Components</h3>
              <p style={styles.largeNumber}>{survey?.totalComponents ?? 0}</p>
              <p style={styles.resultDescription}>imported take-off rows</p>
            </div>
            <div style={styles.card}>
              <h3>Rated Total</h3>
              <p style={styles.largeNumber}>{money(totalAmount)}</p>
              <p style={styles.resultDescription}>ETB · {pricedLines} of {summary.length} lines priced</p>
            </div>
          </div>

          {unpricedLines > 0 && summary.length > 0 && (
            <div style={styles.errorBox}>
              ⚠️ {unpricedLines} of {summary.length} material lines have no rate yet, so they add
              0 ETB. The total is incomplete until every line is rated.
            </div>
          )}

          <div style={styles.card}>
            <h3>Material Totals & Rate Build-up</h3>
            {summary.length === 0 ? (
              <p style={styles.helper}>
                No components yet. Import a take-off on the BIM Import screen and the survey will fill in.
              </p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Unit</th>
                    <th>Total Quantity</th>
                    <th>Components</th>
                    <th>Rate (ETB / unit)</th>
                    <th>Amount (ETB)</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((line, index) => (
                    <tr key={index}>
                      <td>{line.materialType}</td>
                      <td>{line.unit}</td>
                      <td>{num(line.quantity).toLocaleString()}</td>
                      <td>{line.componentCount}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draftRates[`${line.materialType}|${line.unit}`] ?? ''}
                          onChange={(e) => handleRateChange(line, e.target.value)}
                          placeholder="no rate"
                          style={styles.rateInput}
                        />
                      </td>
                      <td>{line.priced ? money(line.amount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{textAlign: 'right', fontWeight: 'bold', paddingTop: '12px'}}>Total</td>
                    <td style={{fontWeight: 'bold', paddingTop: '12px'}}>{money(totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            {summary.length > 0 && (
              <p style={styles.helper}>
                Enter the rate for one unit of each material (ETB per m³, per kg, per unit). Blank a
                rate to clear it. Amount = quantity × rate, and the total is the sum of the line
                amounts. Save rates before generating the BOM.
              </p>
            )}

            <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '20px'}}>
              <button
                onClick={handleGenerate}
                style={styles.button}
                disabled={busy || summary.length === 0}
              >
                {busy ? '⏳ Generating…' : '📄 Generate Bill of Materials'}
              </button>
              <button
                onClick={handleSaveRates}
                style={styles.buttonSmall}
                disabled={savingRates || summary.length === 0}
              >
                {savingRates ? '⏳ Saving…' : '💾 Save rates'}
              </button>
              <button
                onClick={exportSurvey}
                style={styles.buttonSmall}
                disabled={summary.length === 0}
              >
                ⬇️ Export material totals (CSV)
              </button>
            </div>
          </div>

          <div style={styles.card}>
            <h3>Saved BOM</h3>
            {!bom ? (
              <p style={styles.helper}>
                No BOM generated for this project yet. Generate one from the material totals above.
              </p>
            ) : (
              <>
                <p style={styles.helper}>
                  Generated {bom.created_at ? new Date(bom.created_at).toLocaleString() : 'previously'} ·{' '}
                  {bomLines.length} line{bomLines.length === 1 ? '' : 's'} ·{' '}
                  {bom.pricedLines ?? 0} priced
                </p>

                <p style={{fontSize: '32px', fontWeight: 'bold', color: '#004E89', margin: '10px 0'}}>
                  {money(bomTotal)} ETB
                </p>

                {Number.isFinite(bomStoredTotal) && Math.abs(bomStoredTotal - bomTotal) > 0.009 && (
                  <p style={styles.helper}>
                    Re-priced with your current rates — the saved BOM total was {money(bomStoredTotal)} ETB.
                    Generate the BOM again to store the new figure.
                  </p>
                )}

                <button
                  onClick={exportBom}
                  style={{...styles.buttonSmall, marginBottom: '12px'}}
                  disabled={bomLines.length === 0}
                >
                  ⬇️ Export bill of materials (CSV)
                </button>

                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Unit</th>
                      <th>Quantity</th>
                      <th>Components</th>
                      <th>Rate (ETB / unit)</th>
                      <th>Amount (ETB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomLines.map((line, index) => (
                      <tr key={index}>
                        <td>{line.materialType ?? line.material_type ?? '-'}</td>
                        <td>{line.unit ?? '-'}</td>
                        <td>{num(line.quantity).toLocaleString()}</td>
                        <td>{line.componentCount ?? line.component_count ?? '-'}</td>
                        <td>{line.priced ? money(line.rate) : '—'}</td>
                        <td>{line.priced ? money(line.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{textAlign: 'right', fontWeight: 'bold', paddingTop: '12px'}}>Total (ETB)</td>
                      <td style={{fontWeight: 'bold', paddingTop: '12px'}}>{money(bomTotal)}</td>
                    </tr>
                  </tfoot>
                </table>

                <p style={styles.helper}>
                  Rates are what you entered on this screen; the BOM re-prices as your rates change.
                  Lines with no rate show “—” and contribute 0 ETB, so an incomplete rate sheet
                  always shows up as a smaller total rather than a silent one.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ===================== MATERIALS DATABASE SCREEN (NEW) =====================
function MaterialsDatabaseScreen({ token, projects }) {
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('Foundation');
  const [materials, setMaterials] = useState([]);
  const [customMaterials, setCustomMaterials] = useState([]);
  const [newMaterial, setNewMaterial] = useState({ materialType: '', unit: '', quantity: '', cost: '' });

  useEffect(() => {
    fetchMaterials();
  }, [category]);

  const fetchMaterials = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/materials/category/${category}`);
      setMaterials(response.data);
    } catch (err) {
      console.error('Error fetching materials:', err);
    }
  };

  const handleAddCustom = async (e) => {
    e.preventDefault();
    if (!projectId) {
      alert('Please select a project');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/api/materials/custom`, {
        projectId,
        ...newMaterial,
        category
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setCustomMaterials([...customMaterials, response.data]);
      setNewMaterial({ materialType: '', unit: '', quantity: '', cost: '' });
      alert('Custom material added!');
    } catch (err) {
      alert('Error: ' + err.response?.data?.error);
    }
  };

  return (
    <div>
      <h2>📦 Material Master Database (Ethiopian Standards)</h2>

      <div style={styles.card}>
        <label>Select Project for Custom Materials</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={styles.input}>
          <option value="">-- Optional --</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div style={styles.card}>
        <h3>Filter by Category</h3>
        <div style={styles.buttonGrid}>
          {['Foundation', 'Structural', 'Masonry', 'MEP', 'Finishes', 'Roofing', 'Safety'].map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={category === cat ? styles.buttonActive : styles.buttonSmall}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.card}>
        <h3>{category} Materials (Ethiopian Standards)</h3>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>Material</th>
              <th>Unit</th>
              <th>Standard Qty</th>
              <th>Cost (ETB)</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 ? (
              <tr><td colSpan="5">No materials found. Loading...</td></tr>
            ) : (
              materials.map((mat, idx) => (
                <tr key={idx}>
                  <td>{mat.material_type}</td>
                  <td>{mat.unit}</td>
                  <td>{mat.standard_quantity == null ? '-' : num(mat.standard_quantity)}</td>
                  <td>{mat.cost == null ? 'N/A' : num(mat.cost).toLocaleString()}</td>
                  <td>{mat.notes || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {projectId && (
        <div style={styles.card}>
          <h3>➕ Add Custom Material</h3>
          <form onSubmit={handleAddCustom} style={styles.form}>
            <div style={styles.grid2}>
              <input
                placeholder="Material Type"
                value={newMaterial.materialType}
                onChange={(e) => setNewMaterial({...newMaterial, materialType: e.target.value})}
                style={styles.input}
              />
              <input
                placeholder="Unit (m², kg, etc)"
                value={newMaterial.unit}
                onChange={(e) => setNewMaterial({...newMaterial, unit: e.target.value})}
                style={styles.input}
              />
              <input
                type="number"
                placeholder="Quantity"
                value={newMaterial.quantity}
                onChange={(e) => setNewMaterial({...newMaterial, quantity: e.target.value})}
                style={styles.input}
              />
              <input
                type="number"
                placeholder="Cost (ETB)"
                value={newMaterial.cost}
                onChange={(e) => setNewMaterial({...newMaterial, cost: e.target.value})}
                style={styles.input}
              />
            </div>
            <button type="submit" style={styles.button}>✅ Add Material</button>
          </form>

          {customMaterials.length > 0 && (
            <div style={{marginTop: '20px'}}>
              <h4>Custom Materials for this Project</h4>
              <ul>
                {customMaterials.map((mat, idx) => (
                  <li key={idx}>{mat.material_type} - {mat.quantity} {mat.unit} @ {mat.cost} ETB</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div style={styles.card}>
        <h3>📊 Ethiopian Standards Summary</h3>
        <ul style={styles.featureList}>
          <li>✅ 80+ pre-loaded materials</li>
          <li>✅ Foundation: Cement, Rebar, Sand, Gravel, Concrete, PCC</li>
          <li>✅ Structural: Concrete, Steel beams, Reinforcement</li>
          <li>✅ Masonry: Bricks, Blocks, Mortar, Plaster</li>
          <li>✅ MEP: Pipes, Electrical, Plumbing, Fixtures</li>
          <li>✅ Finishes: Tiles, Paint, Doors, Windows, Flooring</li>
          <li>✅ Roofing: Trusses, GI Sheets, Fasteners</li>
          <li>✅ Safety: Fire extinguishers, Signage, Handrails</li>
          <li>✅ Auto-calculate quantities based on building size</li>
          <li>✅ Add custom materials for local suppliers</li>
        </ul>
      </div>
    </div>
  );
}

// ===================== FRAUD DETECTION SCREEN =====================
function FraudDetectionScreen({ token, projects }) {
  const [projectId, setProjectId] = useState('');
  const [actualQty, setActualQty] = useState('60');
  const [expectedQty, setExpectedQty] = useState('50');
  const [actualPrice, setActualPrice] = useState('10.20');
  const [marketPrice, setMarketPrice] = useState('8.50');
  const [deliveryDate, setDeliveryDate] = useState('2024-01-15');
  const [expectedDate, setExpectedDate] = useState('2024-01-08');
  const [result, setResult] = useState(null);

  const handleAnalyze = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/api/fraud-detection/smart`, {
        projectId,
        actualQty: parseFloat(actualQty),
        expectedQty: parseFloat(expectedQty),
        actualPrice: parseFloat(actualPrice),
        marketPrice: parseFloat(marketPrice),
        deliveryDate,
        expectedDate
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setResult(response.data);
    } catch (err) {
      alert('Error: ' + err.response?.data?.error);
    }
  };

  const highRisk = result?.riskLevel === 'high';
  const scoringFactors = (result?.factors || []).filter(factor => factor.points > 0);

  return (
    <div>
      <h2>🚨 Fraud Check</h2>
      <p style={styles.helper}>
        Three weighted checks: price against market price, delivered quantity against what was
        expected, and delivery date against schedule. Each contributes points, shown below the
        result; 70 or more blocks payment. A high score means the invoice is worth looking at
        closely — it is not proof of fraud.
      </p>

      <form onSubmit={handleAnalyze} style={styles.form}>
        <div style={styles.card}>
          <label>Select Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={styles.input} required>
            <option value="">-- Select Project --</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div style={styles.card}>
          <h3>Material Delivery Details</h3>
          <div style={styles.grid2}>
            <div>
              <label>Actual Quantity</label>
              <input type="number" step="0.01" value={actualQty} onChange={(e) => setActualQty(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label>Expected Quantity</label>
              <input type="number" step="0.01" value={expectedQty} onChange={(e) => setExpectedQty(e.target.value)} style={styles.input} />
            </div>
          </div>

          <div style={styles.grid2}>
            <div>
              <label>Actual Price (per unit)</label>
              <input type="number" step="0.01" value={actualPrice} onChange={(e) => setActualPrice(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label>Market Price (per unit)</label>
              <input type="number" step="0.01" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} style={styles.input} />
            </div>
          </div>

          <div style={styles.grid2}>
            <div>
              <label>Delivery Date</label>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label>Expected Delivery Date</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} style={styles.input} />
            </div>
          </div>
        </div>

        <button type="submit" style={styles.button}>🔍 ANALYZE FOR FRAUD</button>
      </form>

      {result && (
        <div style={{...styles.card, borderLeft: `5px solid ${highRisk ? '#d62828' : '#06a77d'}`}}>
          <h2>Fraud Detection Result</h2>
          
          <div style={styles.grid}>
            <div style={{...styles.resultCard, background: highRisk ? '#ffe6e6' : '#e6f5f0'}}>
              <h3>Fraud Confidence Score</h3>
              <p style={{fontSize: '48px', fontWeight: 'bold', color: highRisk ? '#d62828' : '#06a77d'}}>
                {fmt(result.fraudScore, 1)}%
              </p>
              <p>{highRisk ? '🚨 HIGH RISK' : '✅ LOW RISK'}</p>
              <p style={styles.resultDescription}>payment is blocked from {result.threshold}%</p>
            </div>

            <div style={styles.resultCard}>
              <h3>Recommendation</h3>
              <p style={{fontSize: '24px', fontWeight: 'bold', color: result.recommendation === 'BLOCK_PAYMENT' ? '#d62828' : '#06a77d'}}>
                {result.recommendation === 'BLOCK_PAYMENT' ? '❌ BLOCK PAYMENT' : '✅ APPROVE PAYMENT'}
              </p>
            </div>
          </div>

          <div style={styles.card}>
            <h3>How the score was built</h3>
            <p style={styles.helper}>
              Each factor scores nothing inside its tolerance and its full points at its saturation
              point. The points add up to the total, and {result.threshold}% or more blocks payment.
            </p>

            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Measured</th>
                  <th>Normal up to</th>
                  <th>Points</th>
                  <th>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {(result.factors || []).map((factor) => (
                  <tr key={factor.key}>
                    <td>
                      {factor.label}
                      <div style={styles.factorNote}>{factor.explanation}</div>
                    </td>
                    <td>{fmt(factor.measured, 1)}{factor.unit}</td>
                    <td>{factor.tolerance}{factor.unit}</td>
                    <td style={{fontWeight: 'bold', color: factor.points >= result.threshold ? '#d62828' : factor.points > 0 ? '#FF6B35' : '#06a77d'}}>
                      {fmt(factor.points, 1)} of {factor.maxPoints}
                    </td>
                    <td>
                      <div style={{height: '12px', background: '#e7edf4', borderRadius: '6px', overflow: 'hidden', minWidth: '90px'}}>
                        <div style={{width: `${Math.min(100, (factor.points / factor.maxPoints) * 100)}%`, height: '100%', background: factor.points >= result.threshold ? '#d62828' : '#FF6B35'}} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{textAlign: 'right', fontWeight: 'bold', paddingTop: '12px'}}>Total score</td>
                  <td style={{fontWeight: 'bold', paddingTop: '12px'}}>{fmt(result.fraudScore, 1)}%</td>
                  <td style={{paddingTop: '12px'}}>{result.capped ? 'capped at 99%' : ''}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={styles.card}>
            <h3>What it means in money</h3>
            <p style={{margin: '8px 0 0'}}>
              <strong>Invoiced above expected:</strong> {money(result.excessClaimed)} ETB
            </p>
            <p style={styles.helper}>
              Delivered quantity at the invoiced price, less the expected quantity at market price.
              {scoringFactors.length > 0 && ` Scored here by: ${scoringFactors.map(factor => factor.label.toLowerCase()).join(', ')}.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== PROJECTS SCREEN =====================
function ProjectsScreen({ token, projects, setSelectedProject, setCurrentScreen }) {
  return (
    <div>
      <h2>📁 Your Projects</h2>
      <div style={styles.grid}>
        {projects.map(project => (
          <div key={project.id} style={styles.projectCard} onClick={() => { setSelectedProject(project); setCurrentScreen('project-details'); }}>
            <h3>{project.name}</h3>
            <p>{project.description}</p>
            <p><strong>Budget:</strong> {project.budget == null ? 'N/A' : num(project.budget).toLocaleString()}</p>
            <p><strong>Location:</strong> {project.location}</p>
            <button style={styles.smallButton}>View Details →</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===================== PROJECT DETAILS SCREEN =====================
function ProjectDetailsScreen({ token, project, setCurrentScreen }) {
  const [survey, setSurvey] = useState(null);
  const [bom, setBom] = useState(null);
  const [progress, setProgress] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [earthworks, setEarthworks] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };
  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return undefined;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        // Every one of these 404s until the project has that kind of data, so they
        // are optional rather than failures of the page.
        const optional = (url) => axios.get(url, { headers: authHeaders }).catch(() => null);

        const [surveyResponse, bomResponse, progressResponse, alertsResponse, earthworksResponse] = await Promise.all([
          optional(`${API_URL}/api/quantity-survey/${projectId}`),
          optional(`${API_URL}/api/bom/${projectId}`),
          optional(`${API_URL}/api/progress/${projectId}`),
          optional(`${API_URL}/api/fraud-detection/${projectId}`),
          optional(`${API_URL}/api/earthworks/${projectId}`)
        ]);

        if (cancelled) return;

        setSurvey(surveyResponse?.data || null);
        setBom(bomResponse?.data || null);
        setProgress(progressResponse?.data || null);
        setAlerts(alertsResponse?.data || []);
        setEarthworks(earthworksResponse?.data || null);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (!project) {
    return (
      <div>
        <h2>📁 Project Details</h2>
        <div style={styles.card}>
          <p style={styles.helper}>No project selected.</p>
          <button onClick={() => setCurrentScreen('projects')} style={styles.buttonSmall}>← Back to Projects</button>
        </div>
      </div>
    );
  }

  const budget = num(project.budget);
  const spent = num(progress?.budget_spent);
  const progressPct = num(progress?.progress_percent);
  const spentPct = budget > 0 ? (spent / budget) * 100 : 0;
  const remaining = budget - spent;
  const lines = survey?.summary || [];
  const ratedTotal = num(survey?.totalAmount);
  const blockedAlerts = alerts.filter(a => String(a.recommendation).toUpperCase() === 'BLOCK_PAYMENT').length;

  const bomLines = (() => {
    if (!bom?.components) return [];
    try {
      const parsed = JSON.parse(bom.components);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  })();

  // Biggest material lines first: by cost when priced, otherwise by quantity.
  const topLines = [...lines]
    .sort((a, b) => (b.priced ? num(b.amount) : num(b.quantity)) - (a.priced ? num(a.amount) : num(a.quantity)))
    .slice(0, 5);

  return (
    <div>
      <button onClick={() => setCurrentScreen('projects')} style={{...styles.buttonSmall, marginBottom: '15px'}}>
        ← Back to Projects
      </button>

      <h2>📁 {project.name}</h2>

      <div style={styles.card}>
        {project.description && <p style={{marginTop: 0}}>{project.description}</p>}
        <p style={styles.helper}>
          {project.location || 'No location'} · {project.timeline ? `${project.timeline} months` : 'No timeline'} ·{' '}
          created {project.created_at ? new Date(project.created_at).toLocaleDateString() : 'unknown'}
        </p>
      </div>

      {error && <div style={styles.errorBox}>⚠️ {error}</div>}
      {loading && <div style={styles.card}><p style={styles.helper}>Loading project data…</p></div>}

      <div style={styles.grid}>
        <div style={styles.card}>
          <h3>Budget</h3>
          <p style={styles.largeNumber}>{money(budget)}</p>
          <p style={styles.resultDescription}>ETB</p>
        </div>
        <div style={styles.card}>
          <h3>Spent</h3>
          <p style={styles.largeNumber}>{money(spent)}</p>
          <p style={styles.resultDescription}>ETB · {fmt(spentPct, 1)}% of budget</p>
        </div>
        <div style={styles.card}>
          <h3>Remaining</h3>
          <p style={{...styles.largeNumber, color: remaining < 0 ? '#d62828' : '#06a77d'}}>{money(remaining)}</p>
          <p style={styles.resultDescription}>ETB</p>
        </div>
        <div style={styles.card}>
          <h3>Progress</h3>
          <p style={styles.largeNumber}>{progress ? `${fmt(progressPct, 1)}%` : '—'}</p>
          <p style={styles.resultDescription}>
            {progress ? `recorded ${new Date(progress.created_at).toLocaleDateString()}` : 'not recorded yet'}
          </p>
        </div>
      </div>

      <div style={styles.grid2}>
        <div style={styles.card}>
          <h3>Take-off</h3>
          {lines.length === 0 ? (
            <p style={styles.helper}>
              No components imported. Import a take-off on the BIM Import screen.
            </p>
          ) : (
            <>
              <p style={styles.helper}>
                {survey?.totalComponents ?? 0} components · {lines.length} material line{lines.length === 1 ? '' : 's'} ·{' '}
                {ratedTotal > 0 ? `${money(ratedTotal)} ETB rated` : 'no rates set'}
              </p>
              <table style={styles.table}>
                <thead>
                  <tr><th>Material</th><th>Quantity</th><th>Amount (ETB)</th></tr>
                </thead>
                <tbody>
                  {topLines.map((line, index) => (
                    <tr key={index}>
                      <td>{line.materialType}</td>
                      <td>{num(line.quantity).toLocaleString()} {line.unit}</td>
                      <td>{line.priced ? money(line.amount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ratesMissing(lines) && (
                <p style={styles.helper}>
                  Some material lines have no rate yet, so the rated total is incomplete.
                </p>
              )}
            </>
          )}
        </div>

        <div style={styles.card}>
          <h3>Latest BOM</h3>
          {!bom ? (
            <p style={styles.helper}>
              No BOM generated for this project yet. Build one on the Quantity Survey screen.
            </p>
          ) : (
            <>
              <p style={styles.largeNumber}>{money(num(bom.totalAmount))}</p>
              <p style={styles.resultDescription}>ETB</p>
              <p style={styles.helper}>
                {bomLines.length} line{bomLines.length === 1 ? '' : 's'} · generated{' '}
                {bom.created_at ? new Date(bom.created_at).toLocaleString() : 'previously'}
              </p>
              {Number.isFinite(num(bom.storedTotal)) && Math.abs(num(bom.storedTotal) - num(bom.totalAmount)) > 0.009 && (
                <p style={styles.helper}>
                  Re-priced with your current rates; the saved total was {money(num(bom.storedTotal))} ETB.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div style={styles.grid2}>
        <div style={styles.card}>
          <h3>Latest progress</h3>
          {!progress ? (
            <p style={styles.helper}>
              No progress recorded. Record it on the Progress & Budget screen.
            </p>
          ) : (
            <>
              <p>{fmt(progressPct, 1)}% complete · {money(spent)} ETB spent</p>
              <p style={styles.helper}>
                {progress.notes ? progress.notes : 'No notes on this entry.'}
              </p>
              <p style={styles.helper}>
                Saved {new Date(progress.created_at).toLocaleString()}
              </p>
            </>
          )}
        </div>

        <div style={styles.card}>
          <h3>Fraud checks</h3>
          {alerts.length === 0 ? (
            <p style={styles.helper}>
              No fraud checks recorded for this project yet.
            </p>
          ) : (
            <>
              <p style={styles.largeNumber}>{alerts.length}</p>
              <p style={styles.resultDescription}>
                checks · {blockedAlerts} blocked payment
              </p>
              <p style={styles.helper}>
                Most recent: {fmt(alerts[0].fraud_score, 1)}% ·{' '}
                {String(alerts[0].recommendation).toUpperCase() === 'BLOCK_PAYMENT' ? '❌ BLOCK PAYMENT' : '✅ APPROVE'} ·{' '}
                {new Date(alerts[0].created_at).toLocaleDateString()}
              </p>
            </>
          )}
        </div>
      </div>

      {earthworks && (
        <div style={styles.card}>
          <h3>Earthworks</h3>
          <p style={styles.helper}>
            Cut {fmt(num(earthworks.cut_volume))} m³ · Fill {fmt(num(earthworks.fill_volume))} m³ ·
            Net {fmt(num(earthworks.net_volume))} m³
            {' '}({num(earthworks.net_volume) > 0 ? 'import required' : 'surplus to export'})
          </p>
        </div>
      )}
    </div>
  );
}

// ===================== NEW PROJECT SCREEN =====================
function NewProjectScreen({ token, fetchProjects, setCurrentScreen }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [location, setLocation] = useState('');
  const [timeline, setTimeline] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/api/projects`, {
        name, description, budget, location, timeline
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Project created!');
      fetchProjects();
      setCurrentScreen('projects');
    } catch (err) {
      alert('Error: ' + err.response?.data?.error);
    }
  };

  return (
    <div>
      <h2>➕ Create New Project</h2>
      <form onSubmit={handleCreate} style={styles.form}>
        <input placeholder="Project Name" value={name} onChange={(e) => setName(e.target.value)} style={styles.input} required />
        <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={styles.textarea} />
        <input type="number" placeholder="Budget (USD)" value={budget} onChange={(e) => setBudget(e.target.value)} style={styles.input} required />
        <input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} style={styles.input} required />
        <input placeholder="Timeline (months)" type="number" value={timeline} onChange={(e) => setTimeline(e.target.value)} style={styles.input} />
        <button type="submit" style={styles.button}>✅ Create Project</button>
      </form>
    </div>
  );
}

// ===================== STYLES =====================
const styles = {
  container: { fontFamily: 'Calibri, Arial', maxWidth: '1400px', margin: '0 auto', padding: '0' },
  header: { background: '#004E89', color: 'white', padding: '30px', textAlign: 'center' },
  nav: { display: 'flex', gap: '10px', padding: '20px', background: '#f0f0f0', flexWrap: 'wrap', justifyContent: 'center', overflowX: 'auto' },
  navButton: { padding: '10px 15px', background: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px', fontSize: '14px' },
  navButtonActive: { padding: '10px 15px', background: '#FF6B35', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px', fontSize: '14px', fontWeight: 'bold' },
  navButtonLogout: { padding: '10px 15px', background: '#d62828', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '5px', fontSize: '14px' },
  main: { padding: '30px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '20px' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '15px' },
  buttonGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '10px' },
  card: { background: 'white', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' },
  projectCard: { background: 'white', border: '2px solid #004E89', borderRadius: '8px', padding: '20px', cursor: 'pointer', transition: 'all 0.3s' },
  resultCard: { background: '#f9f9f9', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', textAlign: 'center' },
  resultsBox: { background: '#e6f5f0', border: '2px solid #06a77d', borderRadius: '8px', padding: '20px', marginTop: '20px' },
  successBox: { background: '#e6f5f0', border: '2px solid #06a77d', borderRadius: '8px', padding: '15px', marginTop: '20px', color: '#06a77d', fontWeight: 'bold' },
  viewer3d: { width: '100%', height: '500px', border: '2px solid #ddd', borderRadius: '8px', marginTop: '20px', position: 'relative' },
  viewerEmpty: { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999' },
  viewerLoaded: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', height: '100%', padding: '20px' },
  viewerInfo: { background: 'white', padding: '15px', borderRadius: '5px', border: '1px solid #ddd', overflow: 'auto' },
  viewerTools: { background: 'white', padding: '15px', borderRadius: '5px', border: '1px solid #ddd', overflow: 'auto' },
  featureGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' },
  featureList: { listStyle: 'none', padding: '0' },
  form: { display: 'flex', flexDirection: 'column', gap: '15px' },
  input: { padding: '12px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px', fontFamily: 'Calibri' },
  textarea: { padding: '12px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '14px', fontFamily: 'Calibri', minHeight: '100px' },
  button: { padding: '12px', background: '#FF6B35', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' },
  buttonSmall: { padding: '8px 12px', background: 'white', border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer', fontSize: '14px' },
  buttonActive: { padding: '8px 12px', background: '#FF6B35', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' },
  smallButton: { padding: '8px 12px', background: '#004E89', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px' },
  toggleButton: { marginTop: '15px', padding: '10px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '5px', cursor: 'pointer' },
  authContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #004E89, #FF6B35)' },
  authBox: { background: 'white', padding: '40px', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '15px' },
  largeNumber: { fontSize: '48px', fontWeight: 'bold', color: '#FF6B35', margin: '10px 0' },
  status: { fontSize: '24px', fontWeight: 'bold', color: '#06a77d' },
  resultValue: { fontSize: '36px', fontWeight: 'bold', color: '#004E89', margin: '10px 0' },
  resultDescription: { fontSize: '12px', color: '#666' },
  factorNote: { fontSize: '11px', color: '#8a8f98', marginTop: '2px' },
  fileInput: { padding: '10px', border: '1px dashed #004E89', borderRadius: '5px', background: '#f9f9f9', width: '100%', boxSizing: 'border-box' },
  errorBox: { background: '#ffe6e6', border: '2px solid #d62828', borderRadius: '8px', padding: '15px', marginTop: '20px', color: '#d62828', fontWeight: 'bold' },
  reportBox: { background: '#e6f5f0', border: '2px solid #06a77d', borderRadius: '8px', padding: '20px', marginTop: '20px' },
  helper: { fontSize: '12px', color: '#666', marginTop: '8px' },
  rateInput: { width: '110px', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', fontFamily: 'Calibri' },
  viewerBadge: { position: 'absolute', left: '12px', bottom: '12px', background: 'rgba(0,78,137,0.88)', color: 'white', padding: '6px 10px', borderRadius: '5px', fontSize: '12px', pointerEvents: 'none' },
};
