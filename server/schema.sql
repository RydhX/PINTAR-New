CREATE TABLE IF NOT EXISTS tenant_contracts (
  id UUID PRIMARY KEY,
  tenant TEXT NOT NULL CHECK (length(tenant) <= 200),
  payment_status TEXT NOT NULL DEFAULT '',
  start_date DATE,
  end_date DATE,
  contract_value NUMERIC(16, 2),
  billing_period TEXT NOT NULL DEFAULT '',
  installment_interval_months INTEGER,
  initial_payment_amount NUMERIC(16, 2),
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
