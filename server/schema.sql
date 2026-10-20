CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) <= 200),
  name_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_contracts (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  tenant TEXT NOT NULL CHECK (length(tenant) <= 200),
  payment_status TEXT NOT NULL DEFAULT '',
  rental_invoice_scheme TEXT NOT NULL DEFAULT 'LUNAS',
  separate_utility_invoices BOOLEAN NOT NULL DEFAULT TRUE,
  start_date DATE,
  end_date DATE,
  contract_value NUMERIC(16, 2),
  billing_period TEXT NOT NULL DEFAULT '',
  installment_interval_months INTEGER,
  initial_payment_amount NUMERIC(16, 2),
  partial_balance_due_date DATE,
  partial_payment_schedule TEXT NOT NULL DEFAULT '',
  installment_payments JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_payment_date DATE,
  electricity_cost_rp NUMERIC(16, 2),
  electricity_kwh NUMERIC(16, 3),
  phone_cost_rp NUMERIC(16, 2),
  pic TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_contracts
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE tenant_contracts
  ADD COLUMN IF NOT EXISTS rental_invoice_scheme TEXT NOT NULL DEFAULT 'LUNAS',
  ADD COLUMN IF NOT EXISTS separate_utility_invoices BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS partial_balance_due_date DATE;

ALTER TABLE tenant_contracts
  ALTER COLUMN rental_invoice_scheme SET DEFAULT 'LUNAS';
ALTER TABLE tenant_contracts
  DROP CONSTRAINT IF EXISTS tenant_contracts_rental_invoice_scheme_check;
UPDATE tenant_contracts
SET rental_invoice_scheme = CASE
  WHEN payment_status = 'Partial Paid' THEN 'PARTIAL'
  WHEN payment_status = 'Termin' THEN 'TERMIN'
  WHEN payment_status = 'Lunas' THEN 'LUNAS'
  WHEN rental_invoice_scheme = 'UPFRONT' THEN 'LUNAS'
  ELSE 'TERMIN'
END
WHERE rental_invoice_scheme NOT IN ('LUNAS', 'TERMIN', 'PARTIAL');

ALTER TABLE tenant_contracts
  ADD CONSTRAINT tenant_contracts_rental_invoice_scheme_check
    CHECK (rental_invoice_scheme IN ('LUNAS', 'TERMIN', 'PARTIAL'));

INSERT INTO tenants (id, name, name_key)
SELECT gen_random_uuid(), canonical.tenant, canonical.name_key
FROM (
  SELECT DISTINCT ON (lower(trim(tenant)))
    trim(tenant) AS tenant,
    lower(trim(tenant)) AS name_key
  FROM tenant_contracts
  WHERE length(trim(tenant)) > 0
  ORDER BY lower(trim(tenant)), id
) AS canonical
ON CONFLICT (name_key) DO NOTHING;

UPDATE tenant_contracts AS contract
SET tenant_id = tenant.id
FROM tenants AS tenant
WHERE contract.tenant_id IS NULL
  AND tenant.name_key = lower(trim(contract.tenant));

CREATE TABLE IF NOT EXISTS client_users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx
  ON app_sessions (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS client_users_username_lower_idx
  ON client_users (lower(username));

CREATE TABLE IF NOT EXISTS utility_payments (
  id UUID PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES tenant_contracts(id) ON DELETE CASCADE,
  utility_type TEXT NOT NULL CHECK (utility_type IN ('LISTRIK', 'TELEPON')),
  billing_month DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(16, 2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'BELUM_BAYAR'
    CHECK (status IN ('LUNAS', 'BELUM_BAYAR')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, utility_type, billing_month)
);

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;

CREATE TABLE IF NOT EXISTS tenant_invoices (
  id UUID PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES tenant_contracts(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'SEWA'
    CHECK (category IN ('SEWA', 'UTILITAS')),
  invoice_label TEXT NOT NULL DEFAULT '',
  billing_month DATE NOT NULL,
  billing_date DATE NOT NULL,
  due_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  rent_amount NUMERIC(16, 2) NOT NULL CHECK (rent_amount >= 0),
  electricity_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (electricity_amount >= 0),
  telephone_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (telephone_amount >= 0),
  status TEXT NOT NULL DEFAULT 'BELUM_DIBAYAR'
    CHECK (status IN ('LUNAS', 'BELUM_DIBAYAR', 'SEBAGIAN')),
  paid_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

ALTER TABLE tenant_invoices
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'SEWA',
  ADD COLUMN IF NOT EXISTS invoice_label TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(16, 2) NOT NULL DEFAULT 0;
UPDATE tenant_invoices
SET period_start = COALESCE(period_start, billing_month),
    period_end = COALESCE(period_end, billing_month),
    paid_amount = CASE
      WHEN status = 'LUNAS' AND paid_amount = 0
        THEN rent_amount + electricity_amount + telephone_amount
      ELSE paid_amount
    END;
ALTER TABLE tenant_invoices
  ALTER COLUMN period_start SET NOT NULL,
  ALTER COLUMN period_end SET NOT NULL;
ALTER TABLE tenant_invoices
  DROP CONSTRAINT IF EXISTS tenant_invoices_category_check;
ALTER TABLE tenant_invoices
  ADD CONSTRAINT tenant_invoices_category_check
    CHECK (category IN ('SEWA', 'UTILITAS'));
ALTER TABLE tenant_invoices
  DROP CONSTRAINT IF EXISTS tenant_invoices_status_check;
ALTER TABLE tenant_invoices
  ADD CONSTRAINT tenant_invoices_status_check
    CHECK (status IN ('LUNAS', 'BELUM_DIBAYAR', 'SEBAGIAN'));
ALTER TABLE tenant_invoices
  DROP CONSTRAINT IF EXISTS tenant_invoices_paid_amount_check;
ALTER TABLE tenant_invoices
  ADD CONSTRAINT tenant_invoices_paid_amount_check
    CHECK (paid_amount >= 0 AND paid_amount <= rent_amount + electricity_amount + telephone_amount);
ALTER TABLE tenant_invoices
  DROP CONSTRAINT IF EXISTS tenant_invoices_contract_id_billing_month_key;
DROP INDEX IF EXISTS tenant_invoices_contract_month_category_idx;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_invoices_contract_month_category_idx
  ON tenant_invoices (contract_id, billing_month, category, invoice_label);

CREATE TABLE IF NOT EXISTS contract_rooms (
  building TEXT NOT NULL,
  floor TEXT NOT NULL,
  room_id TEXT NOT NULL,
  contract_id UUID NOT NULL REFERENCES tenant_contracts(id) ON DELETE CASCADE,
  occupancy_status TEXT NOT NULL DEFAULT 'occupied'
    CHECK (occupancy_status IN ('occupied', 'vacant', 'in_progress')),
  area_m2 NUMERIC(12, 3),
  PRIMARY KEY (building, floor, room_id)
);

CREATE INDEX IF NOT EXISTS tenant_contracts_payment_status_idx
  ON tenant_contracts (payment_status);
CREATE INDEX IF NOT EXISTS tenant_contracts_tenant_idx
  ON tenant_contracts (tenant);
CREATE INDEX IF NOT EXISTS tenant_contracts_end_date_idx
  ON tenant_contracts (end_date);
CREATE INDEX IF NOT EXISTS tenant_contracts_electricity_kwh_idx
  ON tenant_contracts (electricity_kwh);
CREATE INDEX IF NOT EXISTS contract_rooms_contract_id_idx
  ON contract_rooms (contract_id);
CREATE INDEX IF NOT EXISTS utility_payments_contract_month_idx
  ON utility_payments (contract_id, billing_month);
CREATE INDEX IF NOT EXISTS tenant_invoices_tenant_month_idx
  ON tenant_invoices (tenant_id, billing_month);

INSERT INTO utility_payments (
  id, contract_id, utility_type, billing_month, due_date, amount
)
SELECT
  gen_random_uuid(),
  contract.id,
  utility.type,
  period.billing_month::date,
  (period.billing_month + INTERVAL '1 month')::date + 4,
  utility.amount
FROM tenant_contracts AS contract
CROSS JOIN LATERAL generate_series(
  0,
  (EXTRACT(YEAR FROM contract.end_date)::integer -
   EXTRACT(YEAR FROM contract.start_date)::integer) * 12 +
   EXTRACT(MONTH FROM contract.end_date)::integer -
   EXTRACT(MONTH FROM contract.start_date)::integer - 1
) AS period_index(month_count)
CROSS JOIN LATERAL (
  SELECT (
    date_trunc('month', contract.start_date) +
    make_interval(months => period_index.month_count)
  )::date AS billing_month
) AS period
CROSS JOIN LATERAL (
  VALUES
    ('LISTRIK', contract.electricity_cost_rp),
    ('TELEPON', contract.phone_cost_rp)
) AS utility(type, amount)
WHERE contract.start_date IS NOT NULL
  AND contract.end_date IS NOT NULL
  AND contract.end_date >= contract.start_date
  AND utility.amount IS NOT NULL
ON CONFLICT (contract_id, utility_type, billing_month) DO NOTHING;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_rooms ENABLE ROW LEVEL SECURITY;
