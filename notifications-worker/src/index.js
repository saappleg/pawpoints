/**
 * Pet Care by Steven notification gateway.
 *
 * This Worker is intentionally separate from the GitHub Pages site. It keeps
 * the OneSignal App API key server-side, verifies Firebase ID tokens, and is
 * the only code permitted to send remote push notifications.
 */

const ALLOWED_ORIGIN = 'https://petcarebysteven.me';
const FIREBASE_PROJECT_ID = 'paw-points-app';
const FIREBASE_PUBLIC_KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 240;
const MAX_URL_LENGTH = 500;
const MAX_IMAGE_URL_LENGTH = 1000;
const MAX_CUSTOM_DATA_BYTES = 1800;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

function cleanUrl(value) {
  const raw = cleanText(value, MAX_URL_LENGTH);
  if (raw.startsWith('/')) return `https://petcarebysteven.me${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new Error('Notification destinations must be a site path or HTTPS URL.');
  }
}

function cleanHttpsUrl(value, fieldName) {
  const raw = cleanText(value, MAX_IMAGE_URL_LENGTH);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${fieldName} must be a public HTTPS URL.`);
  }
}

function cleanButtons(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((button, index) => {
    const text = cleanText(button?.text, 30);
    if (!text) throw new Error(`Button ${index + 1} needs a label.`);
    return {
      id: cleanText(button?.id, 40) || `action_${index + 1}`,
      text,
      url: cleanUrl(button?.url || '/?view=home'),
      ...(button?.icon ? { icon: cleanHttpsUrl(button.icon, `Button ${index + 1} icon`) } : {})
    };
  });
}

function cleanCustomData(value) {
  if (value == null || value === '') return {};
  let data = value;
  if (typeof value === 'string') {
    try { data = JSON.parse(value); } catch { throw new Error('Custom data must be valid JSON.'); }
  }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Custom data must be a JSON object.');
  const encoded = JSON.stringify(data);
  if (new TextEncoder().encode(encoded).length > MAX_CUSTOM_DATA_BYTES) {
    throw new Error('Custom data is too large. Keep it under 1.8 KB.');
  }
  return data;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Please send valid JSON.');
  }
}

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function jwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

async function firebaseUser(request) {
  const authorization = request.headers.get('Authorization') || '';
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!idToken) throw new Error('Sign in is required.');

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Your sign-in has expired. Please sign in again.');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = jwtPart(headerPart);
  const payload = jwtPart(payloadPart);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Your sign-in token is invalid. Please sign in again.');

  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
  if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== expectedIssuer ||
      typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
      !Number.isFinite(payload.exp) || payload.exp <= now || !Number.isFinite(payload.iat) || payload.iat > now ||
      !Number.isFinite(payload.auth_time) || payload.auth_time > now) {
    throw new Error('Your sign-in has expired. Please sign in again.');
  }

  const response = await fetch(FIREBASE_PUBLIC_KEYS_URL);
  const keySet = await response.json();
  const key = keySet.keys?.find(candidate => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!response.ok || !key) throw new Error('Unable to verify your sign-in. Please try again.');
  const publicKey = await crypto.subtle.importKey(
    'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', publicKey, base64UrlBytes(signaturePart), new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  if (!valid) throw new Error('Your sign-in token is invalid. Please sign in again.');
  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email.toLowerCase() : '' };
}

function isAdmin(user, env) {
  const allowed = (env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(user.email);
}

async function requireAdmin(request, env) {
  const user = await firebaseUser(request);
  if (!isAdmin(user, env)) throw new Error('Admin access is required.');
  return user;
}

async function sendOneSignal(env, { title, body, url, externalIds, data = {}, options = {} }) {
  const payload = {
    app_id: env.ONESIGNAL_APP_ID,
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    url: cleanUrl(url || '/?view=home'),
    data: { ...data, source: 'pet-care-portal' }
  };

  if (options.imageUrl) payload.chrome_web_image = options.imageUrl;
  if (options.iconUrl) payload.chrome_web_icon = options.iconUrl;
  if (options.buttons?.length) payload.web_buttons = options.buttons;
  if (options.collapseId) payload.collapse_id = options.collapseId;
  if (options.ttl) payload.ttl = options.ttl;
  if (options.priority === 'high') payload.priority = 10;
  if (options.sendAfter) payload.send_after = options.sendAfter;
  payload.idempotency_key = crypto.randomUUID();

  if (externalIds?.length) {
    payload.include_aliases = { external_id: externalIds };
  } else {
    // "Subscribed Users" is OneSignal's built-in segment for an all-client push.
    payload.included_segments = ['Subscribed Users'];
  }

  const response = await fetch('https://api.onesignal.com/notifications?c=push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${env.ONESIGNAL_APP_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  const noRecipients = response.ok && !result.id;
  if (noRecipients) {
    return { id: null, recipients: 0, noRecipients: true };
  }
  if (!response.ok || result.errors) {
    console.error('OneSignal send failed', result);
    throw new Error(result.errors?.[0] || result.errors || 'OneSignal could not send the notification.');
  }
  return result;
}

function notificationFields(body) {
  const title = cleanText(body.title, MAX_TITLE_LENGTH);
  const message = cleanText(body.body, MAX_BODY_LENGTH);
  if (!title || !message) throw new Error('A title and message are required.');
  return { title, body: message, url: cleanUrl(body.url || '/?view=home') };
}

function notificationOptions(body) {
  const imageUrl = cleanHttpsUrl(body.imageUrl, 'Large image');
  const iconUrl = cleanHttpsUrl(body.iconUrl, 'Notification icon');
  const collapseId = cleanText(body.collapseId, 64).replace(/[^a-zA-Z0-9._-]/g, '-');
  const ttlHours = Number(body.ttlHours || 72);
  if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 720) {
    throw new Error('Expiration must be between 1 and 720 hours.');
  }
  let sendAfter = '';
  if (body.sendAt) {
    const date = new Date(body.sendAt);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 60 * 1000) {
      throw new Error('Choose a future delivery time.');
    }
    sendAfter = date.toISOString();
  }
  return {
    imageUrl,
    iconUrl,
    buttons: cleanButtons(body.buttons),
    collapseId,
    ttl: Math.round(ttlHours * 60 * 60),
    priority: body.priority === 'high' ? 'high' : 'normal',
    sendAfter
  };
}

async function audit(env, values) {
  await env.DB.prepare(
    'INSERT INTO notification_audit (id, actor_uid, audience, title, created_at, onesignal_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), values.actorUid, values.audience, values.title, new Date().toISOString(), values.oneSignalId || null).run();
}

async function sendImmediate(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const message = notificationFields(body);
  const options = notificationOptions(body);
  const audience = body.audience === 'client' ? 'client' : 'all';
  const clientUid = cleanText(body.clientUid, 128);
  if (audience === 'client' && !clientUid) throw new Error('Choose a client.');

  const result = await sendOneSignal(env, {
    ...message,
    externalIds: audience === 'client' ? [clientUid] : undefined,
    data: { ...cleanCustomData(body.customData), type: cleanText(body.notificationType, 40) || 'admin_message' },
    options
  });
  await audit(env, { actorUid: admin.uid, audience, title: message.title, oneSignalId: result.id });
  return json({
    ok: true,
    id: result.id,
    recipients: result.recipients || 0,
    noRecipients: Boolean(result.noRecipients),
    scheduledFor: options.sendAfter || null
  });
}

async function scheduleReminder(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const message = notificationFields(body);
  const clientUid = cleanText(body.clientUid, 128);
  const sendAt = new Date(body.sendAt);
  if (!clientUid) throw new Error('Choose a client.');
  if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() + 60 * 1000) {
    throw new Error('Choose a future reminder time.');
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO scheduled_notifications (id, client_uid, title, body, url, send_at, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, clientUid, message.title, message.body, message.url, sendAt.toISOString(), 'pending', admin.uid, new Date().toISOString()).run();
  return json({ ok: true, id, scheduledFor: sendAt.toISOString() }, 201);
}

async function listReminders(request, env) {
  await requireAdmin(request, env);
  const reminders = await env.DB.prepare(
    "SELECT id, client_uid, title, body, send_at, status, created_at FROM scheduled_notifications WHERE status = 'pending' ORDER BY send_at ASC LIMIT 50"
  ).all();
  return json({ ok: true, reminders: reminders.results || [] });
}

async function cancelReminder(request, env) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const id = cleanText(body.id, 64);
  if (!id) throw new Error('A reminder ID is required.');
  const result = await env.DB.prepare(
    "UPDATE scheduled_notifications SET status = 'cancelled' WHERE id = ? AND status = 'pending'"
  ).bind(id).run();
  if (!result.meta?.changes) throw new Error('That reminder is no longer pending.');
  return json({ ok: true });
}

function templatePayload(value) {
  const message = notificationFields(value || {});
  const options = notificationOptions({ ...(value || {}), sendAt: '' });
  return {
    title: message.title,
    body: message.body,
    url: message.url,
    imageUrl: options.imageUrl,
    iconUrl: options.iconUrl,
    priority: options.priority,
    ttlHours: Math.round(options.ttl / 3600),
    collapseId: options.collapseId,
    buttons: options.buttons,
    customData: JSON.stringify(cleanCustomData(value?.customData)),
    notificationType: cleanText(value?.notificationType, 40) || 'admin_message'
  };
}

async function listNotificationTemplates(request, env) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare(
    'SELECT id, name, payload_json, created_at, updated_at FROM notification_templates ORDER BY name COLLATE NOCASE ASC LIMIT 100'
  ).all();
  const templates = (result.results || []).map(row => ({
    id: row.id,
    name: row.name,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return json({ ok: true, templates });
}

async function saveNotificationTemplate(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const name = cleanText(body.name, 60);
  if (!name) throw new Error('Enter a template name.');
  const payload = templatePayload(body.template);
  const id = cleanText(body.id, 64) || crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO notification_templates (id, name, payload_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, payload_json = excluded.payload_json,
       updated_at = excluded.updated_at WHERE created_by = excluded.created_by`
  ).bind(id, name, JSON.stringify(payload), admin.uid, now, now).run();
  return json({ ok: true, id, name, payload }, body.id ? 200 : 201);
}

async function deleteNotificationTemplate(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const id = cleanText(body.id, 64);
  if (!id) throw new Error('A template ID is required.');
  const result = await env.DB.prepare(
    'DELETE FROM notification_templates WHERE id = ? AND created_by = ?'
  ).bind(id, admin.uid).run();
  if (!result.meta?.changes) throw new Error('That template was not found.');
  return json({ ok: true });
}

async function sendSelfReward(request, env) {
  const user = await firebaseUser(request);
  const body = await readJson(request);
  const couponCode = cleanText(body.couponCode, 32);
  const rewardTitle = cleanText(body.rewardTitle, 80) || 'Your Paw Points reward';
  if (!/^PAW-[A-Z0-9]{8}$/.test(couponCode)) throw new Error('Invalid reward code.');

  const result = await sendOneSignal(env, {
    title: '🎁 Your reward is ready',
    body: `${rewardTitle}: ${couponCode}. Show it when booking.`,
    url: '/?view=loyalty',
    externalIds: [user.uid],
    data: { type: 'reward', couponCode }
  });
  await audit(env, { actorUid: user.uid, audience: 'self', title: 'Reward redeemed', oneSignalId: result.id });
  return json({ ok: true, id: result.id });
}

async function sendPointUpdate(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const clientUid = cleanText(body.clientUid, 128);
  const points = Number(body.points);
  const statusName = cleanText(body.statusName, 60);
  if (!clientUid || !Number.isFinite(points) || points < 0) throw new Error('A client and valid point balance are required.');

  const result = await sendOneSignal(env, {
    title: '🐾 Paw Points updated',
    body: statusName
      ? `You now have ${Math.round(points).toLocaleString()} Paw Points. Your Paw Status: ${statusName}.`
      : `You now have ${Math.round(points).toLocaleString()} Paw Points.`,
    url: '/?view=loyalty',
    externalIds: [clientUid],
    data: { type: statusName ? 'points_and_status' : 'points', points: Math.round(points), statusName }
  });
  await audit(env, { actorUid: admin.uid, audience: 'client', title: 'Paw Points updated', oneSignalId: result.id });
  return json({ ok: true, id: result.id });
}

async function deliverDueReminders(env) {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    "SELECT id, client_uid, title, body, url FROM scheduled_notifications WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC LIMIT 25"
  ).bind(now).all();

  for (const reminder of due.results || []) {
    try {
      const result = await sendOneSignal(env, {
        title: reminder.title,
        body: reminder.body,
        url: reminder.url,
        externalIds: [reminder.client_uid],
        data: { type: 'booking_reminder', reminderId: reminder.id }
      });
      await env.DB.prepare("UPDATE scheduled_notifications SET status = 'sent', sent_at = ?, onesignal_id = ? WHERE id = ?")
        .bind(new Date().toISOString(), result.id || null, reminder.id).run();
    } catch (error) {
      console.error(`Reminder ${reminder.id} failed`, error);
      await env.DB.prepare("UPDATE scheduled_notifications SET status = 'failed', failure_reason = ? WHERE id = ?")
        .bind(cleanText(error.message, 500), reminder.id).run();
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    if (request.headers.get('Origin') && request.headers.get('Origin') !== ALLOWED_ORIGIN) return json({ error: 'Origin not allowed.' }, 403);
    if (request.method !== 'POST') return json({ error: 'Not found.' }, 404);

    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/v1/notifications/send') return await sendImmediate(request, env);
      if (pathname === '/v1/reminders') return await scheduleReminder(request, env);
      if (pathname === '/v1/reminders/list') return await listReminders(request, env);
      if (pathname === '/v1/reminders/cancel') return await cancelReminder(request, env);
      if (pathname === '/v1/notification-templates/list') return await listNotificationTemplates(request, env);
      if (pathname === '/v1/notification-templates/save') return await saveNotificationTemplate(request, env);
      if (pathname === '/v1/notification-templates/delete') return await deleteNotificationTemplate(request, env);
      if (pathname === '/v1/notifications/point-update') return await sendPointUpdate(request, env);
      if (pathname === '/v1/notifications/self-reward') return await sendSelfReward(request, env);
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete the notification request.';
      return json({ error: message }, /required|expired|access|invalid|future|Choose/i.test(message) ? 400 : 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(deliverDueReminders(env));
  }
};
