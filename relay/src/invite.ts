// The page behind an invite link (https://…/join/<CODE>): it opens Serpentine on the room (serpentine://join/<CODE>,
// registered by the Mac app), and says how to get the app or type the code when that doesn't work.

import type { RoomInfo } from '../../src/net/protocol.ts';

const DOWNLOAD = 'https://github.com/chrisperkles/serpentine/releases/latest';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function invitePage(code: string, info: RoomInfo | null): string {
  const app = `serpentine://join/${code}`;
  const what = info?.mode === 'race' ? 'race' : 'group ride';
  const title = info
    ? info.host
      ? `${esc(info.host)} invites you to a ${what} on ${esc(info.route)}`
      : `A ${what} on ${esc(info.route)}`
    : 'This group ride is over';
  const sub = info
    ? `${info.riders === 1 ? '1 rider' : `${info.riders} riders`} in the room${info.started ? ', already riding: you start next to the group' : ', waiting at the start'}.`
    : 'Nobody has been in it for a while, so it is gone. Ask for a new link.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${info ? `Ride ${esc(info.route)} together` : 'Serpentine'}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1b24; color: #eef3f4;
    font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width: 520px; padding: 32px 24px; }
  .brand { font-weight: 800; font-style: italic; letter-spacing: 0.01em; color: #8fa3ad; }
  h1 { font-size: 30px; line-height: 1.15; margin: 18px 0 8px; }
  p { color: #c4d0d5; margin: 0 0 14px; }
  .code { font: 800 44px/1 ui-monospace, Menlo, monospace; letter-spacing: 0.14em; color: #ffc93c; margin: 18px 0; }
  a.btn { display: inline-block; padding: 12px 20px; border-radius: 6px; background: #ffc93c; color: #0d1b24; font-weight: 700;
    text-decoration: none; margin: 6px 10px 6px 0; }
  a.ghost { background: transparent; color: #eef3f4; box-shadow: inset 0 0 0 1px rgba(238, 243, 244, 0.3); }
  small { color: #8fa3ad; }
</style>
</head>
<body>
<main>
  <div class="brand">Serpentine</div>
  <h1>${title}</h1>
  <p>${sub}</p>
  ${info ? `<div class="code">${code}</div>
  <a class="btn" href="${app}">Open in Serpentine</a>
  <a class="btn ghost" href="${DOWNLOAD}">Get Serpentine for Mac</a>
  <p><small>If the app doesn't open: start Serpentine, choose <b>Ride together</b>, then <b>Join</b>, and type the code.
  You need your own smart trainer and a Mac with Apple silicon.</small></p>
  <script>setTimeout(function () { location.href = ${JSON.stringify(app)}; }, 300);</script>` : ''}
</main>
</body>
</html>
`;
}
