/**
 * core/api.js — 网络请求拦截器 + Auth Token 管理
 * 零UI依赖，纯数据层
 */

const AUTH_KEY = 'kedazi_token';

export function getToken() { return localStorage.getItem(AUTH_KEY); }
export function saveToken(token) { localStorage.setItem(AUTH_KEY, token); }
export function clearToken() { localStorage.removeItem(AUTH_KEY); }
export function isLoggedIn() { return !!getToken(); }

async function readResponse(res) {
  if (res.status === 401) {
    clearToken();
    window._currentUser = null;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text || {}; }
}

async function request(url, { method, body, json = false } = {}) {
  const token = getToken();
  const headers = json ? { 'Content-Type': 'application/json' } : {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: json ? JSON.stringify(body) : body });
  return readResponse(res);
}

export function apiGet(url) {
  return request(url);
}

export function apiPost(url, body) {
  return request(url, { method: 'POST', body, json: true });
}

export function apiPut(url, body) {
  return request(url, { method: 'PUT', body, json: true });
}

export async function apiPostFile(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  return request(url, { method: 'POST', body: fd });
}

export function apiDelete(url) {
  return request(url, { method: 'DELETE' });
}
