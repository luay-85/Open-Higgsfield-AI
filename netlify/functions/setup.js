// First-run setup page (direct Airtable mode only), served at /setup.
//
// GET  -> checks the Airtable token and base, creates the tables if needed,
//         and shows a form to create the FIRST sign-in account.
// POST -> creates that first account (name + PIN, PIN stored as a scrypt hash).
// Once any account exists the form is disabled, so this cannot be used to add
// accounts to a running site.

const crypto = require('crypto')
const direct = require('./_airtable_direct')

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function page(title, body, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#050505;color:#eee;font:16px/1.5 system-ui,-apple-system,sans-serif;padding:24px 16px}
main{max-width:440px;margin:0 auto}h1{font-size:24px;letter-spacing:.08em}
.ok{color:#9be15d}.bad{color:#ff6b6b}li{margin:6px 0}
label{display:block;margin:14px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #333;background:#111;color:#fff;font-size:16px}
button,a.btn{display:block;width:100%;margin-top:20px;padding:14px;border:0;border-radius:10px;background:#d9ff00;color:#000;font-weight:700;font-size:16px;text-align:center;text-decoration:none}
.note{color:#999;font-size:14px}
</style></head><body><main><h1>MATAI SETUP</h1>${body}</main></body></html>`,
  }
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16)
  return `${salt.toString('hex')}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`
}

async function accountCount() {
  const res = await direct.directFetch(`${direct.LEGACY_AUTH_URL}?pageSize=1`)
  if (!res.ok) throw new Error(`Could not read the App Auth table (${res.status}).`)
  return (res.json().records || []).length
}

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '')
  const type = String(event.headers?.['content-type'] || '')
  if (type.includes('application/json')) {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

exports.handler = async function (event) {
  if (!direct.isDirectMode()) {
    return page('Setup', `<p>This setup page is only used when the site runs with an Airtable token
      (environment variable <b>AIRTABLE_PAT</b>) and without Composio.</p>
      <p class="note">${direct.token() ? 'COMPOSIO_API_KEY is set, so the original Composio setup is in use.' : 'AIRTABLE_PAT is not set yet. Add it in Netlify → Site configuration → Environment variables, then redeploy.'}</p>`)
  }

  let info
  try {
    info = await direct.ready()
  } catch (error) {
    return page('Setup', `<ul><li class="ok">✓ Airtable token found</li><li class="bad">✗ ${esc(error.message)}</li></ul>
      <p class="note">Fix this, then reload this page.</p>`, 500)
  }

  const checks = `<ul>
    <li class="ok">✓ Airtable token works</li>
    <li class="ok">✓ Base found: <b>${esc(info.baseName)}</b></li>
    <li class="ok">✓ Tables ready: App Auth, Generations, Avatars</li>
  </ul>`

  if (event.httpMethod === 'POST') {
    const body = parseBody(event)
    const name = String(body.name || '').trim()
    const pin = String(body.pin || '').trim()
    const pin2 = String(body.pin2 || '').trim()
    const problem = !name ? 'Enter your first name.'
      : name.length > 40 ? 'Name is too long.'
      : !/^\d{4,12}$/.test(pin) ? 'PIN must be 4 to 12 digits.'
      : pin !== pin2 ? 'The two PINs do not match.'
      : null
    if (problem) return page('Setup', `${checks}<p class="bad">${esc(problem)}</p><a class="btn" href="/setup">Try again</a>`, 400)

    if (await accountCount() > 0) {
      return page('Setup', `${checks}<p>An account already exists, so setup is finished.</p><a class="btn" href="/">Go to sign in</a>`, 409)
    }
    const res = await direct.directFetch(direct.LEGACY_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify({
        typecast: true,
        fields: { Name: name, 'First Name': name, 'PIN Hash': hashPin(pin), Status: 'Active' },
      }),
    })
    if (!res.ok) return page('Setup', `${checks}<p class="bad">Could not create the account (${res.status}).</p>`, 500)
    return page('Setup', `${checks}<p class="ok"><b>Your account "${esc(name)}" is ready.</b></p>
      <p>Next: sign in with your first name and PIN, then paste your kie.ai API key when asked.</p>
      <a class="btn" href="/">Go to sign in</a>`)
  }

  if (await accountCount() > 0) {
    return page('Setup', `${checks}<p>Setup is finished. An account already exists.</p><a class="btn" href="/">Go to sign in</a>`)
  }

  return page('Setup', `${checks}
    <p>Create your sign-in account. You'll use this first name and PIN to open the studio.</p>
    <form method="post" action="/setup">
      <label for="name">First name</label><input id="name" name="name" autocomplete="given-name" required maxlength="40">
      <label for="pin">PIN (4–12 digits)</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4,12}" required>
      <label for="pin2">Repeat PIN</label><input id="pin2" name="pin2" type="password" inputmode="numeric" pattern="\\d{4,12}" required>
      <button type="submit">Create my account</button>
    </form>
    <p class="note">This form only works once. After the first account exists it is switched off.</p>`)
}
