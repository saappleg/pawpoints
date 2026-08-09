# Free site-owner checklist

These are the remaining account-side steps after publishing the website and Firestore rules.

## Firebase

1. Open **Firestore Database → Rules**, paste the contents of `firestore.rules`, then publish it.
2. Open **Firestore Database → Data → admins** and create a document whose ID is your Firebase Authentication user UID. Set `enabled` to the Boolean value `true`.
3. Sign out and back in. The Admin Workspace will be visible only to users with that `admins/<uid>` document.
4. Test a new account with a referral code. The new account gets its welcome coupon and a pending referral appears in **Admin Workspace → Referrals**. Award the 1,000 points there after you verify the referral.
5. Test a reward redemption with a non-admin account. It should deduct the correct point amount and add a matching coupon immediately.

## Email notifications

1. In FormSubmit, complete its one-time confirmation for `support@petcarebysteven.me` if it asks.
2. Submit one real care-plan test from the published website. A successful submission arrives at that inbox; no Firebase Functions or paid Firebase plan is involved.
3. Keep the `2a94e5ab8462bbb1aa7530d6568457f3` endpoint private. It is intentionally used instead of publishing a raw email address in the form action.

## Google visibility

1. In Google Search Console, add and verify `petcarebysteven.me`, then submit `https://petcarebysteven.me/sitemap.xml`.
2. Claim or update the Google Business Profile: exact name, service area, phone, website, hours, services, and a few current photos.
3. After publishing, use Search Console’s URL Inspection tool on the homepage and request indexing.

## Monthly quality check

The GitHub Actions workflow runs on the first day of each month and saves a Lighthouse report as a GitHub Actions artifact. You can also run it anytime from **Actions → Monthly site quality report → Run workflow**. This uses GitHub Actions, so it draws from any Actions allowance attached to the repository account.
