# Google Sheets prototype write integration

## Apps Script deployment

1. Open the Apps Script project used by the URL in `data/sheets.js`.
2. Replace its contents with `Code.gs`.
3. Set `CONFIG.SPREADSHEET_ID` and `CONFIG.SPREADSHEET_NAME`; check each `BUILDINGS` tab name and building code against the master spreadsheet.
4. Keep a `floor`, `room_id`, `tenant`, `occupancy_status`, and `payment_status` header on each master tab. Optional fields can be omitted until needed. Header aliases are listed in `FIELD_ALIASES` in `Code.gs`.
5. If `payment_status` uses a dropdown validation, add `Termin` to its allowed values.
6. Deploy > Manage deployments > Edit the existing Web app deployment, select **New version**, and deploy. Preserve the existing `/exec` URL where possible.
7. Because this prototype has no login, the web app must be accessible to **Anyone** for the GitHub Pages form to reach it. The script runs with the deploying account's spreadsheet permissions.

The frontend submits a `text/plain` POST to avoid a cross-origin preflight, then reads the JSONP snapshot again and only reports success when the update is visible. Apps Script `ContentService` does not provide a readable cross-origin POST response to this static frontend.

## Scope and safety

The handler updates an existing row matching the building tab, floor, and room ID, or appends a row if that mapped unit has no record yet. It rejects duplicate matches and serializes writes with a script lock. This allows an initially vacant unit such as `L2_SH01` to be entered from the website and then appear in the master tab. The detail editor's **Kosongkan data tenant** action clears tenant, payment, contract, and other editable details, and sets occupancy to `kosong`; it preserves the entire row and its building/floor/room ID identity. The frontend verifies the result against the next Sheets snapshot.

For installment payments, choose **Termin** in the payment-status editor, enter the contract amount, then add as many numbered term amounts as needed. On first use, the script creates `nilai_kontrak`, `kekurangan_pembayaran`, and columns named `termin_1`, `termin_2`, and so on as needed. It updates/clears those cells with the unit row. The Apps Script endpoint calculates the remaining balance as contract value minus the sum of entered terms and saves it in `kekurangan_pembayaran`; it rejects a total that exceeds the contract amount.

Date fields use the browser's native calendar picker and are written as date cells with `yyyy-mm-dd` formatting. Rent and outstanding balance are grouped with Indonesian thousands separators while typing; the frontend sends numeric values to Apps Script.

`PUBLIC_WRITE_APPROVED` is enabled in the prototype template. With no authentication, anyone who opens the website can change, add, or clear unit details in the master spreadsheet. The editor warning is informational, not access control. Restrict or disable the deployment and set `PUBLIC_WRITE_APPROVED` to `false` before operational use. Do not publish personal, payment, or contract data without approval.

## Local verification

1. Run the page using Live Server or another local HTTP server.
2. Select a mapped unit and use **Ubah data unit** in its right-side detail panel.
3. Save a non-critical existing row, then confirm its values in the corresponding master tab and the refreshed PINTAR view.
4. Save data for a mapped unit with no existing row (for example `L2_SH01`); verify exactly one row is appended and the unit appears updated on the website.
5. Try a row with an optional value whose column is absent; the endpoint should reject the write instead of silently dropping a non-empty value.
6. Confirm that a duplicate room identity is rejected and no second row is appended.
7. To test clearing data, use a disposable row: confirm the prompt, verify that all tenant details are cleared, and confirm building, floor, and room ID remain in the same row with occupancy set to `kosong`.

The editor is shown only for mapped SVG units. Records for other floors/buildings remain outside the current map UI until those maps are configured.
