# 2026-07-23 — SKKU-DULE URL reconnection audit

## Issue found and fixed

- After the Vercel project rename, the new `skku-dule.vercel.app` alias existed but returned a
  Vercel SSO-login redirect (HTTP 302). The older public alias was still HTTP 200.
- Cause: the project retained `ssoProtection: all_except_custom_domains`; the new `*.vercel.app`
  alias was protected instead of behaving as the public demo URL.
- Ran `vercel project protection disable skku-dule --sso`. The project now has no SSO deployment
  protection, while Git-fork protection remains enabled. The new canonical alias and direct
  production URL both return HTTP 200.

## Reconnected / verified

- Vercel project identity: same project ID, same Git-backed project, same `web` root directory,
  build/install settings, and existing encrypted `UPSTAGE_API_KEY`, `BLOB_READ_WRITE_TOKEN`, and
  `GEMINI_API_KEY` environment variables.
- Public canonical alias: `https://skku-dule.vercel.app` points to production deployment
  `dpl_BMyJU9ipsHoXmzT665oTXcCbymWH` and is public.
- Existing old alias: `https://timetable-with-upstage.vercel.app` is intentionally retained as a
  backward-compatible alias and points to the same latest production deployment.
- HTML metadata: title, description, canonical URL, Open Graph title/description/URL/site name,
  Twitter title/description/image all now use the new host/name.
- Generated metadata assets: `/opengraph-image` (PNG), `/icon` (favicon PNG), and `/apple-icon`
  (Apple touch icon PNG) all return HTTP 200 from the new domain.
- Discoverability: `/robots.txt` exposes the new-domain sitemap and `/sitemap.xml` lists the
  new canonical URL.
- Analytics: the live root still contains the existing GA4 and Microsoft Clarity script hooks.
- App-generated share links read `SITE_URL`, so new share links now use `skku-dule.vercel.app`.
- Everytime extension host permissions and documentation target the new domain; a locally loaded
  extension needs one reload so Chrome/Edge accepts the changed manifest permissions.
- Current operational documentation and GA4 UTM distribution links now use the new URL.

## Verification

- `curl -I` checked new canonical, legacy alias, and latest deployment URLs.
- Live root metadata and five generated routes were fetched from `https://skku-dule.vercel.app`.
- `vercel project inspect`, `vercel env ls`, `vercel alias ls`, and `vercel project protection`
  confirmed project continuity, encrypted environment variables, aliases, and public access.
- `git diff --check` passed (only existing CRLF-normalization warnings).

## Deliberately unchanged

- Historical deployment entries in older logs and handoff records keep their original old URLs.
- No source code logic changed in this follow-up; only operational Vercel settings and active
  documentation links were updated.
- No Git commit or push was created.
