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

/**
 * Fetch HTML from a URL for crawling.
 */
async function fetchHtml(url) {
  if (!url || typeof url !== 'string') return null;
  trace('fetchHtml', url);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CalendarSync/1.0; +https://github.com/calendar-ios-sync)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      trace('fetchHtml fail', res.status, res.statusText);
      return null;
    }
    const html = await res.text();
    trace('fetchHtml ok', html?.length, 'bytes');
    return html;
  } catch (err) {
    trace('fetchHtml error', err?.message || err);
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

/**
 * Global football schedule crawl: fetch URL, try JSON-LD then table parser.
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

  const html = await fetchHtml(url);
  if (!html) {
    trace('getFootballScheduleEvents', 'no html, return []');
    return [];
  }

  let events = parseJsonLdEvents(html, clubName);
  const fromJsonLd = events.length;
  if (events.length === 0) {
    events = parseTableFixtures(html, clubName);
    trace('getFootballScheduleEvents', 'used table parser');
  } else {
    trace('getFootballScheduleEvents', 'used JSON-LD parser');
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
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
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

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
    body: icsBody,
  };
};
