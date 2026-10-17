# QR-PP

Temporary table QR ordering for an authorized Petpooja-connected restaurant.

## Customer flow

1. Customer sits at a table.
2. Staff selects that table in the staff dashboard.
3. Staff generates a temporary QR and prints it.
4. Customer scans the QR; the backend opens the mobile ordering page.
5. The token is bound to exactly one table session.
6. Customer sees the restaurant menu and places an order.
7. The backend relays the order through the configured Petpooja Online Ordering integration.
8. Petpooja/POSS handles the restaurant-side order and KOT flow.
9. Staff closes the table session after billing; the printed QR immediately stops working.
10. The next customer receives a new token and a new session.

## Repository

- `backend/` — Node.js/TypeScript API, QR sessions, persistence and Petpooja adapter.
- `staff-app/` — staff table dashboard and QR printing UI.
- `customer-web/` — mobile customer ordering page.

## Petpooja integration

The backend has a real Petpooja adapter boundary. It supports the documented menu and `save_order` integration endpoints and keeps the restaurant credentials in environment variables rather than Git.

Set these in `backend/.env` using the credentials issued for your restaurant/integration:

```text
PETPOOJA_MODE=live
PETPOOJA_APP_KEY=
PETPOOJA_APP_SECRET=
PETPOOJA_ACCESS_TOKEN=
PETPOOJA_REST_ID=
PETPOOJA_SAVE_ORDER_URL=https://47pfzh5sf2.execute-api.ap-southeast-1.amazonaws.com/V1/save_order
PETPOOJA_MENU_URL=https://qle1yy2ydc.execute-api.ap-southeast-1.amazonaws.com/V1/mapped_restaurant_menus
PETPOOJA_CALLBACK_URL=https://YOUR-DOMAIN/api/petpooja/callback
```

Do **not** put real credentials into GitHub. The existing APK may help identify integration behavior, but production credentials must come from the restaurant's authorized Petpooja integration.

## Local test

```bash
cd backend
npm install
cp .env.example .env
# Keep PETPOOJA_MODE=mock for local testing
npm run dev
```

For live service, deploy the backend behind HTTPS and set `PUBLIC_BASE_URL` to the public origin. The QR opens `/order/<temporary-token>`.

## Important production validation

The exact Petpooja order-item/modifier/table fields can vary with the enabled merchant integration. Before service, confirm the mapped restaurant contract with Petpooja and run one real test order. The adapter is isolated in `backend/src/petpooja.ts`, so those mapping details can be changed without rewriting the QR/session system.
