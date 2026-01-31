const icalGenerator = require('ical-generator');
const ical = typeof icalGenerator === 'function' ? icalGenerator : icalGenerator.default;

const registry = require('./feeds-registry.json');

function getStaticFootballEvents() {
  const year = new Date().getFullYear();
  return [
    {
      start: new Date(year, 0, 29, 2, 45),
      end: new Date(year, 0, 29, 4, 45),
      summary: 'Atalanta - Inter',
      description: 'Serie A',
      location: 'Gewiss Stadium, Viale Giulio Cesare, 18, 24124 Bergamo BG, Italia',
    },
    {
      start: new Date(year, 1, 5, 20, 45),
      end: new Date(year, 1, 5, 22, 45),
      summary: 'Inter – Bologna',
      description: 'Serie A',
      location: 'San Siro, Milano',
    },
    {
      start: new Date(year, 1, 12, 20, 45),
      end: new Date(year, 1, 12, 22, 45),
      summary: 'Inter – Napoli',
      description: 'Serie A',
      location: 'San Siro, Milano',
    },
    {
      start: new Date(year, 1, 15, 20, 45),
      end: new Date(year, 1, 15, 22, 45),
      summary: 'Inter – Lecce',
      description: 'Serie A',
      location: 'San Siro, Milano',
    },
  ];
}

function getStaticFastingEvents() {
  const events = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    const sunrise = new Date(day);
    sunrise.setHours(6, 30, 0, 0);
    const sunset = new Date(day);
    sunset.setHours(19, 0, 0, 0);
    events.push({
      start: sunrise,
      end: sunset,
      summary: `Fasting day ${i + 1}`,
      description: 'Sunrise to sunset',
      location: '',
    });
  }
  return events;
}

/**
 * Fetch sunrise/sunset from API and return fasting events (sunrise to sunset) for the next 14 days.
 * @param {{ provider: string, lat: number, lng: number }} source
 * @returns {Promise<Array<{ start: Date, end: Date, summary: string, description: string, location: string }>>}
 */
async function getApiFastingEvents(source) {
  const lat = source?.lat ?? 41.9;
  const lng = source?.lng ?? 12.5;
  const events = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  for (let i = 0; i < 14; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${dateStr}&formatted=0`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data?.status === 'OK' && data?.results) {
        const sunrise = new Date(data.results.sunrise);
        const sunset = new Date(data.results.sunset);
        events.push({
          start: sunrise,
          end: sunset,
          summary: `Fasting ${dateStr}`,
          description: 'Sunrise to sunset',
          location: '',
        });
      }
    } catch (_) {
      // fallback to placeholder event for this day
      const sunrise = new Date(d);
      sunrise.setHours(6, 30, 0, 0);
      const sunset = new Date(d);
      sunset.setHours(19, 0, 0, 0);
      events.push({
        start: sunrise,
        end: sunset,
        summary: `Fasting ${dateStr}`,
        description: 'Sunrise to sunset (approx)',
        location: '',
      });
    }
  }
  return events;
}

/**
 * Proxy an external .ics URL: fetch and return as-is.
 * @param {{ url: string }} source
 * @returns {Promise<string|null>} Raw .ics body or null on failure
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

async function getEventsForFeed(feedId, type, source) {
  if (type === 'static') {
    if (feedId === 'football') return getStaticFootballEvents();
    if (feedId === 'fasting') return getStaticFastingEvents();
  }
  if (type === 'api' && source?.provider === 'sunrise-sunset') {
    return getApiFastingEvents(source);
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
  const feedId = event.queryStringParameters?.feed || feedFromPath || 'football';

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
