const BACKEND_API = 'http://localhost:3001';

export async function fetchPoolData() {
  const resp = await fetch(`${BACKEND_API}/api/pool/data`);
  if (!resp.ok) {
    throw new Error('Failed to fetch pool data');
  }
  const json = await resp.json();
  if (!json.success) {
    return json; // some backends respond with data directly
  }
  return json.data || json;
}


