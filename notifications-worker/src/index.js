/**
 * Pet Care by Steven notification gateway.
 *
 * This Worker is intentionally separate from the GitHub Pages site. It keeps
 * the OneSignal App API key server-side, verifies Firebase ID tokens, and is
 * the only code permitted to send remote push notifications.
 */

const ALLOWED_ORIGIN = 'https://petcarebysteven.me';
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 240;
const MAX_URL_LENGTH = 500;

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
  const url = cleanText(value, MAX_URL_LENGTH);
  return url.startsWith('/') ? `https://petcarebysteven.me${url}` : url;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Please send valid JSON.');
  }
}

async function firebaseUser(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!idToken) throw new Error('Sign in is required.');

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  const data = await response.json();
  const user = data.users?.[0];
  if (!response.ok || !user?.localId || !user?.email) throw new Error('Your sign-in has expired. Please sign in again.');
  return { uid: user.localId, email: user.email.toLowerCase() };
}

function isAdmin(user, env) {
  const allowed = (env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(user.email);
}

async function requireAdmin(request, env) {
  const user = await firebaseUser(request, env);
  if (!isAdmin(user, env)) throw new Error('Admin access is required.');
  return user;
}

async function sendOneSignal(env, { title, body, url, externalIds, data = {} }) {
  const payload = {
    app_id: env.ONESIGNAL_APP_ID,
    headings: { en: title },
    contents: { en: body },
    url: cleanUrl(url || '/?view=home'),
    data: { source: 'pet-care-portal', ...data }
  };

  if (externalIds?.length) {
    payload.include_aliases = { external_id: externalIds };
    payload.target_channel = 'push';
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

async function audit(env, values) {
  await env.DB.prepare(
    'INSERT INTO notification_audit (id, actor_uid, audience, title, created_at, onesignal_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), values.actorUid, values.audience, values.title, new Date().toISOString(), values.oneSignalId || null).run();
}

async function sendImmediate(request, env) {
  const admin = await requireAdmin(request, env);
  const body = await readJson(request);
  const message = notificationFields(body);
  const audience = body.audience === 'client' ? 'client' : 'all';
  const clientUid = cleanText(body.clientUid, 128);
  if (audience === 'client' && !clientUid) throw new Error('Choose a client.');

  const result = await sendOneSignal(env, {
    ...message,
    externalIds: audience === 'client' ? [clientUid] : undefined,
    data: { type: 'admin_message' }
  });
  await audit(env, { actorUid: admin.uid, audience, title: message.title, oneSignalId: result.id });
  return json({ ok: true, id: result.id, recipients: result.recipients || 0 });
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

async function sendSelfReward(request, env) {
  const user = await firebaseUser(request, env);
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
  if (!clientUid || !Number.isFinite(points) || points < 0) throw new Error('A client and valid point balance are required.');

  const result = await sendOneSignal(env, {
    title: '🐾 Paw Points updated',
    body: `You now have ${Math.round(points).toLocaleString()} Paw Points.`,
    url: '/?view=loyalty',
    externalIds: [clientUid],
    data: { type: 'points', points: Math.round(points) }
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
