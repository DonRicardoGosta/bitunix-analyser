// Bitunix REST request signing, performed in the browser via Web Crypto.
//
// Per the Bitunix docs the signature is a *double* SHA-256:
//   digest = SHA256(nonce + timestamp + apiKey + queryParams + body)
//   sign   = SHA256(digest + secretKey)
// where:
//   - queryParams = each key/value concatenated, keys sorted ascending (e.g.
//     {id:1, uid:200} -> "id1uid200"). Empty when there are no query params.
//   - body        = compact JSON string with no spaces. Empty for GET.
//   - timestamp   = current time in milliseconds.
//   - nonce       = random 32-char string.

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(buf))
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function makeNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes) // 32 hex chars
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>

/** Sorted "key+value" concatenation used in the signature digest. */
export function buildQueryParamsString(params?: QueryParams): string {
  if (!params) return ''
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
  return keys.map((k) => `${k}${params[k]}`).join('')
}

/** Sorted querystring (key=value&...) used to build the actual request URL. */
export function buildQueryString(params?: QueryParams): string {
  if (!params) return ''
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
  if (keys.length === 0) return ''
  return keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&')
}

export interface SignInput {
  apiKey: string
  secretKey: string
  nonce: string
  timestamp: string
  queryParams: string
  body: string
}

export async function signRequest(input: SignInput): Promise<string> {
  const digest = await sha256Hex(
    input.nonce + input.timestamp + input.apiKey + input.queryParams + input.body,
  )
  return sha256Hex(digest + input.secretKey)
}
