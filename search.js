// Ranked search over starred repos. Works in the browser (window.StarSearch) and Node (module.exports).
// Scoring: IDF-weighted terms (rare words count more), field weights (name > topics > description),
// stem/prefix + synonym matching, phrase bonus, and a coverage penalty for repos missing important words.
(function (root) {
  const STOP = new Set(('a an and are as at be by for from has have i in into is it its of on or that the this to ' +
    'with your you our we me my can will just some any all').split(' '));

  // Synonym groups — any word in a group also finds the others (at reduced weight). Extend freely.
  const GROUPS = [
    ['separation', 'separate', 'separator', 'stems', 'demix', 'demixing', 'unmix', 'isolate', 'isolation', 'splitter', 'vocal-remover', 'karaoke'],
    ['audio', 'sound', 'acoustic'],
    ['music', 'musical', 'song', 'songs'],
    ['speech', 'voice', 'tts', 'text-to-speech'],
    ['transcription', 'transcribe', 'speech-to-text', 'stt', 'asr', 'whisper'],
    ['demo', 'showcase', 'walkthrough', 'screencast', 'explainer', 'launch-video'],
    ['video', 'film', 'movie', 'clip'],
    ['llm', 'gpt', 'language-model', 'openai', 'claude', 'gemini'],
    ['notation', 'sheet-music', 'score', 'musicxml', 'engraving'],
    ['synth', 'synthesizer', 'synthesis'],
    ['cms', 'content-management', 'headless-cms'],
    ['self-hosted', 'selfhosted', 'homelab'],
    ['chart', 'graph', 'plot', 'visualization', 'dataviz'],
    ['scraper', 'scraping', 'crawler', 'crawl'],
    ['auth', 'authentication', 'login', 'oauth', 'sso'],
    ['database', 'db', 'postgres', 'postgresql', 'sqlite', 'sql'],
    ['image', 'photo', 'picture'],
    ['pdf', 'document', 'documents'],
    ['diagram', 'flowchart', 'whiteboard'],
    ['design', 'figma', 'mockup', 'prototype'],
  ];
  const SYN = new Map();
  for (const g of GROUPS) {
    const words = g.flatMap((w) => w.split('-').length > 1 ? [w.replace(/-/g, '')] : [w]);
    for (const w of words) SYN.set(w, words.filter((x) => x !== w));
  }

  const SUFFIXES = ['ations', 'ation', 'ators', 'ator', 'ions', 'ion', 'ings', 'ing', 'ers', 'er', 'ies', 'es', 'ed', 'ly', 's', 'e'];
  function stem(w) {
    for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
    return w;
  }

  // Normalise: "open source" is boilerplate — collapse it so "source" doesn't match it.
  const norm = (s) => String(s || '').toLowerCase().replace(/open[\s_-]?source/g, 'opensource');
  const words = (s) => norm(s).replace(/([a-z])([A-Z])/g, '$1 $2').match(/[a-z0-9+#]+/g) || [];
  const splitCamel = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  // How well a single token matches a query word: 1 exact, 0.8 stem/prefix, 0.
  function tokenMatch(tok, q, qs) {
    if (tok === q) return 1;
    if (stem(tok) === qs) return 0.85;
    if (q.length >= 4 && tok.startsWith(q)) return 0.8;
    if (qs.length >= 5 && tok.startsWith(qs)) return 0.75;
    return 0;
  }

  const FIELDS = [['name', 3], ['topics', 2.5], ['desc', 1.5], ['meta', 1]];

  function indexRepo(r) {
    r._f = {
      name: words(splitCamel(r.name).replace(/[-_.]/g, ' ')),
      topics: words(r.topics.join(' ')).concat(r.topics.map((t) => norm(t).replace(/-/g, ''))),
      desc: words(r.description),
      meta: words(`${r.owner} ${r.language} ${r.homepage}`),
    };
  }

  // Each query word becomes a "concept": the word itself + synonyms.
  function parse(q) {
    const raw = words(q).filter((w) => !STOP.has(w));
    const uniq = [...new Set(raw)];
    return uniq.map((w) => {
      const syn = new Set(SYN.get(w) || SYN.get(stem(w)) || []);
      for (const [k, v] of SYN) if (stem(k) === stem(w) && k !== w) v.forEach((x) => x !== w && syn.add(x)), syn.add(k);
      syn.delete(w);
      return { w, s: stem(w), syn: [...syn].map((x) => ({ w: x, s: stem(x) })) };
    });
  }

  // Best match of a concept in a field → strength 0..1
  function conceptInTokens(c, toks) {
    let best = 0;
    for (const t of toks) {
      best = Math.max(best, tokenMatch(t, c.w, c.s));
      if (best === 1) return 1;
      for (const y of c.syn) best = Math.max(best, 0.5 * tokenMatch(t, y.w, y.s));
    }
    return best;
  }

  function phraseBonus(concepts, toks) {
    let n = 0;
    for (let i = 0; i < concepts.length - 1; i++) {
      for (let j = 0; j < toks.length - 1; j++) {
        if (tokenMatch(toks[j], concepts[i].w, concepts[i].s) && tokenMatch(toks[j + 1], concepts[i + 1].w, concepts[i + 1].s)) { n++; break; }
      }
    }
    return n;
  }

  function search(repos, q) {
    const concepts = parse(q);
    if (!concepts.length) return { concepts, strong: repos.slice(), weak: [] };
    const N = repos.length;
    const rows = repos.map((r) => {
      const per = concepts.map((c) => {
        let best = 0;
        for (const [f, w] of FIELDS) { const m = conceptInTokens(c, r._f[f]); if (m) best = Math.max(best, m * w); }
        return best; // field weight × strength
      });
      return { r, per };
    });
    const idf = concepts.map((_, i) => {
      const df = rows.filter((x) => x.per[i] > 0).length;
      return Math.log(1 + (N - df + 0.5) / (df + 0.5));
    });
    const totalIdf = idf.reduce((a, b) => a + b, 0);
    const scored = [];
    for (const { r, per } of rows) {
      if (!per.some(Boolean)) continue;
      let s = 0, cov = 0, all = true;
      per.forEach((p, i) => { s += idf[i] * p; cov += idf[i] * Math.min(1, p / 1.5); if (!p) all = false; });
      cov /= totalIdf;
      const phrase = phraseBonus(concepts, r._f.desc) + phraseBonus(concepts, r._f.name);
      s = (s + phrase * 2) * (0.25 + 0.75 * cov * cov) + Math.log10(1 + r.stars) * 0.05;
      scored.push({ r, s, cov, all });
    }
    scored.sort((a, b) => b.s - a.s);
    const strongCut = concepts.length === 1 ? 0 : 0.6;
    return {
      concepts,
      strong: scored.filter((x) => x.all || x.cov >= strongCut).map((x) => x.r),
      weak: scored.filter((x) => !(x.all || x.cov >= strongCut)).map((x) => x.r),
    };
  }

  // Wrap matching words in <mark>. `esc` escapes HTML.
  function highlight(text, concepts, esc) {
    if (!concepts.length) return esc(text);
    return String(text).split(/([A-Za-z0-9+#]+)/).map((part, i) => {
      if (!(i % 2)) return esc(part);
      const t = norm(part);
      const hit = concepts.some((c) => tokenMatch(t, c.w, c.s) || c.syn.some((y) => tokenMatch(t, y.w, y.s)));
      return hit ? `<mark>${esc(part)}</mark>` : esc(part);
    }).join('');
  }

  const api = { indexRepo, search, highlight, parse };
  if (typeof module !== 'undefined') module.exports = api; else root.StarSearch = api;
})(this);
