#!/usr/bin/env node
// MyStars — local UI for your GitHub stars. Zero dependencies.
// Token: $GITHUB_TOKEN or `gh auth token`.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, 'stars.json');
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '0.0.0.0';

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execSync('gh auth token', { encoding: 'utf8' }).trim(); } catch { return ''; }
}
const TOKEN = token();
if (!TOKEN) console.warn('No GitHub token found (set GITHUB_TOKEN or run `gh auth login`). Rate limits will be low.');

async function gh(url, accept = 'application/vnd.github+json') {
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    headers: { Accept: accept, 'User-Agent': 'mystars', ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }) },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return { data: await res.json(), link: res.headers.get('link') || '' };
}

const slim = (r) => ({
  full_name: r.full_name,
  name: r.name,
  owner: r.owner?.login,
  avatar: r.owner?.avatar_url,
  url: r.html_url,
  homepage: r.homepage || '',
  description: r.description || '',
  topics: r.topics || [],
  language: r.language || '',
  stars: r.stargazers_count,
  updated: r.pushed_at,
  archived: r.archived,
});

async function fetchStars() {
  const out = [];
  let url = '/user/starred?per_page=100';
  while (url) {
    const { data, link } = await gh(url, 'application/vnd.github.star+json');
    for (const s of data) out.push({ ...slim(s.repo), starred_at: s.starred_at });
    url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  const payload = { fetched_at: new Date().toISOString(), repos: out };
  await writeFile(CACHE, JSON.stringify(payload));
  return payload;
}

async function getStars(refresh) {
  if (!refresh) {
    try { return JSON.parse(await readFile(CACHE, 'utf8')); } catch {}
  }
  return fetchStars();
}

const STOP = new Set(('a an and are as at be by for from has have in into is it its of on or that the this to with ' +
  'your you our we using use used based simple easy fast tool tools library framework app apps ' +
  'built build make makes via all any can more new best just like').split(' '));

function keywords(text, max = 4) {
  const seen = new Set();
  return (text.toLowerCase().replace(/open[\s_-]?source/g, ' ').match(/[a-z0-9][a-z0-9+#.-]*/g) || [])
    .map((w) => w.replace(/[.-]+$/, ''))
    .filter((w) => w.length > 2 && !STOP.has(w) && !seen.has(w) && seen.add(w))
    .slice(0, max);
}

const IN = ' in:name,description,topics';
const ghSearch = async (q) =>
  (await gh(`/search/repositories?q=${encodeURIComponent(q + IN)}&sort=stars&order=desc&per_page=20`)).data.items;

// Most-starred GitHub repos similar to the query. Runs the all-words query plus each adjacent word pair
// as an exact phrase ("source separation" finds demucs/spleeter even without the word "audio"), merges,
// and ranks by stars. Falls back to dropping trailing words if too few results.
async function similar(q, exclude) {
  let terms = keywords(q, 4);
  if (!terms.length) return { query: '', phrases: [], items: [] };
  const excluded = new Set(exclude);
  const phrases = terms.length > 2 ? terms.slice(0, -1).map((t, i) => `"${t} ${terms[i + 1]}"`) : [];
  const merged = new Map();
  const add = (list) => list.forEach((r) => !excluded.has(r.full_name) && !merged.has(r.full_name) && merged.set(r.full_name, slim(r)));
  (await Promise.all([terms.join(' '), ...phrases].map((x) => ghSearch(x).catch(() => [])))).forEach(add);
  let used = terms.join(' ');
  while (merged.size < 5 && terms.length > 1) {
    terms = terms.slice(0, -1);
    used = terms.join(' ');
    add(await ghSearch(used));
  }
  const items = [...merged.values()].sort((a, b) => b.stars - a.stars).slice(0, 5);
  return { query: used + IN, phrases, items };
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/stars') return send(res, 200, await getStars(u.searchParams.has('refresh')));
    if (u.pathname === '/api/similar') {
      const stars = await getStars(false);
      return send(res, 200, await similar(u.searchParams.get('q') || '', stars.repos.map((r) => r.full_name)));
    }
    const pub = { '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript; charset=utf-8' };
    const file = path.normalize(path.join(DIR, 'public', u.pathname));
    if (file.startsWith(path.join(DIR, 'public') + path.sep) && pub[path.extname(file)]) {
      try { return send(res, 200, await readFile(file), pub[path.extname(file)]); } catch {}
    }
    if (u.pathname === '/search.js')
      return send(res, 200, await readFile(path.join(DIR, 'search.js')), 'text/javascript; charset=utf-8');
    if (u.pathname === '/' || u.pathname === '/index.html')
      return send(res, 200, await readFile(path.join(DIR, 'index.html')), 'text/html; charset=utf-8');
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, () => console.log(`MyStars → http://${HOST}:${PORT}`));
