# QR-PP

Temporary QR table ordering system for an authorized Petpooja-connected restaurant.

## MVP
- Windows staff workflow: select table, generate/print temporary QR, close session.
- Customer mobile web menu: scan QR, view menu, cart, submit order.
- Backend: opaque random QR tokens, hashed at rest, table binding, expiry and immediate invalidation on close.
- Petpooja connector boundary with a mock implementation for development.

The repository never stores credentials or extracted APK secrets. The real Petpooja contract must be supplied through an authorized merchant integration.
