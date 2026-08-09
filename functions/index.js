const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

exports.notifyOnCarePlanRequest = functions.firestore
  .document('care_plan_requests/{requestId}')
  .onCreate(async (snapshot, context) => {
    const request = snapshot.data() || {};
    const admins = await admin.firestore()
      .collection('clients')
      .where('isAdmin', '==', true)
      .get();

    const tokens = admins.docs
      .map((doc) => doc.data().fcmToken)
      .filter((token) => typeof token === 'string' && token.length > 0);

    if (tokens.length === 0) {
      console.log('No administrator notification tokens are registered.');
      return null;
    }

    const requester = typeof request.name === 'string' && request.name.trim()
      ? request.name.trim()
      : 'a new client';

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: 'New care plan request',
        body: `${requester} submitted a personalized care-plan request.`
      },
      data: {
        type: 'care_plan_request',
        requestId: context.params.requestId
      },
      webpush: {
        notification: {
          icon: 'https://petcarebysteven.me/android-chrome-192x192.webp'
        },
        fcmOptions: {
          link: 'https://petcarebysteven.me/?view=loyalty'
        }
      }
    });

    console.log(`Sent ${response.successCount} care-plan notification(s).`);
    return null;
  });
