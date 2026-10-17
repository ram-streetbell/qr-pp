import 'dotenv/config';

export type PetpoojaItem = {
  menuItemId: string;
  quantity: number;
  name: string;
  unitPrice: number;
};

export type PetpoojaConfig = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  restId: string;
  saveOrderUrl: string;
  menuUrl: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function petpoojaConfig(): PetpoojaConfig {
  return {
    appKey: required('PETPOOJA_APP_KEY'),
    appSecret: required('PETPOOJA_APP_SECRET'),
    accessToken: required('PETPOOJA_ACCESS_TOKEN'),
    restId: required('PETPOOJA_REST_ID'),
    saveOrderUrl: process.env.PETPOOJA_SAVE_ORDER_URL || 'https://47pfzh5sf2.execute-api.ap-southeast-1.amazonaws.com/V1/save_order',
    menuUrl: process.env.PETPOOJA_MENU_URL || 'https://qle1yy2ydc.execute-api.ap-southeast-1.amazonaws.com/V1/mapped_restaurant_menus'
  };
}

export async function fetchPetpoojaMenu() {
  const cfg = petpoojaConfig();
  const response = await fetch(cfg.menuUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restID: cfg.restId, app_key: cfg.appKey, app_secret: cfg.appSecret, access_token: cfg.accessToken })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Petpooja menu request failed (${response.status}): ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error('Petpooja returned a non-JSON menu response'); }
}

export async function submitPetpoojaOrder(input: {
  clientOrderId: string;
  tableNumber: string;
  items: PetpoojaItem[];
  total: number;
  callbackUrl?: string;
}) {
  const cfg = petpoojaConfig();
  const orderItems = input.items.map((item) => ({
    id: item.menuItemId,
    title: item.name,
    quantity: String(item.quantity),
    price: item.unitPrice,
    total: item.unitPrice * item.quantity
  }));

  const payload: Record<string, unknown> = {
    app_key: cfg.appKey,
    app_secret: cfg.appSecret,
    access_token: cfg.accessToken,
    restID: cfg.restId,
    orderID: input.clientOrderId,
    device_type: 'Web',
    udid: input.clientOrderId,
    order_type: 'Dine-In',
    table_no: input.tableNumber,
    OrderInfo: {
      orderID: input.clientOrderId,
      order_items: orderItems,
      subtotal: input.total,
      total: input.total,
      payment_type: 'COD'
    }
  };

  if (input.callbackUrl) payload.callback_url = input.callbackUrl;

  const response = await fetch(cfg.saveOrderUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Petpooja order request failed (${response.status}): ${text.slice(0, 800)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
