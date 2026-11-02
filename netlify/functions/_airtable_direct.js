// Direct Airtable mode (no Composio).
//
// Active when an Airtable personal access token is set (AIRTABLE_PAT and
// friends) and COMPOSIO_API_KEY is NOT set. In this mode:
//   * every Airtable call goes straight to api.airtable.com with the token;
//   * the base is found automatically: AIRTABLE_BASE_ID if set, otherwise the
//     base named AIRTABLE_BASE_NAME (default "MATAI Studio"), otherwise the
//     only base the token can see;
//   * the three tables the app needs (App Auth, Generations, Avatars) and
//     their fields are created on first use if they are missing;
//   * the legacy hard-coded base/table IDs used throughout the functions are
//     transparently rewritten to the resolved base and tables.
// Deployments that still set COMPOSIO_API_KEY keep the original behaviour.

const API = 'https://api.airtable.com/v0'

function normalizeToken(raw) {
  let token = String(raw || '').trim()
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim()
  }
  return token.replace(/^Authorization\s*:\s*/i, '').replace(/^Bearer\s+/i, '').trim()
}

const token = () => normalizeToken(
  process.env.AIRTABLE_PAT
  || process.env.AIRTABLE_TOKEN
  || process.env.AIRTABLE_ACCESS_TOKEN
  || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
  || process.env.AIRTABLE_API_KEY
  || process.env.AIRTABLE_AUTH
)

const isDirectMode = () => !String(process.env.COMPOSIO_API_KEY || '').trim() && Boolean(token())

// Legacy IDs hard-coded in _auth.js / _airtable.js / avatars.js.
const LEGACY_BASES = ['applP85ZQYvmFGSxa', 'appxWa7YNYpMjIVAz', 'appSYUhlcApc5k3PO']
const LEGACY_TABLES = {
  tbloKNK7pmGiaEB1K: 'auth',
  tbleSsBerfkEtTFTk: 'generations',
  tblsT27uHkU21Csq0: 'avatars',
}

const text = (name) => ({ name, type: 'singleLineText' })
const longText = (name) => ({ name, type: 'multilineText' })
const checkbox = (name) => ({ name, type: 'checkbox', options: { icon: 'check', color: 'greenBright' } })
const number = (name, precision = 0) => ({ name, type: 'number', options: { precision } })
const date = (name) => ({
  name,
  type: 'dateTime',
  options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
})
const select = (name, choices) => ({ name, type: 'singleSelect', options: { choices: choices.map((c) => ({ name: c })) } })
const files = (name) => ({ name, type: 'multipleAttachments' })

// The first field of each list is the table's primary field.
const SCHEMA = {
  auth: {
    name: 'App Auth',
    fields: [
      text('Name'),
      text('First Name'),
      text('PIN Hash'),
      select('Status', ['Active', 'Disabled']),
      checkbox('Provider Setup Complete'),
      checkbox('Has Kie'),
      checkbox('Has fal'),
      text('Kie API Key'),
      text('fal API Key'),
      number('Kie Requests'),
      number('fal Requests'),
      number('Estimated Credits Used', 2),
      number('Failed Login Attempts'),
      date('Failed Window Started'),
      date('Last Failed Login'),
      date('Locked Until'),
      date('Last Login'),
      date('Last API Use'),
    ],
  },
  generations: {
    name: 'Generations',
    fields: [
      text('Name'),
      select('Type', ['Image', 'Video']),
      text('Model'),
      longText('Prompt'),
      select('Status', ['Draft', 'Ready', 'Failed']),
      files('Media'),
      text('Source URL'),
      longText('Params'),
      text('Folder'),
      date('Created'),
    ],
  },
  avatars: {
    name: 'Avatars',
    fields: [
      text('Name'),
      longText('Description'),
      text('Voice'),
      files('Portraits'),
      date('Created'),
    ],
  },
}

async function meta(path, options = {}) {
  const res = await fetch(`${API}/meta/${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const raw = await res.text()
  let body = {}
  try { body = raw ? JSON.parse(raw) : {} } catch { body = { raw } }
  if (!res.ok) {
    const detail = body?.error?.message || body?.error?.type || body?.error || raw || res.statusText
    const error = new Error(`Airtable setup failed (${res.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    error.status = res.status
    throw error
  }
  return body
}

async function resolveBase() {
  const wantedId = String(process.env.AIRTABLE_BASE_ID || '').trim()
  if (wantedId) return { id: wantedId, name: wantedId }

  const wantedName = String(process.env.AIRTABLE_BASE_NAME || 'MATAI Studio').trim().toLowerCase()
  const bases = []
  let offset
  do {
    const page = await meta(`bases${offset ? `?offset=${encodeURIComponent(offset)}` : ''}`)
    bases.push(...(page.bases || []))
    offset = page.offset
  } while (offset)

  const named = bases.find((b) => String(b.name || '').trim().toLowerCase() === wantedName)
  if (named) return named
  if (bases.length === 1) return bases[0]
  const error = new Error(bases.length
    ? `Could not find an Airtable base named "${process.env.AIRTABLE_BASE_NAME || 'MATAI Studio'}". The token can see: ${bases.map((b) => b.name).join(', ')}.`
    : 'The Airtable token cannot see any base. Edit the token and add your base under "Access".')
  error.code = 'AIRTABLE_BASE_NOT_FOUND'
  throw error
}

async function ensureTables(baseId) {
  const tables = async () => (await meta(`bases/${baseId}/tables`)).tables || []
  let existing = await tables()
  const ids = {}

  for (const [key, spec] of Object.entries(SCHEMA)) {
    let table = existing.find((t) => t.name === spec.name)
    if (!table) {
      try {
        table = await meta(`bases/${baseId}/tables`, { method: 'POST', body: { name: spec.name, fields: spec.fields } })
      } catch (error) {
        // Another function instance may have created it at the same moment.
        existing = await tables()
        table = existing.find((t) => t.name === spec.name)
        if (!table) throw error
      }
    }
    const have = new Set((table.fields || []).map((f) => f.name))
    for (const field of spec.fields) {
      if (have.has(field.name)) continue
      try {
        await meta(`bases/${baseId}/tables/${table.id}/fields`, { method: 'POST', body: field })
      } catch (error) {
        if (!/duplicate|already exists/i.test(error.message)) throw error
      }
    }
    ids[key] = table.id
  }
  return ids
}

let readyPromise = null
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const base = await resolveBase()
      const tables = await ensureTables(base.id)
      return { baseId: base.id, baseName: base.name, tables }
    })().catch((error) => {
      readyPromise = null
      throw error
    })
  }
  return readyPromise
}

function rewriteUrl(url, info) {
  return String(url).replace(/\/v0\/(app[A-Za-z0-9]+)\/([^/?]+)/, (match, baseId, table) => {
    const base = LEGACY_BASES.includes(baseId) ? info.baseId : baseId
    const key = LEGACY_TABLES[table]
    return `/v0/${base}/${key ? info.tables[key] : table}`
  })
}

// Same { ok, status, text, json } shape that _composio.toolkitFetch returns.
async function directFetch(url, options = {}) {
  const info = await ready()
  const method = String(options.method || 'GET').toUpperCase()
  let body = options.body
  if (body !== undefined && body !== null && typeof body !== 'string') body = JSON.stringify(body)
  const res = await fetch(rewriteUrl(url, info), {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : body,
  })
  const raw = await res.text()
  let parsed = {}
  try { parsed = raw ? JSON.parse(raw) : {} } catch { parsed = { raw } }
  return { ok: res.ok, status: res.status, text: raw, json: () => parsed }
}

module.exports = {
  isDirectMode,
  token,
  ready,
  directFetch,
  LEGACY_AUTH_URL: `${API}/${LEGACY_BASES[0]}/tbloKNK7pmGiaEB1K`,
}
