-- ==================== SITETRACKERPRO v3.0 ENHANCED DATABASE SCHEMA ====================
-- This schema includes all original tables PLUS new 3D, earthworks, and materials tables

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  company VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  budget DECIMAL(15,2),
  location VARCHAR(255),
  timeline VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- BIM Models table
CREATE TABLE IF NOT EXISTS bim_models (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  file_name VARCHAR(255),
  file_path VARCHAR(500),
  file_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- BIM Components table
CREATE TABLE IF NOT EXISTS bim_components (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  component_name VARCHAR(255),
  material_type VARCHAR(100),
  quantity DECIMAL(10,2),
  unit VARCHAR(50),
  phase VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== NEW: SURVEYING & EARTHWORKS TABLES ====================

-- Surveying Control Points table (NEW)
CREATE TABLE IF NOT EXISTS surveying_control_points (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  benchmark_elevation DECIMAL(10,2),
  ground_level DECIMAL(10,2),
  floor_level DECIMAL(10,2),
  foundation_depth DECIMAL(10,2),
  building_footprint DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Earthworks Calculations table (NEW)
CREATE TABLE IF NOT EXISTS earthworks_calculations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  cut_volume DECIMAL(15,2),
  fill_volume DECIMAL(15,2),
  net_volume DECIMAL(15,2),
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== NEW: MATERIALS DATABASE TABLES ====================

-- Ethiopian Materials Standards table (NEW)
CREATE TABLE IF NOT EXISTS materials_ethiopian_standards (
  id SERIAL PRIMARY KEY,
  material_type VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(50),
  standard_quantity DECIMAL(10,2),
  cost DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Custom Materials table (NEW)
CREATE TABLE IF NOT EXISTS materials_custom (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  material_type VARCHAR(255),
  category VARCHAR(100),
  unit VARCHAR(50),
  quantity DECIMAL(10,2),
  cost DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== RATE BUILD-UP (BOM PRICING) ====================

-- One editable rate per material + unit, per project. The rate is the price of one
-- unit (ETB per m3, ETB per kg, ...), so quantity * rate gives the line amount.
CREATE TABLE IF NOT EXISTS project_material_rates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  material_type VARCHAR(255) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  rate DECIMAL(15,2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, material_type, unit)
);

-- ==================== 3D MODEL CACHE TABLE (NEW) ====================

-- 3D Model Cache table (NEW)
-- NOTE: this was originally named `3d_model_cache`, which is not a legal
-- PostgreSQL identifier (unquoted names cannot begin with a digit), so the whole
-- schema failed to load. Renamed to model_cache_3d; no code referenced the old name.
CREATE TABLE IF NOT EXISTS model_cache_3d (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  model_data TEXT,
  model_format VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== ORIGINAL TABLES ====================

-- Bill of Materials table
CREATE TABLE IF NOT EXISTS bom (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  components TEXT,
  total_cost DECIMAL(15,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Budget Forecast table
CREATE TABLE IF NOT EXISTS budget_forecast (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  materials DECIMAL(15,2),
  labor DECIMAL(15,2),
  equipment DECIMAL(15,2),
  contingency DECIMAL(15,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Delivery Schedule table
CREATE TABLE IF NOT EXISTS delivery_schedule (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  phase VARCHAR(100),
  week INTEGER,
  material VARCHAR(255),
  lead_time_days INTEGER,
  scheduled_delivery DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Project Progress table
CREATE TABLE IF NOT EXISTS project_progress (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  progress_percent DECIMAL(5,2),
  budget_spent DECIMAL(15,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fraud Detections table
CREATE TABLE IF NOT EXISTS fraud_detections (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  fraud_score DECIMAL(5,2),
  recommendation VARCHAR(50),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deliveries table
CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  material VARCHAR(255),
  quantity DECIMAL(10,2),
  delivery_date DATE,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workers table
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name VARCHAR(255),
  role VARCHAR(100),
  hire_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Safety Incidents table
CREATE TABLE IF NOT EXISTS safety_incidents (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  description TEXT,
  incident_date DATE,
  severity VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity Logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(255),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_bim_models_project_id ON bim_models(project_id);
CREATE INDEX IF NOT EXISTS idx_bim_components_project_id ON bim_components(project_id);
CREATE INDEX IF NOT EXISTS idx_surveying_project_id ON surveying_control_points(project_id);
CREATE INDEX IF NOT EXISTS idx_earthworks_project_id ON earthworks_calculations(project_id);
CREATE INDEX IF NOT EXISTS idx_materials_custom_project_id ON materials_custom(project_id);
CREATE INDEX IF NOT EXISTS idx_rates_project_id ON project_material_rates(project_id);
CREATE INDEX IF NOT EXISTS idx_fraud_project_id ON fraud_detections(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_project_id ON project_progress(project_id);

-- ==================== SEED DATA: ETHIOPIAN MATERIALS ====================

INSERT INTO materials_ethiopian_standards (material_type, category, unit, standard_quantity, cost, notes) VALUES
-- Foundation Materials
('Cement (Type I OPC)', 'Foundation', 'Kg', 300, 1500, 'Per m³ concrete'),
('Sand (Foundation Grade)', 'Foundation', 'M³', 0.5, 250, 'Per m³ concrete'),
('Gravel (Coarse Aggregate)', 'Foundation', 'M³', 0.7, 300, 'Per m³ concrete'),
('Rebar Steel (Y12)', 'Foundation', 'Kg', 50, 100, 'Per m³ concrete'),
('Blinding Concrete (100mm)', 'Foundation', 'M³', 0.1, 1200, 'Foundation preparation'),
('PCC Base Course', 'Foundation', 'Kg', 200, 150, 'Foundation base'),
('Form Work Lumber', 'Foundation', 'M³', 0.15, 5000, 'Temporary support'),

-- Structural Materials
('Cement for Structure', 'Structural', 'Bags', 8, 500, 'Per m³ (1 bag = 50kg)'),
('M Sand (Concrete)', 'Structural', 'M³', 0.43, 300, 'Per m³ concrete'),
('Coarse Aggregate (20mm)', 'Structural', 'M³', 0.67, 350, 'Per m³ concrete'),
('Structural Steel Beams', 'Structural', 'Kg', 50, 100, 'Per m² floor area'),
('Column Rebar (Y16)', 'Structural', 'Kg', 30, 100, 'Per m³ concrete'),
('Beam Rebar (Y12)', 'Structural', 'Kg', 20, 100, 'Per m³ concrete'),
('Slab Rebar (Y10)', 'Structural', 'Kg', 8, 100, 'Per m² slab'),
('Steel Reinforcement Mesh', 'Structural', 'Kg', 5, 100, 'Per m² slab'),

-- Masonry Materials
('Burnt Clay Bricks', 'Masonry', 'Units', 400, 0.5, 'Per m² wall (225×115×75mm)'),
('Cement Mortar', 'Masonry', 'M³', 0.1, 2000, 'Per m² brickwork'),
('Sand for Mortar', 'Masonry', 'M³', 0.08, 200, 'Per m² brickwork'),
('CMU Blocks (400×200×200)', 'Masonry', 'Units', 12, 30, 'Per m² wall'),
('Plaster Sand', 'Masonry', 'M³', 0.03, 250, 'Per m² wall'),
('Plaster Cement', 'Masonry', 'Kg', 20, 1500, 'Per m² wall'),

-- MEP Materials
('Copper Pipe (DN20)', 'MEP', 'Meter', 0.6, 200, 'Water supply per m² floor'),
('PVC Pipe (50mm)', 'MEP', 'Meter', 0.4, 100, 'Sanitary drainage per m² floor'),
('Electrical Cable (2.5mm²)', 'MEP', 'Meter', 2.0, 50, 'Power wiring per m² floor'),
('Electrical Conduit (25mm)', 'MEP', 'Meter', 0.8, 60, 'Protection tubing per m² floor'),
('Distribution Board (63A)', 'MEP', 'Units', 1, 3000, 'Per 400m² floor'),
('Light Outlets', 'MEP', 'Units', 1, 500, 'Per 12-15 m² floor'),
('Power Outlets', 'MEP', 'Units', 1, 400, 'Per 15-20 m² floor'),
('Switches', 'MEP', 'Units', 1, 200, 'Per 30 m² floor'),
('Water Meter', 'MEP', 'Units', 1, 1500, 'Per building'),
('Sanitary Fixtures Set', 'MEP', 'Sets', 1, 8000, 'Per 50m² (toilet+sink)'),

-- Finish Materials
('Ceramic Tiles (Floor)', 'Finishes', 'M²', 1.05, 2000, 'Floor tiles (5% waste)'),
('Ceramic Tiles (Wall)', 'Finishes', 'M²', 1.05, 1500, 'Wall tiles (5% waste)'),
('Paint (Emulsion)', 'Finishes', 'Liters', 0.1, 800, 'Per m² (2 coats)'),
('Wood Flooring (Parquet)', 'Finishes', 'M²', 1.0, 5000, 'Wooden flooring'),
('Door Frame (Wood)', 'Finishes', 'Units', 1, 3000, 'Per 30m² floor'),
('Wooden Door', 'Finishes', 'Units', 1, 4000, 'Per 25m² floor'),
('Aluminum Window Frame', 'Finishes', 'M²', 0.15, 2000, 'Per m² floor area'),
('Clear Glass', 'Finishes', 'M²', 0.15, 1500, 'For windows per m² floor'),
('Suspended Ceiling Material', 'Finishes', 'M²', 1.0, 800, 'Plaster or acoustic'),

-- Roofing Materials
('Mild Steel Roof Trusses', 'Roofing', 'Kg', 30, 100, 'Per m² roof area'),
('Corrugated GI Sheets', 'Roofing', 'M²', 1.1, 1200, 'Roofing sheets (10% overlap)'),
('Fasteners/Screws', 'Roofing', 'Kg', 0.5, 500, 'Per m² roofing'),
('Ridge Caps', 'Roofing', 'Meter', 0.3, 300, 'Per m² roof area'),
('Concrete Roofing Tiles', 'Roofing', 'Units', 7, 200, 'Per m² if tile roof'),
('Bituminous Waterproofing', 'Roofing', 'M²', 1.1, 600, 'For flat roofs'),

-- Safety Materials
('Fire Extinguisher (ABC)', 'Safety', 'Units', 1, 1500, 'Per 1,000m² building'),
('Emergency Exit Signage', 'Safety', 'Units', 2, 500, 'Per floor'),
('Steel Handrails', 'Safety', 'Meter', 1, 2000, 'Per 3 meters stairs'),
('Safety Paint (Yellow)', 'Safety', 'Liters', 0.05, 800, 'Hazard markings per 100m²'),
('Safety Sand Bins', 'Safety', 'Units', 2, 800, 'Per floor (safety equipment')
ON CONFLICT DO NOTHING;

-- ==================== VIEWS ====================

CREATE OR REPLACE VIEW project_summary AS
SELECT 
  p.id,
  p.name,
  p.budget,
  COUNT(DISTINCT bd.id) as bim_models,
  COUNT(DISTINCT fd.id) as fraud_alerts,
  COUNT(DISTINCT wp.id) as progress_updates
FROM projects p
LEFT JOIN bim_models bd ON p.id = bd.project_id
LEFT JOIN fraud_detections fd ON p.id = fd.project_id
LEFT JOIN project_progress wp ON p.id = wp.project_id
GROUP BY p.id, p.name, p.budget;

CREATE OR REPLACE VIEW fraud_alert_summary AS
SELECT 
  project_id,
  COUNT(*) as total_alerts,
  COUNT(CASE WHEN recommendation = 'BLOCK_PAYMENT' THEN 1 END) as blocked_payments,
  AVG(fraud_score) as avg_fraud_score
FROM fraud_detections
GROUP BY project_id;

-- ==================== FUNCTION ====================

CREATE OR REPLACE FUNCTION calculate_project_variance()
RETURNS TABLE (
  project_id INTEGER,
  variance_percent DECIMAL,
  status VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    ROUND((ABS(bf.materials - COALESCE(SUM(pp.budget_spent), 0)) / bf.materials) * 100, 2) as variance,
    CASE 
      WHEN ABS(bf.materials - COALESCE(SUM(pp.budget_spent), 0)) / bf.materials < 0.05 THEN 'On Budget'
      WHEN ABS(bf.materials - COALESCE(SUM(pp.budget_spent), 0)) / bf.materials < 0.15 THEN 'Minor Variance'
      ELSE 'Major Variance'
    END as status
  FROM projects p
  LEFT JOIN budget_forecast bf ON p.id = bf.project_id
  LEFT JOIN project_progress pp ON p.id = pp.project_id
  GROUP BY p.id, bf.materials;
END;
$$ LANGUAGE plpgsql;

-- ==================== END OF SCHEMA ====================
