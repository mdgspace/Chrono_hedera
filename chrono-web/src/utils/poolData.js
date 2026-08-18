import { getMockPoolData } from './mockData';

const BACKEND_API = 'http://localhost:3001';

export async function fetchPoolData() {
  try {
    const resp = await fetch(`${BACKEND_API}/api/v1/pool/data`);
    if (!resp.ok) {
      throw new Error('Failed to fetch pool data');
    }
    const json = await resp.json();
    if (!json.success) {
      return json; // some backends respond with data directly
    }
    return json.data || json;
  } catch (error) {
    console.warn('Backend not available:', error.message);
    return [];
  }
}


