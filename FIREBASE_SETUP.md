# Firebase setup checklist

## Secure administrator access

The website now determines administrator access from an `admins` collection instead of an email address.

1. In Firebase Authentication, copy the UID for your administrator account.
2. In Cloud Firestore, create the document `admins/<that-uid>`.
3. Give it this data:

```json
{
  "enabled": true
}
```

4. Add this narrow rule to your existing Firestore rules before publishing the site. It allows each signed-in person to check only their own role and prevents browser clients from granting roles:

```
match /admins/{userId} {
  allow get: if request.auth != null && request.auth.uid == userId;
  allow list, create, update, delete: if false;
}
```

Do not add `isAdmin` to client profile documents and do not use an email-address check as a role check.

## App Check

The old App Check key was invalid and caused a 404 error, so its browser initialization was removed. To enable App Check again:

1. Open Firebase Console → App Check and register `petcarebysteven.me` with reCAPTCHA Enterprise or reCAPTCHA v3.
2. Monitor requests before enabling enforcement.
3. Send the new public site key here so it can be added to the app safely.

## Firestore rules

The included `firestore.rules` file replaces the insecure email-based admin test and prevents clients from reading other clients' private details or changing loyalty points directly.

Referral codes continue to work through the `referral_codes` collection. When a new person signs up with a valid code, the site creates a `referral_claims/<new-client-uid>` document with `status: "pending"`. Review the claim and award the referral points in the admin points panel. This manual step prevents a browser user from giving themselves unlimited points.
