const icalGenerator = require('ical-generator');
const ical = typeof icalGenerator === 'function' ? icalGenerator : icalGenerator.default;
const { toHijri, toGregorian } = require('hijri-converter');

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
          const end = new Date(g.gy, g.gm - 1, g.gd, 23, 59, 59);
          const monthName = HIJRI_MONTH_NAMES[hm - 1] || `Month ${hm}`;
          events.push({
            start,
            end,
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

/**
 * Get events for static or api feeds. Add your own feed logic here when you add registry entries.
 * Returns empty array for unknown feeds; implement per feedId/type as needed.
 */
async function getEventsForFeed(feedId, type, source) {
  if (type === 'static') {
    return [];
  }
  if (type === 'api') {
    if (source?.provider === 'ayyamul-bidh') return getAyyamulBidhEvents();
    return [];
  }
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
