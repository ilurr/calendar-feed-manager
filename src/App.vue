<script setup>
import { ref, computed, onMounted } from 'vue'

const feeds = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${base}/.netlify/functions/feeds`)
    if (res.ok) feeds.value = await res.json()
    else feeds.value = [
      { id: 'football', name: 'Serie A', type: 'static' },
      { id: 'fasting', name: 'Fasting times', type: 'static' },
    ]
  } catch (_) {
    feeds.value = [
      { id: 'football', name: 'Serie A', type: 'static' },
      { id: 'fasting', name: 'Fasting times', type: 'static' },
    ]
  } finally {
    loading.value = false
  }
})

const visibleFeeds = computed(() => feeds.value)

function subscribeUrl(feedId) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/cal/${feedId}.ics`
}

function webcalUrl(feedId) {
  if (typeof window === 'undefined') return subscribeUrl(feedId)
  const protocol = window.location.protocol === 'https:' ? 'webcal:' : 'webcal:'
  return `${protocol}//${window.location.host}/cal/${feedId}.ics`
}

function copyUrl(feedId) {
  const url = subscribeUrl(feedId)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      copyFeedback.value = feedId
      setTimeout(() => { copyFeedback.value = null }, 2000)
    })
  }
}

const copyFeedback = ref(null)
const refreshFeedback = ref(null)
const showAddFeed = ref(false)
const addFeedSubmitting = ref(false)
const addFeedResult = ref(null)

const addFeedForm = ref({
  type: 'url',
  id: '',
  name: '',
  sourceUrl: '',
  crawlUrl: '',
  clubName: '',
  stadiumSourceUrl: '',
  apiProvider: 'ayyamul-bidh',
})

function buildAddFeedPayload() {
  const { type, id, name, sourceUrl, crawlUrl, clubName, stadiumSourceUrl, apiProvider } = addFeedForm.value
  const entry = { id: id.trim(), name: name.trim(), type }
  if (type === 'url') {
    entry.source = { url: sourceUrl.trim() }
  } else if (type === 'api') {
    entry.source = { provider: apiProvider.trim() || 'ayyamul-bidh' }
  } else {
    entry.source = {
      url: crawlUrl.trim(),
      clubName: clubName.trim() || undefined,
      stadiumSourceUrl: stadiumSourceUrl.trim() || undefined,
    }
  }
  return entry
}

async function submitAddFeed() {
  addFeedResult.value = null
  const { type, id, name, sourceUrl, crawlUrl, clubName } = addFeedForm.value
  if (!id.trim() || !name.trim()) {
    addFeedResult.value = { ok: false, error: 'ID and Name are required' }
    return
  }
  if (type === 'url' && !sourceUrl.trim()) {
    addFeedResult.value = { ok: false, error: 'Source URL is required for URL feed' }
    return
  }
  if (type === 'scrape' && !crawlUrl.trim()) {
    addFeedResult.value = { ok: false, error: 'Crawl URL is required for scrape feed' }
    return
  }
  addFeedSubmitting.value = true
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${base}/.netlify/functions/github-add-feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAddFeedPayload()),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.ok) {
      addFeedResult.value = { ok: true, pr_url: data.pr_url, message: data.message }
      addFeedForm.value = { type: 'url', id: '', name: '', sourceUrl: '', crawlUrl: '', clubName: '', stadiumSourceUrl: '', apiProvider: 'ayyamul-bidh' }
    } else {
      addFeedResult.value = { ok: false, error: data.error || 'Request failed' }
    }
  } catch (e) {
    addFeedResult.value = { ok: false, error: e?.message || 'Network error' }
  } finally {
    addFeedSubmitting.value = false
  }
}

async function refreshFeed(feedId) {
  refreshFeedback.value = feedId
  try {
    const url = subscribeUrl(feedId) + '?refresh=1'
    const res = await fetch(url)
    refreshFeedback.value = res.ok ? `ok:${feedId}` : `err:${feedId}`
  } catch {
    refreshFeedback.value = `err:${feedId}`
  }
  setTimeout(() => { refreshFeedback.value = null }, 3000)
}
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow-sm">
      <div class="max-w-4xl mx-auto px-4 py-4">
        <h1 class="text-xl font-semibold text-gray-800">Calendar Sync</h1>
      </div>
    </header>
    <main class="max-w-4xl mx-auto px-4 py-8">
      <h2 class="text-lg font-medium text-gray-800 mb-4">My calendars</h2>
      <p v-if="loading" class="text-gray-500">Loading feeds…</p>
      <ul v-else class="space-y-4">
        <li
          v-for="feed in visibleFeeds"
          :key="feed.id"
          class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3"
        >
          <span class="font-medium text-gray-800">{{ feed.name }}</span>
          <div class="flex items-center gap-2 flex-wrap">
            <a
              :href="webcalUrl(feed.id)"
              class="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Add to Calendar
            </a>
            <button
              type="button"
              class="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-sm hover:bg-gray-50"
              @click="copyUrl(feed.id)"
            >
              {{ copyFeedback === feed.id ? 'Copied!' : 'Copy URL' }}
            </button>
            <button
              type="button"
              class="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-60"
              :disabled="refreshFeedback === feed.id"
              @click="refreshFeed(feed.id)"
              title="Re-crawl the source. Your calendar app syncs periodically; to get updates immediately, remove and re-add this calendar."
            >
              {{ refreshFeedback === feed.id ? 'Checking…' : refreshFeedback === `ok:${feed.id}` ? 'Refreshed!' : refreshFeedback === `err:${feed.id}` ? 'Error' : 'Refresh' }}
            </button>
          </div>
        </li>
      </ul>
      <p v-if="!loading && visibleFeeds.length === 0" class="text-gray-500 mt-4">
        No calendars in your list. Add feeds in the registry.
      </p>
      <p class="text-sm text-gray-500 mt-6">
        Subscribe using &quot;Add to Calendar&quot; or copy the URL and add it in iOS/Mac Calendar. Use &quot;Refresh&quot; to re-crawl the source; your calendar app will pick up changes on its next sync (usually within a few hours). To unsubscribe, remove the calendar in the Calendar app.
      </p>

      <section class="mt-10 pt-8 border-t border-gray-200">
        <button
          type="button"
          class="text-sm text-gray-600 hover:text-gray-800"
          @click="showAddFeed = !showAddFeed"
        >
          {{ showAddFeed ? 'Hide' : 'Add feed' }}
        </button>
        <div v-if="showAddFeed" class="mt-4 bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <p class="text-sm text-gray-600">
            Adds an entry to the registry and opens a GitHub Pull Request. Merge the PR to publish. Requires <code class="bg-gray-100 px-1 rounded">GITHUB_TOKEN</code> and <code class="bg-gray-100 px-1 rounded">REPOSITORY_URL</code> in Netlify.
          </p>
          <div class="flex gap-4 mb-3">
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input v-model="addFeedForm.type" type="radio" value="url" class="rounded" />
              <span class="text-sm">URL (.ics)</span>
            </label>
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input v-model="addFeedForm.type" type="radio" value="scrape" class="rounded" />
              <span class="text-sm">Football (scrape)</span>
            </label>
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input v-model="addFeedForm.type" type="radio" value="api" class="rounded" />
              <span class="text-sm">API</span>
            </label>
          </div>
          <div class="grid gap-3 max-w-md">
            <label class="block text-sm font-medium text-gray-700">
              ID (slug, e.g. my-calendar)
              <input
                v-model="addFeedForm.id"
                type="text"
                class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="my-calendar"
              />
            </label>
            <label class="block text-sm font-medium text-gray-700">
              Name
              <input
                v-model="addFeedForm.name"
                type="text"
                class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="My Calendar"
              />
            </label>
            <template v-if="addFeedForm.type === 'url'">
              <label class="block text-sm font-medium text-gray-700">
                Source URL (.ics)
                <input
                  v-model="addFeedForm.sourceUrl"
                  type="url"
                  class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="https://..."
                />
              </label>
            </template>
            <template v-else-if="addFeedForm.type === 'scrape'">
              <label class="block text-sm font-medium text-gray-700">
                URL to crawl (fixture page)
                <input
                  v-model="addFeedForm.crawlUrl"
                  type="url"
                  class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="https://www.transfermarkt.co.id/..."
                />
              </label>
              <label class="block text-sm font-medium text-gray-700">
                Club name (optional)
                <input
                  v-model="addFeedForm.clubName"
                  type="text"
                  class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="Persebaya Surabaya"
                />
              </label>
              <label class="block text-sm font-medium text-gray-700">
                Stadium source URL (optional, for stadium enrichment)
                <input
                  v-model="addFeedForm.stadiumSourceUrl"
                  type="url"
                  class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="https://www.ligaindonesiabaru.com/..."
                />
              </label>
            </template>
            <template v-else>
              <label class="block text-sm font-medium text-gray-700">
                Provider (e.g. ayyamul-bidh)
                <input
                  v-model="addFeedForm.apiProvider"
                  type="text"
                  class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="ayyamul-bidh"
                />
              </label>
            </template>
          </div>
          <button
            type="button"
            class="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
            :disabled="addFeedSubmitting"
            @click="submitAddFeed"
          >
            {{ addFeedSubmitting ? 'Creating PR…' : 'Add feed (open PR)' }}
          </button>
          <div v-if="addFeedResult" class="mt-2 p-3 rounded text-sm" :class="addFeedResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'">
            <template v-if="addFeedResult.ok">
              <p>{{ addFeedResult.message }}</p>
              <a v-if="addFeedResult.pr_url" :href="addFeedResult.pr_url" target="_blank" rel="noopener" class="underline font-medium">Open Pull Request</a>
            </template>
            <template v-else>
              <p>{{ addFeedResult.error }}</p>
            </template>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
