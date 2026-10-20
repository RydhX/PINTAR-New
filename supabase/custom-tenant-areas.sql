CREATE TABLE IF NOT EXISTS custom_tenant_areas (
  id UUID PRIMARY KEY,
  building_id TEXT NOT NULL DEFAULT 'GKP' CHECK (building_id = 'GKP'),
  floor_id TEXT NOT NULL CHECK (floor_id = 'Lantai 11'),
  geometry JSONB NOT NULL CHECK (geometry->>'type' = 'Polygon'),
  coordinate_system TEXT NOT NULL DEFAULT 'GKP_L11_SVG_VIEWBOX_6000x3500',
  area_sqm NUMERIC(14, 2) NOT NULL CHECK (area_sqm > 0),
  tenant_name TEXT NOT NULL CHECK (length(tenant_name) BETWEEN 1 AND 200),
  usage_type TEXT NOT NULL CHECK (length(usage_type) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('DISEWA', 'TERSEDIA', 'NEGOSIASI')),
  rent_price NUMERIC(16, 2) NOT NULL CHECK (rent_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE custom_tenant_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_direct_client_access ON custom_tenant_areas;
CREATE POLICY deny_direct_client_access ON custom_tenant_areas
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
