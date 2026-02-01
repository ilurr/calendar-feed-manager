const icalGenerator = require('ical-generator');
const ical = typeof icalGenerator === 'function' ? icalGenerator : icalGenerator.default;
const { toHijri, toGregorian } = require('hijri-converter');
const cheerio = require('cheerio');

const registry = require('./feeds-registry.json');

const HIJRI_MONTH_NAMES = [
  'Muharam', 'Safar', 'Rabiulawal', 'Rabiulakhir', 'Jumadilawal', 'Jumadilakhir',
  'Rajab', 'Syakban', 'Ramadan', 'Syawal', 'Zulkaidah', 'Zulhijah'
];

/**
 * Proxy an external .ics URL: fetch and return as-is.
 */
async function fetchUrlIcs(source) {
  const url = source?.url;
  if (!url || typeof url !== 'string') return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Calendar-Sync/1.0' } });
    if (!res.ok) return null;
    return await res.text();
  } catch (_) {
    return null;
  }
}

/**
 * Ayyamul Bidh: fasting on 13th, 14th, 15th of each Islamic month.
 * Uses Umm al-Qura conversion (hijri-converter). Reference: KHGT https://khgt.muhammadiyah.or.id/kalendar-hijriah
 */
function getAyyamulBidhEvents() {
  const today = new Date();
  const gy = today.getFullYear();
  const gm = today.getMonth() + 1;
  const gd = today.getDate();
  const hijriToday = toHijri(gy, gm, gd);
  const startHy = hijriToday.hy;
  const events = [];
  const seen = new Set();

  for (let hy = startHy; hy <= startHy + 2; hy++) {
    for (let hm = 1; hm <= 12; hm++) {
      for (const hd of [13, 14, 15]) {
        try {
          const g = toGregorian(hy, hm, hd);
          const key = `${g.gy}-${g.gm}-${g.gd}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const start = new Date(g.gy, g.gm - 1, g.gd, 0, 0, 0);
          const end = new Date(g.gy, g.gm - 1, g.gd + 1, 0, 0, 0);
          const monthName = HIJRI_MONTH_NAMES[hm - 1] || `Month ${hm}`;
          events.push({
            start,
            end,
            allDay: true,
            summary: `Ayyamul Bidh (${monthName} ${hd})`,
            description: `Ayyamul Bidh fasting – ${monthName} ${hd}, ${hy} H. Reference: KHGT Muhammadiyah.`,
            location: '',
          });
        } catch (_) {
          // skip invalid date
        }
      }
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 1);
  return events.filter((ev) => ev.start >= cutoff);
}

const TRACE_SCRAPE = process.env.TRACE_SCRAPE === '1' || process.env.NODE_ENV !== 'production';

function trace(...args) {
  if (TRACE_SCRAPE) console.log('[cal scrape]', ...args);
}

/** Browser-like headers for sites that block simple crawlers (e.g. Transfermarkt/Cloudflare). */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Fetch HTML from a URL for crawling.
 * @param {string} url
 * @param {{ browserLike?: boolean, referer?: string }} [opts] - browser-like headers, optional referer
 */
async function fetchHtml(url, opts = {}) {
  if (!url || typeof url !== 'string') return null;
  trace('fetchHtml', url);
  try {
    const baseHeaders = opts.browserLike ? { ...BROWSER_HEADERS } : {
      'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0; +https://github.com/calendar-ios-sync)',
      'Accept': 'text/html,application/xhtml+xml',
    };
    if (opts.referer) baseHeaders['Referer'] = opts.referer;
    const res = await fetch(url, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      trace('fetchHtml fail', res.status, res.statusText);
      return null;
    }
    const html = await res.text();
    trace('fetchHtml ok', html?.length, 'bytes');
    return html;
  } catch (err) {
    trace('fetchHtml error', err?.message || err, err?.cause ? String(err.cause) : '');
    return null;
  }
}

/**
 * Parse JSON-LD Event or SportsEvent from page script tags.
 */
function parseJsonLdEvents(html, clubName) {
  const events = [];
  const ldJson = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!ldJson) {
    trace('parseJsonLdEvents', 'no ld+json blocks');
    return events;
  }
  trace('parseJsonLdEvents', ldJson.length, 'ld+json block(s)');
  for (const block of ldJson) {
    const match = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) continue;
    try {
      let data = JSON.parse(match[1].trim());
      if (!Array.isArray(data)) data = [data];
      for (const item of data) {
        const type = item['@type'];
        if (type !== 'Event' && type !== 'SportsEvent') continue;
        const startStr = item.startDate || item.datePublished;
        const endStr = item.endDate || startStr;
        const name = item.name || item.description || 'Match';
        const loc = (item.location && (item.location.name || item.location.address)) || '';
        if (!startStr) continue;
        const start = new Date(startStr);
        const end = endStr ? new Date(endStr) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
        if (isNaN(start.getTime())) continue;
        events.push({
          start,
          end,
          allDay: false,
          summary: name,
          description: clubName ? `${clubName} – ${name}` : name,
          location: typeof loc === 'string' ? loc : '',
        });
      }
    } catch (e) {
      if (TRACE_SCRAPE) trace('parseJsonLdEvents JSON error', e?.message);
    }
  }
  trace('parseJsonLdEvents', 'found', events.length, 'event(s)');
  return events;
}

/**
 * Parse Transfermarkt-style fixture table (Datum, Uhrzeit, Heimmannschaft, Gastmannschaft).
 * Also tries generic tables with date + two team-like cells.
 */
function parseTableFixtures(html, clubName) {
  const events = [];
  const $ = cheerio.load(html);
  const dateRe = /(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/;
  const timeRe = /(\d{1,2}):(\d{2})/;

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return;
    let dateStr = '';
    let timeStr = '';
    let home = '';
    let away = '';
    cells.each((i, el) => {
      const text = $(el).text().trim();
      if (dateRe.test(text) && !timeRe.test(text)) dateStr = text;
      else if (timeRe.test(text)) timeStr = text;
      else if (text.length > 2 && text.length < 50 && !/^\d+$/.test(text)) {
        if (!home) home = text;
        else if (!away) away = text;
      }
    });
    if (!dateStr || !home || !away) return;
    const dateMatch = dateStr.match(dateRe);
    if (!dateMatch) return;
    const [, d, m, y] = dateMatch;
    const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    const month = parseInt(m, 10) - 1;
    const day = parseInt(d, 10);
    let hour = 15;
    let min = 0;
    if (timeStr) {
      const tMatch = timeStr.match(timeRe);
      if (tMatch) {
        hour = parseInt(tMatch[1], 10);
        min = parseInt(tMatch[2], 10);
      }
    }
    const start = new Date(year, month, day, hour, min, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const summary = `${home} – ${away}`;
    events.push({
      start,
      end,
      allDay: false,
      summary,
      description: clubName ? `${clubName} – ${summary}` : summary,
      location: '',
    });
  });

  trace('parseTableFixtures', 'found', events.length, 'event(s)');
  return events;
}

const ID_MONTHS = {
  Januari: 1, Februari: 2, Maret: 3, April: 4, Mei: 5, Juni: 6,
  Juli: 7, Agustus: 8, September: 9, Oktober: 10, November: 11, Desember: 12
};

/** Transfermarkt uses abbreviated months: Agt, Sep, Okt, Nov, Des, Jan, Feb, Mar, Apr, Mei, Jun, Jul */
const ID_MONTH_ABBREV = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, Mei: 5, Jun: 6, Jul: 7,
  Agt: 8, Sep: 9, Okt: 10, Nov: 11, Des: 12
};

/** WIB = Western Indonesian Time, UTC+7. Create Date from local Indonesian time (e.g. Transfermarkt, Liga Indonesia). */
function wibToDate(year, monthIndex, day, hour, min) {
  const m = monthIndex + 1;
  const h = hour ?? 19;
  const mn = min ?? 0;
  const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}:00+07:00`;
  return new Date(dateStr);
}

/** Normalize for comparison: uppercase, single spaces. */
function normTeam(s) {
  return (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** From a snippet containing a match line, return the opponent team name when clubName is one of the two teams. */
function getOpponentFromSnippet(snippet, clubName) {
  if (!snippet || !clubName) return null;
  const clubNorm = normTeam(clubName);
  const snippetPreview = snippet.length > 120 ? snippet.slice(0, 120) + '...' : snippet;
  trace('getOpponentFromSnippet', 'snippet', snippetPreview);
  trace('getOpponentFromSnippet', 'clubName', clubName, 'clubNorm', clubNorm);

  // Site uses pipes: **TEAM1**|FT0:1|**TEAM2** or **TEAM1**|19:00|**TEAM2**
  const m = snippet.match(/\*\*([^*]+)\*\*[\s|]*(?:FT\s*\d+\s*:\s*\d+|\d{1,2}\s*:\s*\d{2}|:)[\s|]*\*\*([^*]+)\*\*/);
  if (m) {
    const t1 = m[1].trim();
    const t2 = m[2].trim();
    trace('getOpponentFromSnippet', '** match', { t1, t2 });
    if (normTeam(t1) === clubNorm || normTeam(t1).includes(clubNorm) || clubNorm.includes(normTeam(t1))) {
      trace('getOpponentFromSnippet', 'opponent', t2);
      return t2;
    }
    if (normTeam(t2) === clubNorm || normTeam(t2).includes(clubNorm) || clubNorm.includes(normTeam(t2))) {
      trace('getOpponentFromSnippet', 'opponent', t1);
      return t1;
    }
    trace('getOpponentFromSnippet', 'no club match, return t2', t2);
    return t2;
  }
  const m2 = snippet.match(/([A-Za-z][A-Za-z0-9\s.]*?)[\s|]+(?:FT\s*\d+\s*:\s*\d+|\d{1,2}\s*:\s*\d{2}|:)[\s|]+([A-Za-z][A-Za-z0-9\s.]+)/);
  if (m2) {
    const t1 = m2[1].trim();
    const t2 = m2[2].trim();
    trace('getOpponentFromSnippet', 'plain match', { t1, t2 });
    if (normTeam(t1) === clubNorm || normTeam(t1).includes(clubNorm) || clubNorm.includes(normTeam(t1))) {
      trace('getOpponentFromSnippet', 'opponent', t2);
      return t2;
    }
    if (normTeam(t2) === clubNorm || normTeam(t2).includes(clubNorm) || clubNorm.includes(normTeam(t2))) {
      trace('getOpponentFromSnippet', 'opponent', t1);
      return t1;
    }
    trace('getOpponentFromSnippet', 'no club match, return t2', t2);
    return t2;
  }
  trace('getOpponentFromSnippet', 'no match in snippet');
  return null;
}

/** Parse result/detail URLs to get (dateKey -> [team1, team2]). Slug format: .../YYYY-MM-DD/TEAM1_SLUG/TEAM2_SLUG */
function parseFixtureLinksFromHtml(html) {
  const map = new Map();
  const $ = cheerio.load(html);
  $('a[href*="result/detail"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const parts = href.split('/').filter(Boolean);
    // .../result/detail/LEAGUE/YYYY-MM-DD/TEAM1/TEAM2
    if (parts.length >= 5) {
      const dateKey = parts[parts.length - 3];
      const team1 = (parts[parts.length - 2] || '').replace(/_/g, ' ').trim();
      const team2 = (parts[parts.length - 1] || '').replace(/_/g, ' ').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && team1 && team2) map.set(dateKey, [team1, team2]);
    }
  });
  return map;
}

/**
 * Parse Liga Indonesia Baru club page: Indonesian date (DD Month YYYY) + match line (TEAM FT score TEAM or TEAM HH:MM TEAM) + venue.
 * Fixture content may be in initial HTML or loaded via AJAX; we parse whatever we get.
 * Ref: https://www.ligaindonesiabaru.com/clubs/single/BRI_SUPER_LEAGUE_2025-26/PERSEBAYA_SURABAYA
 */
function parseLigaIndonesiaBaru(html, clubName) {
  const events = [];
  const $ = cheerio.load(html);
  const text = $('body').text();
  const fixtureByDate = parseFixtureLinksFromHtml(html);
  const idMonthRe = /(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)/i;
  const timeRe = /(\d{1,2}):(\d{2})/;

  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const dm = block.match(/(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i);
    if (!dm) continue;
    const day = parseInt(dm[1], 10);
    const monthName = dm[2];
    const month = (ID_MONTHS[monthName] || ID_MONTHS[monthName.charAt(0).toUpperCase() + monthName.slice(1).toLowerCase()]) - 1;
    const year = parseInt(dm[3], 10);

    let hour = 19;
    let min = 0;
    let summary = clubName ? `${clubName} – Match` : 'Match';
    let location = '';

    const timeMatch = block.match(timeRe);
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      min = parseInt(timeMatch[2], 10);
    }

    // Pipes between team and score: **TEAM1**|FT0:1|**TEAM2** or **TEAM1**|19:00|**TEAM2**
    const teamMatch = block.match(/\*\*([^*]+)\*\*[\s|]*(?:FT\s*\d+\s*:\s*\d+|\d{1,2}\s*:\s*\d{2}|:)[\s|]*\*\*([^*]+)\*\*/);
    if (teamMatch) {
      summary = `${teamMatch[1].trim()} – ${teamMatch[2].trim()}`;
      const venueMatch = block.replace(teamMatch[0], '').trim().match(/\s+([A-Z][A-Z\s]+)$/);
      if (venueMatch) location = venueMatch[1].trim();
    } else {
      const twoTeams = block.match(/([A-Z][A-Za-z0-9\s.]+)[\s|]+(?:FT\s*\d+\s*:\s*\d+|\d{1,2}\s*:\s*\d{2}|:)[\s|]+([A-Z][A-Za-z0-9\s.]+)/);
      if (twoTeams) {
        summary = `${twoTeams[1].trim()} – ${twoTeams[2].trim()}`;
        const after = block.substring(block.indexOf(twoTeams[2]) + twoTeams[2].length).trim();
        const venue = after.match(/\s+([A-Z][A-Z\s]{3,})$/);
        if (venue) location = venue[1].trim();
      } else if (clubName && fixtureByDate.size > 0) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (fixtureByDate.has(dateKey)) {
          const [t1, t2] = fixtureByDate.get(dateKey);
          const opp = normTeam(t1) === normTeam(clubName) || normTeam(t1).includes(normTeam(clubName)) || normTeam(clubName).includes(normTeam(t1)) ? t2 : t1;
          summary = `${clubName} – ${opp}`;
        }
      }
    }

    const start = wibToDate(year, month, day, hour, min);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    events.push({
      start,
      end,
      allDay: false,
      summary,
      description: clubName ? `${clubName} – ${summary}` : summary,
      location,
    });
  }

  if (events.length === 0) {
    const combined = text.replace(/\s+/g, ' ');
    const re = /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/gi;
    let m;
    const dateMatches = [];
    while ((m = re.exec(combined)) !== null) dateMatches.push({ index: m.index, day: m[1], monthName: m[2], year: m[3] });
    trace('parseLigaIndonesiaBaru fallback', 'dateMatches.length', dateMatches.length, 'combined.length', combined.length);
    for (let i = 0; i < dateMatches.length; i++) {
      const d = dateMatches[i];
      const snippetStart = d.index;
      const snippetEnd = i + 1 < dateMatches.length ? dateMatches[i + 1].index : Math.min(combined.length, snippetStart + 400);
      const snippet = combined.substring(snippetStart, snippetEnd);
      if (i < 3) trace('parseLigaIndonesiaBaru fallback', 'date', d.day, d.monthName, d.year, 'snippetLen', snippet.length);
      let opponent = getOpponentFromSnippet(snippet, clubName);
      const day = parseInt(d.day, 10);
      const monthName = d.monthName;
      const monthIdx = ID_MONTHS[monthName] || ID_MONTHS[monthName.charAt(0).toUpperCase() + monthName.slice(1).toLowerCase()];
      const month = monthIdx - 1;
      const year = parseInt(d.year, 10);
      const dateKey = `${year}-${String(monthIdx).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!opponent && clubName && fixtureByDate.has(dateKey)) {
        const [t1, t2] = fixtureByDate.get(dateKey);
        opponent = normTeam(t1) === normTeam(clubName) || normTeam(t1).includes(normTeam(clubName)) || normTeam(clubName).includes(normTeam(t1)) ? t2 : t1;
        if (i < 3) trace('parseLigaIndonesiaBaru fallback', 'opponent from link', opponent);
      }
      if (i < 3) trace('parseLigaIndonesiaBaru fallback', 'opponent', opponent);
      const summary = clubName && opponent ? `${clubName} – ${opponent}` : clubName ? `${clubName} – Match` : 'Match';
      const start = wibToDate(year, month, day, 19, 0);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      events.push({
        start,
        end,
        allDay: false,
        summary,
        description: `${day} ${monthName} ${year}`,
        location: '',
      });
    }
  }

  trace('parseLigaIndonesiaBaru', 'found', events.length, 'event(s)');
  return events;
}

/**
 * Parse Transfermarkt club schedule page. Table format: Tanggal | Waktu | H/A | Lawan (opponent).
 * Date: "Jum 8 Agt 2025" (day abbrev, day, month abbrev, year). Time: "19.00" (HH.MM).
 * Ref: https://www.transfermarkt.co.id/persebaya-surabaya/spielplan/verein/31444
 */
function parseTransfermarkt(html, clubName) {
  const events = [];
  const $ = cheerio.load(html);

  // Find the fixtures table (has Tanggal + Lawan columns)
  $('table').each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('thead th, thead td, tr:first-child td, tr:first-child th').text();
    if (!headerText.includes('Tanggal') || !headerText.includes('Lawan')) return;

    $table.find('tr').each((__, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 4) return;

      let dateStr = '';
      let timeStr = '';
      let opponent = '';

      cells.each((i, cell) => {
        const $cell = $(cell);
        const text = $cell.text().trim();

        // Date: "Jum 8 Agt 2025"
        const dateMatch = text.match(/^(?:Jum|Sab|Min|Sen|Sel|Rab|Kam)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agt|Sep|Okt|Nov|Des)\s+(\d{4})$/i);
        if (dateMatch) dateStr = text;

        // Time: "19.00" or "05.00"
        if (/^\d{1,2}\.\d{2}$/.test(text)) timeStr = text;

        // Opponent: link to club page (href contains verein + startseite)
        const $link = $cell.find('a[href*="verein"][href*="startseite"]').first();
        if ($link.length) {
          opponent = $link.text().trim().replace(/\s*\(\d+\.?\)\s*$/, '').trim();
        }
      });

      if (!dateStr || !opponent) return;

      const dm = dateStr.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agt|Sep|Okt|Nov|Des)\s+(\d{4})/i);
      if (!dm) return;

      const day = parseInt(dm[1], 10);
      const monthAbbrev = dm[2];
      const year = parseInt(dm[3], 10);
      const month = (ID_MONTH_ABBREV[monthAbbrev] ?? ID_MONTH_ABBREV[monthAbbrev.charAt(0).toUpperCase() + monthAbbrev.slice(1).toLowerCase()]) - 1;

      let hour = 19;
      let min = 0;
      if (timeStr) {
        const [h, m] = timeStr.split('.').map((n) => parseInt(n, 10));
        hour = h;
        min = m || 0;
      }

      const start = wibToDate(year, month, day, hour, min);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      const summary = clubName ? `${clubName} – ${opponent}` : opponent;

      events.push({
        start,
        end,
        allDay: false,
        summary,
        description: summary,
        location: '',
      });
    });
  });

  trace('parseTransfermarkt', 'found', events.length, 'event(s)');
  return events;
}

/**
 * Fetch HTML with optional Referer (for sites that load content via AJAX).
 */
async function fetchHtmlWithReferer(url, referer) {
  if (!url || typeof url !== 'string') return null;
  trace('fetchHtmlWithReferer', url);
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0; +https://github.com/calendar-ios-sync)',
      'Accept': 'text/html,application/xhtml+xml,application/json',
    };
    if (referer) headers['Referer'] = referer;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      trace('fetchHtmlWithReferer fail', res.status);
      return null;
    }
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();
    if (contentType.includes('application/json')) {
      try {
        const data = JSON.parse(body);
        if (data && typeof data[null] === 'string') return data[null];
        if (data && data.html) return data.html;
      } catch (_) {}
    }
    return body;
  } catch (err) {
    trace('fetchHtmlWithReferer error', err?.message);
    return null;
  }
}

/**
 * Global football schedule crawl: fetch URL, try site-specific parser then JSON-LD then table.
 * source: { url, clubName?, provider? }
 */
async function getFootballScheduleEvents(source) {
  const url = source?.url;
  const clubName = source?.clubName || '';
  trace('getFootballScheduleEvents', { url, clubName });
  if (!url || typeof url !== 'string') {
    trace('getFootballScheduleEvents', 'no url, return []');
    return [];
  }

  const isTransfermarkt = url.includes('transfermarkt.co.id');
  let html = await fetchHtml(url, {
    browserLike: isTransfermarkt,
    referer: isTransfermarkt ? 'https://www.transfermarkt.co.id/' : undefined,
  });
  if (!html) {
    trace('getFootballScheduleEvents', 'no html, return []');
    return [];
  }

  let events = [];

  if (url.includes('ligaindonesiabaru.com')) {
    trace('getFootballScheduleEvents', 'using Liga Indonesia Baru parser');
    events = parseLigaIndonesiaBaru(html, clubName);
    if (events.length === 0) {
      const base = url.replace(/\/?$/, '');
      const paginationHtml = await fetchHtmlWithReferer(base + '/pagination/1', url);
      if (paginationHtml) {
        events = parseLigaIndonesiaBaru(paginationHtml, clubName);
        trace('getFootballScheduleEvents', 'pagination events', events.length);
      }
    }
  }

  if (events.length === 0 && url.includes('transfermarkt.co.id')) {
    trace('getFootballScheduleEvents', 'using Transfermarkt parser');
    events = parseTransfermarkt(html, clubName);
  }

  if (events.length === 0) {
    events = parseJsonLdEvents(html, clubName);
    if (events.length > 0) trace('getFootballScheduleEvents', 'used JSON-LD parser');
  }
  if (events.length === 0) {
    events = parseTableFixtures(html, clubName);
    if (events.length > 0) trace('getFootballScheduleEvents', 'used table parser');
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 1);
  const filtered = events.filter((ev) => ev.start >= cutoff);
  trace('getFootballScheduleEvents', 'done', filtered.length, 'event(s) after filter');
  return filtered;
}

/**
 * Get events for static, api, or scrape feeds.
 */
async function getEventsForFeed(feedId, type, source) {
  if (type === 'static') return [];
  if (type === 'api') {
    if (source?.provider === 'ayyamul-bidh') return getAyyamulBidhEvents();
    return [];
  }
  if (type === 'scrape') return getFootballScheduleEvents(source);
  return [];
}

function buildIcs(feedId, name, events) {
  const cal = ical({
    name: name || feedId,
    description: `Calendar feed: ${name || feedId}`,
  });
  events.forEach((ev) => {
    cal.createEvent({
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay || false,
      summary: ev.summary,
      description: ev.description || '',
      location: ev.location || '',
    });
  });
  return cal.toString();
}

exports.handler = async (event) => {
  const path = event.path || '';
  const feedFromPath = path.replace(/^\/cal\/?/, '').replace(/\.ics$/, '').trim();
  const feedId = event.queryStringParameters?.feed || feedFromPath || '';

  const entry = registry.find((e) => e.id === feedId);
  const name = entry ? entry.name : feedId;
  const type = entry ? entry.type : 'static';
  const source = entry?.source ?? null;

  if (type === 'url') {
    const icsBody = await fetchUrlIcs(source);
    if (icsBody) {
      const noCache = event.queryStringParameters?.refresh === '1';
      const cacheControl = noCache
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=3600';
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Cache-Control': cacheControl,
        },
        body: icsBody,
      };
    }
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/plain' },
      body: 'Failed to fetch calendar',
    };
  }

  const events = await getEventsForFeed(feedId, type, source);
  const icsBody = buildIcs(feedId, name, events);

  // refresh=1 bypasses cache so subscribers can force a re-crawl
  const noCache = event.queryStringParameters?.refresh === '1';
  const cacheControl = noCache
    ? 'no-cache, no-store, must-revalidate'
    : 'public, max-age=300';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': cacheControl,
    },
    body: icsBody,
  };
};
