// Cloudflare Worker — forwards lead-form submissions to Telegram + Bitrix24 CRM
//
// Required environment variables (Settings → Variables and Secrets):
//   TELEGRAM_BOT_TOKEN   — full bot token from @BotFather
//   TELEGRAM_CHAT_ID     — numeric chat ID where notifications should arrive
//   BITRIX_WEBHOOK_URL   — full inbound-webhook URL ending with a slash, e.g.
//                          https://td-group.bitrix24.eu/rest/1/xxxxxxx/

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, corsHeaders);
    }

    let data = {};
    const ct = request.headers.get('content-type') || '';
    try {
      if (ct.includes('application/json')) {
        data = await request.json();
      } else {
        const fd = await request.formData();
        data = Object.fromEntries(fd);
      }
    } catch (e) {
      return json({ ok: false, error: 'bad body' }, 400, corsHeaders);
    }

    // Honeypot — silently accept and discard
    if ((data._honey || '').toString().trim()) {
      return json({ ok: true }, 200, corsHeaders);
    }

    const name = (data['Imię i Nazwisko'] || data.name || '').toString().trim();
    const phone = (data['Telefon'] || data.phone || '').toString().trim();
    const email = (data['E-mail'] || data.email || '').toString().trim();
    const message = (data['Wiadomość'] || data.message || '').toString().trim();

    if (!name || !phone || !email) {
      return json({ ok: false, error: 'missing required fields' }, 400, corsHeaders);
    }

    const errors = [];

    // 1) Telegram notification
    try {
      const tgText =
        `🆕 <b>Nowe zapytanie z generatora dokumentów</b>\n\n` +
        `👤 <b>Imię i Nazwisko:</b> ${esc(name)}\n` +
        `📞 <b>Telefon:</b> ${esc(phone)}\n` +
        `📧 <b>E-mail:</b> ${esc(email)}` +
        (message ? `\n\n💬 <b>Wiadomość:</b>\n${esc(message)}` : '');

      const tgRes = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: tgText,
            parse_mode: 'HTML',
          }),
        },
      );
      if (!tgRes.ok) errors.push(`telegram_http_${tgRes.status}`);
    } catch (e) {
      errors.push('telegram_exception');
    }

    // 2) Bitrix24 lead
    try {
      const [firstName, ...lastParts] = name.split(/\s+/);
      const lastName = lastParts.join(' ');
      const base = env.BITRIX_WEBHOOK_URL.endsWith('/')
        ? env.BITRIX_WEBHOOK_URL
        : env.BITRIX_WEBHOOK_URL + '/';
      const fields = {
        TITLE: `Zapytanie z generatora dokumentów: ${name}`,
        NAME: firstName,
        LAST_NAME: lastName,
        SOURCE_ID: 'WEB',
        SOURCE_DESCRIPTION: 'Generator dokumentów spółki (td-group)',
        COMMENTS: message,
      };
      if (phone) fields.PHONE = [{ VALUE: phone, VALUE_TYPE: 'WORK' }];
      if (email) fields.EMAIL = [{ VALUE: email, VALUE_TYPE: 'WORK' }];
      const bxRes = await fetch(base + 'crm.lead.add.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      if (!bxRes.ok) errors.push(`bitrix_http_${bxRes.status}`);
    } catch (e) {
      errors.push('bitrix_exception');
    }

    return json({ ok: errors.length === 0, errors }, 200, corsHeaders);
  },
};

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
