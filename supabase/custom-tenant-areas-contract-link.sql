ALTER TABLE custom_tenant_areas
  ADD COLUMN IF NOT EXISTS room_id TEXT,
  ADD COLUMN IF NOT EXISTS contract_id UUID
    REFERENCES tenant_contracts(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS custom_tenant_areas_room_idx
  ON custom_tenant_areas (building_id, floor_id, room_id)
  WHERE room_id IS NOT NULL;
