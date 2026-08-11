import { initializeApp } from 'firebase/app';
import {
    GoogleAuthProvider, createUserWithEmailAndPassword, getAuth, onAuthStateChanged,
    reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword,
    signInWithPopup, signOut, updateEmail, useDeviceLanguage
} from 'firebase/auth';
import {
    addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, limit,
    onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where
} from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

const externalScriptLoads = new Map();

function loadExternalScript(src, id) {
    if (externalScriptLoads.has(src)) return externalScriptLoads.get(src);
    const existing = id ? document.getElementById(id) : null;
    const load = new Promise((resolve, reject) => {
        if (existing) {
            if (existing.dataset.loaded === 'true') return resolve();
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        if (id) script.id = id;
        script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
        script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
        document.head.appendChild(script);
    });
    externalScriptLoads.set(src, load);
    return load;
}

function loadExternalStylesheet(href, id) {
    const existing = id ? document.getElementById(id) : null;
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        if (id) link.id = id;
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', () => reject(new Error(`Could not load ${href}`)), { once: true });
        document.head.appendChild(link);
    });
}

let leafletReady;
function ensureLeafletLoaded() {
    if (window.L) return Promise.resolve(window.L);
    if (!leafletReady) {
        leafletReady = Promise.all([
            loadExternalStylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'leaflet-styles'),
            loadExternalScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet-script')
        ]).then(() => window.L);
    }
    return leafletReady;
}

const observedMapElements = new WeakSet();

function loadMapWhenVisible(elementId, initialize) {
    const element = document.getElementById(elementId);
    if (!element || observedMapElements.has(element)) return;
    observedMapElements.add(element);

    if (!('IntersectionObserver' in window)) {
        initialize();
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        initialize();
    }, { rootMargin: '300px 0px' });
    observer.observe(element);
}

const firebaseConfig = {
    apiKey: "AIzaSyAByvA8nPtXzfrQpkoh5XrBu9k3UdPzO7E",
    authDomain: "paw-points-app.firebaseapp.com",
    projectId: "paw-points-app",
    storageBucket: "paw-points-app.appspot.com",
    messagingSenderId: "252239990659",
    appId: "1:252239990659:web:627f4bd85785e0bdcfb0b6",
    measurementId: "G-6MPSER0Z6L"
};

function decorateUser(user) {
    if (!user || user.__pawPointsDecorated) return user;
    Object.defineProperties(user, {
        __pawPointsDecorated: { value: true },
        sendEmailVerification: { value: () => sendEmailVerification(user) },
        updateEmail: { value: (email) => updateEmail(user, email) },
        reload: { value: () => reload(user) }
    });
    return user;
}

function wrapDocumentSnapshot(snapshot) {
    return {
        id: snapshot.id,
        exists: snapshot.exists(),
        data: () => snapshot.data(),
        ref: new DocumentReferenceCompat(snapshot.ref)
    };
}

function wrapQuerySnapshot(snapshot) {
    return {
        docs: snapshot.docs.map(wrapDocumentSnapshot),
        empty: snapshot.empty,
        size: snapshot.size,
        docChanges: () => snapshot.docChanges().map(change => ({ ...change, doc: wrapDocumentSnapshot(change.doc) }))
    };
}

class QueryCompat {
    constructor(reference) { this.reference = reference; }
    where(field, operator, value) { return new QueryCompat(query(this.reference, where(field, operator, value))); }
    orderBy(field, direction) { return new QueryCompat(query(this.reference, orderBy(field, direction))); }
    limit(count) { return new QueryCompat(query(this.reference, limit(count))); }
    async get() { return wrapQuerySnapshot(await getDocs(this.reference)); }
    onSnapshot(next, error) {
        const wrappedNext = snapshot => next(wrapQuerySnapshot(snapshot));
        return error ? onSnapshot(this.reference, wrappedNext, error) : onSnapshot(this.reference, wrappedNext);
    }
}

class CollectionReferenceCompat extends QueryCompat {
    doc(id) { return new DocumentReferenceCompat(doc(this.reference, id)); }
    async add(data) { return new DocumentReferenceCompat(await addDoc(this.reference, data)); }
}

class DocumentReferenceCompat {
    constructor(reference) { this.reference = reference; this.id = reference.id; }
    collection(name) { return new CollectionReferenceCompat(collection(this.reference, name)); }
    async get() { return wrapDocumentSnapshot(await getDoc(this.reference)); }
    set(data, options) { return options ? setDoc(this.reference, data, options) : setDoc(this.reference, data); }
    update(data) { return updateDoc(this.reference, data); }
    delete() { return deleteDoc(this.reference); }
}

class FirestoreCompat {
    constructor(instance) { this.instance = instance; }
    collection(name) { return new CollectionReferenceCompat(collection(this.instance, name)); }
}

class AuthCompat {
    constructor(instance) { this.instance = instance; }
    get currentUser() { return decorateUser(this.instance.currentUser); }
    useDeviceLanguage() { useDeviceLanguage(this.instance); }
    onAuthStateChanged(next, error) {
        const wrappedNext = user => next(decorateUser(user));
        return error ? onAuthStateChanged(this.instance, wrappedNext, error) : onAuthStateChanged(this.instance, wrappedNext);
    }
    async createUserWithEmailAndPassword(email, password) {
        const result = await createUserWithEmailAndPassword(this.instance, email, password);
        decorateUser(result.user);
        return result;
    }
    async signInWithEmailAndPassword(email, password) {
        const result = await signInWithEmailAndPassword(this.instance, email, password);
        decorateUser(result.user);
        return result;
    }
    async signInWithPopup(provider) {
        const result = await signInWithPopup(this.instance, provider);
        decorateUser(result.user);
        return result;
    }
    sendPasswordResetEmail(email) { return sendPasswordResetEmail(this.instance, email); }
    signOut() { return signOut(this.instance); }
}

const firebaseApp = initializeApp(firebaseConfig);
const auth = new AuthCompat(getAuth(firebaseApp));
const db = new FirestoreCompat(getFirestore(firebaseApp));
window.firebase = {
    auth: { GoogleAuthProvider },
    firestore: { FieldValue: { serverTimestamp } }
};

try {
    initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaEnterpriseProvider('6LfkzXUtAAAAAGy2tNXRRI87aF-sjqMaSMEcblh0'),
        isTokenAutoRefreshEnabled: true
    });
} catch (err) {
    console.warn('App Check is not active yet:', err.message);
}

auth.useDeviceLanguage();

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa-install-ready'));
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => reg.update())
            .catch(err => console.log('Service Worker failed:', err));
    });
}

function firePwaNotification(title, body, options = {}) {
    if (window.Notification && Notification.permission === 'granted') {
        const notificationOptions = {
            body: body,
            icon: 'android-chrome-192x192.webp',
            badge: 'android-chrome-192x192.webp',
            tag: options.tag || 'pet-care-update',
            renotify: false,
            data: { url: options.url || '/?view=home' }
        };
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(registration => {
                // A notification tag replaces an older update of the same kind instead of stacking duplicates.
                registration.getNotifications({ tag: notificationOptions.tag }).then(notifications => {
                    notifications.forEach(notification => notification.close());
                    return registration.showNotification(title, notificationOptions);
                });
            });
        } else {
            new Notification(title, notificationOptions);
        }
    }
}

function triggerViewTransition(callback) {
    if (!document.startViewTransition) {
        callback();
        return;
    }
    document.startViewTransition(() => {
        callback();
    });
}

function pawApp() {
    const params = new URLSearchParams(window.location.search);
    let initialView = params.get('view') || 'home';
    const initialThemePreference = localStorage.getItem('themePreference') || 'system';
    const initialDarkMode = initialThemePreference === 'dark' || (initialThemePreference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (!['home', 'loyalty', 'guide'].includes(initialView)) {
        initialView = 'home';
    }

    return {
        darkMode: initialDarkMode,
        themePreference: initialThemePreference,
        currentView: initialView,
        printMode: '',
        loading: true,
        user: null,
        userData: {},
        isVerified: false,
        isAdmin: false,
        adminModeActive: true,
        isEditingPets: false,
        copiedRef: false,
        showChatWidget: false,
        calcSpend: 150,
        pushEnabled: false,
        oneSignalConfigured: Boolean(window.PET_CARE_ONESIGNAL_APP_ID),
        notificationServiceUrl: (window.PET_CARE_NOTIFICATIONS_URL || '').replace(/\/$/, ''),
        notificationServiceConfigured: Boolean(window.PET_CARE_NOTIFICATIONS_URL),
        quoteForm: { type: 'Walk', duration: 30, pets: 1, visits: 3 },
        carePlanForm: { name: '', email: '', phone: '', source: '', details: '', honey: '', startedAt: Date.now() },
        carePlanStatus: { submitting: false, success: false, message: '' },
        showToast: false,
        toastMessage: '',
        showInstallBanner: false,
        showIOSInstallModal: false,
        showVetAuthModal: false,
        showChecklistModal: false,
        showProfileModal: false,
        profilePanelView: 'menu',
        profilePanelTop: '5rem',
        profilePanelMaxHeight: 'calc(100dvh - 6rem)',
        showAdminModal: false,
        showAddTrailModal: false,
        vetAuthForm: { capAmount: 500, insuranceInfo: '', signature: '', dateSigned: '', isSigned: false },
        houseChecklist: { feedingNotes: '', medicationNotes: '', trashDays: '', mailNotes: '', otherNotes: '' },
        qrBadgeUrl: 'https://www.personalwalkies.com/company/gvyNdU6CsuV02d5LPZa1',
        petBirthdayAlert: false,
        isFirstVisitCompleted: false,
        clientReviewForm: { stars: 5, comment: '' },
        notificationForm: {
            audience: 'all', clientUid: '', title: '', body: '', url: '/?view=home',
            imageUrl: '', iconUrl: '', priority: 'normal', ttlHours: 72,
            collapseId: '', sendAt: '', buttons: [], customData: '', notificationType: 'admin_message'
        },
        notificationSending: false,
        notificationTemplateName: '',
        notificationTemplateSaving: false,
        selectedNotificationTemplateId: '',
        savedNotificationTemplates: [],
        reminderForm: { clientUid: '', sendAt: '', title: 'Pet Care by Steven reminder', body: '', url: '/?view=home' },
        scheduledReminders: [],
        inAppAnnouncementForm: { title: '', body: '' },
        pendingReviews: [],
        bookingNotices: [
            "Weekend sitting dates are limited and often fill first—request your care plan early.",
            "Every visit is personally handled by Steven, so multi-day sitting availability is limited.",
            "Holiday and school-break dates can fill quickly; early requests have the best availability.",
            "Recurring dog-walk time slots are limited to protect reliable, on-time care.",
            "New clients can request a free 30-minute Meet & Greet before their first booking.",
            "Last-minute care may be available when Steven’s existing route allows it.",
            "Booking ahead helps reserve the visit times that best match your pet’s routine.",
            "Paw Points can be redeemed for discounts on future walks and sitting visits."
        ],
        photoGrid: [],
        newPhoto: { url: '', caption: '' },
        faqList: [
            { question: "📅 What is your cancellation policy?", answer: "Clients must cancel at least <strong>3 days before</strong> the scheduled service to avoid a 50% sitting charge. Cancellations within 3 days will be billed at 50% of the scheduled reservation total." },
            { question: "🔑 How do you handle key hand-offs and home access?", answer: "Keys can be placed in a secure lockbox on-site, provided during an initial meet-and-greet, or managed via keypad entry codes stored safely in your encrypted client profile." },
            { question: "🌧️ What happens during extreme weather for walks?", answer: "In cases of heavy thunderstorms, heat advisories, or icy weather, extended outdoor walks are shortened for safety and converted into indoor playtime, potty breaks, and affection." },
            { question: "📱 Will I receive visit updates and photos?", answer: "Yes! Every sitting visit or walk comes with real-time photo updates, arrival/departure logs, and notes regarding feeding or bathroom habits." }
        ],
        newFaq: { question: '', answer: '' },
        zipInput: '',
        serviceResult: null,
        lastLoggedServiceSearch: null,
        authMode: 'login',
        authError: '',
        authSuccess: '',
        authForm: { name: '', email: '', password: '', refCode: '' },
        profileForm: { name: '', email: '', phone: '', address: '', photoUrl: '' },
        profilePhotoFailed: false,
        firstVisitChecklist: { contactReady: false, accessReady: false, petCareReady: false, vetReady: false },
        profileError: '',
        profileSuccess: '',
        clientList: [],
        adminForm: { targetUid: '', pointsDelta: 0, tipAmount: '', couponTitle: '', countsTowardStatus: true, overrideStatusTier: '' },
        adminTab: 'points',
        pendingReferrals: [],
        trailReports: [],
        serviceAreas: [],
        serviceAreasLastUpdated: 'Service areas last reviewed: August 2026',
        seasonalNotice: { active: false, title: '', message: '' },
        bulkAreaInput: '',
        reviewsList: [],
        newReview: { stars: 5, comment: '', author: '' },
        communityTrails: [
            { id: '1', isStatic: true, title: 'Mount Airy Forest Trails', location: 'Cincinnati, OH', description: 'Extensive wooded paths and historic tree collections. Great for structured sniffing walks!', amenities: 'Shaded, Dirt Trails', petFriendly: 'Dogs welcome on leash', author: 'Steven', votes: 12, upvoters: [] },
            { id: '2', isStatic: true, title: 'Withamsville Park Loop', location: 'Amelia, OH', description: 'Quiet walking loops with good paved paths and open grassy areas.', amenities: 'Paved, Family Friendly', petFriendly: 'Dog friendly', author: 'Local Client', votes: 5, upvoters: [] }
        ],
        newTrailForm: { title: '', location: '', description: '', petFriendly: 'Dog friendly', amenities: [], otherAmenities: '', safety: [], bestTime: '', lat: null, lng: null },
        showTrailMapPicker: false,
        trailMap: null,
        trailMapMarkers: null,
        serviceAreaMap: null,
        serviceAreaLayers: null,
        trailPickerMap: null,
        trailPickerMarker: null,
        trailLocationStatus: '',
        lastTrailGeocodeQuery: '',
        showTrailCommentsModal: false,
        selectedTrail: null,
        trailComments: [],
        trailCommentsLoading: false,
        trailCommentText: '',
        showTrailReportModal: false,
        trailReportForm: { reason: '', details: '' },
        trailsUnsubscribe: null,

        get estimatedQuote() {
            let base = 25;
            if (this.quoteForm.duration === 15) base = 18;
            if (this.quoteForm.duration === 60) base = 40;

            let petFee = (this.quoteForm.pets > 1) ? ((this.quoteForm.pets - 1) * this.additionalPetFee) : 0;
            return (base + petFee) * this.quoteForm.visits;
        },

        get additionalPetFee() {
            return this.quoteForm.type === 'Walk' && this.quoteForm.duration === 60 ? 10 : 5;
        },

        get quoteWhatsAppLink() {
            const msg = encodeURIComponent(`Hi Steven! I used the estimator and I'm interested in ${this.quoteForm.visits} visits a week (${this.quoteForm.duration}-min ${this.quoteForm.type}) for ${this.quoteForm.pets} pet(s).`);
            return `https://wa.me/15133025418?text=${msg}`;
        },

        get tierSeasonYear() {
            return new Date().getFullYear();
        },

        get nextTierSeasonYear() {
            return this.tierSeasonYear + 1;
        },

        tierKeyForPoints(points) {
            const total = Number(points || 0);
            if (total >= 15000) return 'gold';
            if (total >= 5001) return 'silver';
            return 'bronze';
        },

        getClientQualifyingPoints(client) {
            const qualifyingYear = Number(client?.qualifyingYear || this.tierSeasonYear);
            return qualifyingYear === this.tierSeasonYear ? Number(client?.yearlyPoints || 0) : 0;
        },

        getClientTier(client) {
            const key = client?.statusTier || client?.tierLevel || this.tierKeyForPoints(this.getClientQualifyingPoints(client));
            if (key === 'gold') return { key, shortName: 'Gold VIP', name: '🥇 Gold Paw VIP', badgeColor: 'bg-amber-100 text-amber-800 border-amber-300', perk: '1.5x Points Multiplier & Holiday Priority' };
            if (key === 'silver') return { key, shortName: 'Silver', name: '🥈 Silver Paw Member', badgeColor: 'bg-slate-200 text-slate-800 border-slate-400', perk: '1.25x Points Multiplier' };
            return { key: 'bronze', shortName: 'Bronze', name: '🥉 Bronze Paw Member', badgeColor: 'bg-amber-900/20 text-amber-700 border-amber-300', perk: 'Start earning toward next year’s status' };
        },

        get qualifyingPoints() {
            return this.getClientQualifyingPoints(this.userData);
        },

        get clientTier() {
            return this.getClientTier(this.userData);
        },

        get pendingStatusRolloverCount() {
            return this.clientList.filter(client => Number(client.qualifyingYear || this.tierSeasonYear) < this.tierSeasonYear).length;
        },

        get tierProgress() {
            const pts = this.qualifyingPoints;
            if (pts < 5001) {
                const needed = 5001 - pts;
                const pct = Math.min(100, Math.round((pts / 5001) * 100));
                return { currentTierName: 'Bronze progress', nextTierText: `${needed.toLocaleString()} Pts to Silver`, percentage: pct, description: `Earn 5,001 qualifying points by Dec 31, ${this.tierSeasonYear} to unlock Silver status for ${this.nextTierSeasonYear}.` };
            } else if (pts < 15000) {
                const needed = 15000 - pts;
                const pct = Math.min(100, Math.round(((pts - 5001) / (15000 - 5001)) * 100));
                return { currentTierName: 'Silver progress', nextTierText: `${needed.toLocaleString()} Pts to Gold VIP`, percentage: pct, description: `Earn 15,000 qualifying points by Dec 31, ${this.tierSeasonYear} to unlock Gold VIP status for ${this.nextTierSeasonYear}.` };
            } else {
                return { currentTierName: 'Gold VIP secured! 🥇', nextTierText: 'Next year’s top tier reached', percentage: 100, description: `Congratulations! Gold VIP status is secured for ${this.nextTierSeasonYear}.` };
            }
        },

        async init() {
            this.scheduleNextToast();
            // The home page is complete with local fallback content, so show it
            // immediately instead of holding the first render for Firestore reads.
            // This avoids the large visual jump Lighthouse previously measured.
            if (this.currentView === 'home') this.loading = false;
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
                if (this.themePreference === 'system') this.darkMode = event.matches;
            });
            if (this.shouldShowInstallPrompt()) {
                setTimeout(() => { this.showInstallBanner = true; }, 8000);
            }
            await this.loadSeasonalNotice();
            await this.loadServiceAreasFromFirestore();
            await this.loadApprovedReviews();
            await this.loadGalleryPhotosFromFirestore();
            await this.loadCommunityTrails();

            if (this.currentView === 'guide') {
                this.$nextTick(() => loadMapWhenVisible('trail-map', () => this.initTrailMap()));
            }
            if (this.currentView === 'home') {
                this.$nextTick(() => loadMapWhenVisible('service-area-map', () => this.initServiceAreaMap()));
            }

            this.$watch('currentView', (value) => {
                const url = new URL(window.location);
                url.searchParams.set('view', value);
                window.history.pushState({}, '', url);
                if (value === 'guide') this.$nextTick(() => loadMapWhenVisible('trail-map', () => this.initTrailMap()));
                if (value === 'home') this.$nextTick(() => loadMapWhenVisible('service-area-map', () => this.initServiceAreaMap()));
            });

            window.addEventListener('popstate', () => {
                const stateParams = new URLSearchParams(window.location.search);
                const view = stateParams.get('view') || 'home';
                if (['home', 'loyalty', 'guide'].includes(view)) {
                    this.currentView = view;
                }
            });

            window.addEventListener('afterprint', () => {
                this.printMode = '';
            });

            window.addEventListener('pwa-install-ready', () => {
                if (this.shouldShowInstallPrompt()) this.showInstallBanner = true;
            });

            db.collection('broadcasts')
                .orderBy('timestamp', 'desc')
                .limit(1)
                .onSnapshot((snapshot) => {
                    snapshot.docChanges().forEach((change) => {
                        if (change.type === 'added') {
                            const data = change.doc.data();
                            const docTime = data.timestamp ? data.timestamp.toDate() : new Date();
                            if (new Date() - docTime < 60000) {
                                 this.showPersonalNotification(data.title || 'An update from Steven', data.body || '', 'broadcast');
                            }
                        }
                    });
                }, err => console.log('Broadcast listener notice:', err));

            auth.onAuthStateChanged(async (u) => {
                this.user = u;
                const urlParams = new URLSearchParams(window.location.search);
                const refParam = urlParams.get('ref');
                const targetClientUid = urlParams.get('client');

                if (u) {
                    await u.reload();
                    const isGoogleUser = u.providerData.some(p => p.providerId === 'google.com');
                    this.isVerified = u.emailVerified || isGoogleUser;

                    if (this.isVerified) {
                        await this.fetchUserData(u.uid);
                        await this.identifyOneSignalUser();

                        if (targetClientUid && this.isAdmin) {
                            this.currentView = 'loyalty';
                            await this.fetchClientsList();
                            this.adminForm.targetUid = targetClientUid;
                            this.openAdminModal('points');
                        }

                        // A legacy Firebase token is not evidence of a OneSignal subscription.
                        if (!this.oneSignalConfigured && this.userData.fcmToken) {
                            this.pushEnabled = true;
                        }
                    }
                } else {
                    this.userData = {};
                    this.isVerified = false;
                    this.isAdmin = false;
                    this.pushEnabled = false;

                    if (refParam) {
                        this.currentView = 'loyalty';
                        this.authMode = 'signup';
                        this.authForm.refCode = refParam.toUpperCase();
                    }
                }
                this.loading = false;
            });
        },

        triggerFridgePrint() {
            this.printMode = 'fridge';
            this.$nextTick(() => {
                window.print();
            });
        },

        printNewClientChecklist() {
            this.printMode = 'new-client';
            this.$nextTick(() => {
                window.print();
            });
        },

        trackEvent(name, params = {}) {
            if (typeof window.gtag !== 'function') return;
            try {
                window.gtag('event', name, params);
            } catch (err) {
                // Analytics must never interrupt a care-plan request or navigation.
                console.debug('Analytics event skipped:', name);
            }
        },

        async fireConfetti() {
            try {
                await loadExternalScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js', 'canvas-confetti-sdk');
            } catch (err) {
                console.debug('Celebration effect unavailable:', err.message);
                return;
            }
            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 150,
                    spread: 70,
                    origin: { y: 0.6 },
                    colors: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#3b82f6'],
                    zIndex: 9999
                });
            }
        },

        async enablePushNotifications() {
            if (!this.user) return;
            if (this.oneSignalConfigured) {
                try {
                    const isSubscribed = await this.withOneSignal(async (OneSignal) => {
                        // Ask the browser directly from this user-initiated click. A OneSignal
                        // slide prompt alone is only a pre-prompt; it is not proof that the
                        // operating system granted notification permission.
                        if (!OneSignal.Notifications.permission) {
                            await OneSignal.Notifications.requestPermission();
                        }
                        await OneSignal.login(this.user.uid);
                        return await this.waitForOneSignalSubscription(OneSignal);
                    });
                    this.pushEnabled = isSubscribed;
                    alert(this.pushEnabled
                        ? 'Personal push updates are enabled on this device!'
                        : 'Notifications were not enabled. You can try again whenever you are ready.');
                } catch (err) {
                    console.error('OneSignal setup error:', err);
                    alert('Unable to enable notifications right now. Please try again shortly.');
                }
                return;
            }
            if (this.pushEnabled) {
                alert("Push notifications are already enabled for this device!");
                return;
            }

            alert('Remote notifications are temporarily unavailable because OneSignal is not configured.');
        },

        async identifyOneSignalUser() {
            if (!this.user || !this.oneSignalConfigured) return;
            try {
                const isSubscribed = await this.withOneSignal(async (OneSignal) => {
                    await OneSignal.login(this.user.uid);
                    const firstName = (this.userData.name || this.user.displayName || 'Pet Parent').trim().split(/\s+/)[0];
                    await OneSignal.User.addTags({
                        first_name: firstName,
                        account_type: this.isAdmin ? 'admin' : 'client',
                        paw_points: String(this.userData.points || 0)
                    });
                    return Boolean(OneSignal.User.PushSubscription.optedIn);
                });
                this.pushEnabled = isSubscribed;
            } catch (err) {
                console.warn('OneSignal user identification failed:', err);
                this.pushEnabled = false;
            }
        },

        async withOneSignal(callback) {
            if (!this.oneSignalConfigured) return false;
            return new Promise((resolve, reject) => {
                window.OneSignalDeferred.push(async (OneSignal) => {
                    try {
                        resolve(await callback(OneSignal));
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        },

        async waitForOneSignalSubscription(OneSignal) {
            // The browser permission can resolve just before OneSignal finishes creating its
            // push subscription. Wait briefly so the UI never claims success too early.
            for (let attempt = 0; attempt < 8; attempt++) {
                if (OneSignal.Notifications.permission && OneSignal.User.PushSubscription.optedIn) {
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            return Boolean(OneSignal.Notifications.permission && OneSignal.User.PushSubscription.optedIn);
        },

        async sendNotificationDisplayTest() {
            if (!('Notification' in window)) {
                alert('This browser does not support notifications.');
                return;
            }
            if (Notification.permission !== 'granted') {
                alert('Notifications are blocked for this app. Enable them in your device or browser settings, then try again.');
                return;
            }
            try {
                const options = {
                    body: 'If you can see this, notifications are displaying correctly on this device.',
                    icon: 'android-chrome-192x192.webp',
                    badge: 'android-chrome-192x192.webp',
                    tag: 'pet-care-notification-test',
                    renotify: true,
                    data: { url: '/?view=profile' }
                };
                if ('serviceWorker' in navigator) {
                    const registration = await navigator.serviceWorker.ready;
                    const existing = await registration.getNotifications({ tag: options.tag });
                    existing.forEach(notification => notification.close());
                    await registration.showNotification('Pet Care by Steven — test', options);
                } else {
                    new Notification('Pet Care by Steven — test', options);
                }
                alert('Test sent. Check your notification banner or notification center.');
            } catch (err) {
                console.error('Notification display test failed:', err);
                alert('The device prevented the notification from displaying. Check your browser and system notification settings.');
            }
        },

        showPersonalNotification(subject, message = '', tag = 'pet-care-update', url = '/?view=home') {
            // Once the secure gateway is connected, points and reward messages are real
            // OneSignal pushes. Do not create a second local browser notification for an
            // already-open portal.
            if (this.notificationServiceConfigured && ['points', 'reward'].includes(tag)) return;
            const firstName = (this.userData.name || this.user?.displayName || '').trim().split(/\s+/)[0];
            const greeting = firstName ? `Hi ${firstName} 👋 ` : '';
            const detail = message ? `${subject}: ${message}` : subject;
            firePwaNotification('Pet Care by Steven', `${greeting}${detail}`, { tag: `pet-care-${tag}`, url });
        },

        trailLatLng(trail) {
            const lat = Number(trail.lat);
            const lng = Number(trail.lng);
            return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
        },

        trailPopup(trail) {
            const content = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = trail.title || 'Walking trail';
            const location = document.createElement('p');
            location.className = 'text-xs';
            location.textContent = trail.location || 'Location shared by the community';
            content.append(title, location);
            return content;
        },

        async initServiceAreaMap() {
            if (!document.getElementById('service-area-map')) return;
            try { await ensureLeafletLoaded(); } catch (err) { return console.warn('Map library unavailable:', err.message); }
            if (!this.serviceAreaMap) {
                this.serviceAreaMap = window.L.map('service-area-map', { scrollWheelZoom: false, attributionControl: true })
                    .setView([39.02, -84.24], 10);
                window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 18,
                    attribution: '&copy; OpenStreetMap contributors'
                }).addTo(this.serviceAreaMap);
            }
            if (this.serviceAreaLayers) this.serviceAreaLayers.clearLayers();
            this.serviceAreaLayers = window.L.layerGroup().addTo(this.serviceAreaMap);
            const coverageOutline = [
                [39.20, -84.57], [39.22, -84.03], [39.08, -83.98],
                [38.80, -84.02], [38.80, -84.30], [38.94, -84.57]
            ];
            window.L.polygon(coverageOutline, {
                color: '#4f46e5', weight: 3, fillColor: '#6366f1', fillOpacity: 0.14
            }).bindPopup('Pet Care by Steven primary coverage area').addTo(this.serviceAreaLayers);
            const areaPoints = {
                'Amelia': [39.028, -84.217], 'Batavia': [39.078, -84.176],
                'Bethel': [38.963, -84.081], 'Felicity': [38.827, -84.099],
                'New Richmond': [38.949, -84.279], 'Williamsburg': [39.053, -84.052],
                'Cincinnati & Suburbs': [39.103, -84.512]
            };
            this.serviceAreas.forEach(area => {
                const latLng = areaPoints[area.city];
                if (latLng) window.L.circleMarker(latLng, { radius: 6, color: '#059669', fillColor: '#10b981', fillOpacity: 1, weight: 2 })
                    .bindPopup(`<strong>${area.city}</strong><br>Primary coverage area`).addTo(this.serviceAreaLayers);
            });
            [100, 400, 900, 1600].forEach(delay => setTimeout(() => this.serviceAreaMap?.invalidateSize({ pan: false }), delay));
        },

        async initTrailMap() {
            if (this.trailMap || !document.getElementById('trail-map')) return;
            try { await ensureLeafletLoaded(); } catch (err) { return console.warn('Map library unavailable:', err.message); }
            this.trailMap = window.L.map('trail-map', { scrollWheelZoom: false }).setView([39.1031, -84.5120], 10);
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(this.trailMap);
            this.trailMapMarkers = window.L.layerGroup().addTo(this.trailMap);
            this.refreshTrailMapPins();
            [100, 400, 900].forEach(delay => setTimeout(() => this.trailMap?.invalidateSize({ pan: false }), delay));
        },

        refreshTrailMapPins() {
            if (!this.trailMap || !this.trailMapMarkers || !window.L) return;
            this.trailMapMarkers.clearLayers();
            const points = this.communityTrails
                .map(trail => ({ trail, latLng: this.trailLatLng(trail) }))
                .filter(item => item.latLng);
            points.forEach(({ trail, latLng }) => {
                window.L.marker(latLng).addTo(this.trailMapMarkers).bindPopup(this.trailPopup(trail));
            });
            if (points.length) this.trailMap.fitBounds(window.L.latLngBounds(points.map(item => item.latLng)).pad(0.2), { maxZoom: 10 });
        },

        async focusTrailMap(trail) {
            const latLng = this.trailLatLng(trail);
            if (!latLng) {
                const query = encodeURIComponent(`${trail.title || ''} ${trail.location || ''}`.trim());
                window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank', 'noopener');
                return;
            }
            await this.initTrailMap();
            this.trailMap.setView(latLng, 10);
            this.trailMapMarkers.eachLayer(marker => {
                if (marker.getLatLng().lat === latLng[0] && marker.getLatLng().lng === latLng[1]) marker.openPopup();
            });
            document.getElementById('trail-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
        },

        async initTrailPickerMap() {
            if (!this.showTrailMapPicker) return;
            try { await ensureLeafletLoaded(); } catch (err) { return console.warn('Map library unavailable:', err.message); }
            if (!this.trailPickerMap) {
                this.trailPickerMap = window.L.map('trail-picker-map').setView([39.1031, -84.5120], 10);
                window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; OpenStreetMap contributors'
                }).addTo(this.trailPickerMap);
                this.trailPickerMap.on('click', (event) => {
                    const { lat, lng } = event.latlng;
                    this.newTrailForm.lat = Number(lat.toFixed(6));
                    this.newTrailForm.lng = Number(lng.toFixed(6));
                    this.trailLocationStatus = '✓ Map location selected.';
                    if (this.trailPickerMarker) this.trailPickerMarker.setLatLng(event.latlng);
                    else this.trailPickerMarker = window.L.marker(event.latlng).addTo(this.trailPickerMap);
                });
            }
            [100, 400].forEach(delay => setTimeout(() => this.trailPickerMap?.invalidateSize({ pan: false }), delay));
        },

        async findTrailLocation(force = false) {
            const query = this.newTrailForm.location.trim();
            if (query.length < 3) return;
            if (!force && query === this.lastTrailGeocodeQuery) return;
            this.lastTrailGeocodeQuery = query;
            this.trailLocationStatus = 'Finding the map location…';
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`, {
                    headers: { Accept: 'application/json' }
                });
                if (!response.ok) throw new Error('Location lookup failed.');
                const results = await response.json();
                if (!results.length) {
                    this.trailLocationStatus = 'No map match found. You can still use Pick on map.';
                    return;
                }
                this.newTrailForm.lat = Number(Number(results[0].lat).toFixed(6));
                this.newTrailForm.lng = Number(Number(results[0].lon).toFixed(6));
                this.trailLocationStatus = '✓ Map location found automatically. You can adjust it with Pick on map.';
                if (this.trailPickerMap) {
                    const latLng = [this.newTrailForm.lat, this.newTrailForm.lng];
                    this.trailPickerMap.setView(latLng, 15);
                    if (this.trailPickerMarker) this.trailPickerMarker.setLatLng(latLng);
                    else this.trailPickerMarker = window.L.marker(latLng).addTo(this.trailPickerMap);
                }
            } catch (err) {
                console.warn('Trail location lookup failed:', err);
                this.trailLocationStatus = 'Could not find that location automatically. You can still use Pick on map.';
            }
        },

        async loadCommunityTrails() {
            try {
                const trailQuery = db.collection('community_guides').orderBy('createdAt', 'desc');
                const snap = await trailQuery.get({ source: 'server' }).catch(() => trailQuery.get({ source: 'cache' }));
                if (!snap.empty) {
                    this.communityTrails = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                }
                this.$nextTick(() => this.refreshTrailMapPins());
                if (!this.trailsUnsubscribe) {
                    this.trailsUnsubscribe = trailQuery.onSnapshot((snapshot) => {
                        const submittedTrails = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                        const staticTrails = this.communityTrails.filter(trail => trail.isStatic);
                        this.communityTrails = [...submittedTrails, ...staticTrails.filter(staticTrail => !submittedTrails.some(trail => trail.id === staticTrail.id))];
                        this.$nextTick(() => this.refreshTrailMapPins());
                    }, (err) => console.warn('Trail live updates are unavailable:', err));
                }
            } catch (err) {
                console.log('Using default static trails offline.');
            }
        },

        async submitNewTrail() {
            if (!this.newTrailForm.title || !this.newTrailForm.description) return;
            try {
                if (this.newTrailForm.lat === null) await this.findTrailLocation(true);
                const amenities = [...this.newTrailForm.amenities];
                if (this.newTrailForm.otherAmenities.trim()) amenities.push(this.newTrailForm.otherAmenities.trim());
                const trailObj = {
                    title: this.newTrailForm.title.trim(),
                    location: this.newTrailForm.location.trim(),
                    description: this.newTrailForm.description.trim(),
                    petFriendly: this.newTrailForm.petFriendly,
                    amenities,
                    safety: this.newTrailForm.safety,
                    bestTime: this.newTrailForm.bestTime,
                    lat: this.newTrailForm.lat,
                    lng: this.newTrailForm.lng,
                    author: this.userData.name || 'Local Pet Owner',
                    votes: 0,
                    upvoters: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                const docRef = await db.collection('community_guides').add(trailObj);
                this.communityTrails.unshift({ id: docRef.id, ...trailObj });
                this.newTrailForm = { title: '', location: '', description: '', petFriendly: 'Dog friendly', amenities: [], otherAmenities: '', safety: [], bestTime: '', lat: null, lng: null };
                this.trailLocationStatus = '';
                this.lastTrailGeocodeQuery = '';
                this.showTrailMapPicker = false;
                if (this.trailPickerMarker) {
                    this.trailPickerMap.removeLayer(this.trailPickerMarker);
                    this.trailPickerMarker = null;
                }
                this.$nextTick(() => this.refreshTrailMapPins());
                this.showAddTrailModal = false;
                alert('Thank you! Your trail recommendation has been published.');
            } catch (err) {
                alert('Error publishing trail: ' + err.message);
            }
        },

        trailAmenitiesLabel(trail) {
            if (Array.isArray(trail.amenities)) return trail.amenities.join(', ') || 'No amenities listed';
            return trail.amenities || 'No amenities listed';
        },

        trailSafetyLabel(trail) {
            const safety = Array.isArray(trail.safety) ? trail.safety.join(' · ') : '';
            return [trail.bestTime ? `Best: ${trail.bestTime}` : '', safety].filter(Boolean).join(' · ');
        },

        isTrailSaved(trailId) {
            return (this.userData.savedTrailIds || []).includes(trailId);
        },

        async toggleSavedTrail(trailId) {
            if (!this.user) return alert('Please log in to save trails.');
            const savedTrailIds = [...(this.userData.savedTrailIds || [])];
            const position = savedTrailIds.indexOf(trailId);
            if (position >= 0) savedTrailIds.splice(position, 1); else savedTrailIds.push(trailId);
            try {
                await db.collection('clients').doc(this.user.uid).update({ savedTrailIds });
                this.userData.savedTrailIds = savedTrailIds;
            } catch (err) {
                alert('Unable to update saved trails: ' + err.message);
            }
        },

        openTrailReport(trail) {
            this.selectedTrail = trail;
            this.trailReportForm = { reason: '', details: '' };
            this.showTrailReportModal = true;
        },

        async submitTrailReport() {
            if (!this.user || !this.selectedTrail || !this.trailReportForm.reason) return;
            try {
                await db.collection('trail_reports').add({
                    trailId: this.selectedTrail.id,
                    trailTitle: this.selectedTrail.title,
                    reason: this.trailReportForm.reason,
                    details: this.trailReportForm.details || '',
                    reporterUid: this.user.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showTrailReportModal = false;
                alert('Thank you — Steven will review this trail update.');
            } catch (err) {
                alert('Unable to send this update: ' + err.message);
            }
        },

        async fetchTrailReports() {
            if (!this.isAdmin) return;
            try {
                const snapshot = await db.collection('trail_reports').orderBy('createdAt', 'desc').get();
                this.trailReports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (err) {
                console.warn('Unable to load trail reports:', err);
            }
        },

        async deleteTrailReport(reportId) {
            if (!this.isAdmin || !this.adminModeActive) return;
            try {
                await db.collection('trail_reports').doc(reportId).delete();
                this.trailReports = this.trailReports.filter(report => report.id !== reportId);
            } catch (err) {
                alert('Unable to dismiss this trail update: ' + err.message);
            }
        },

        async deleteTrail(trail) {
            if (!this.isAdmin || !this.adminModeActive) return;
            if (!confirm(`Delete "${trail.title}" from the Trails Guide? This cannot be undone.`)) return;
            try {
                await db.collection('community_guides').doc(trail.id).delete();
                this.communityTrails = this.communityTrails.filter(item => item.id !== trail.id);
                this.refreshTrailMapPins();
            } catch (err) {
                alert('Unable to delete this trail: ' + err.message);
            }
        },

        async openTrailComments(trail) {
            this.selectedTrail = trail;
            this.trailCommentText = '';
            this.showTrailCommentsModal = true;
            await this.loadTrailComments();
        },

        async loadTrailComments() {
            if (!this.selectedTrail) return;
            this.trailCommentsLoading = true;
            try {
                const snapshot = await db.collection('community_guides').doc(this.selectedTrail.id)
                    .collection('comments').orderBy('createdAt', 'asc').get();
                this.trailComments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (err) {
                console.warn('Unable to load trail comments:', err);
                this.trailComments = [];
            } finally {
                this.trailCommentsLoading = false;
            }
        },

        async submitTrailComment() {
            if (!this.user) return alert('Please log in to comment.');
            const message = this.trailCommentText.trim();
            if (!message || !this.selectedTrail) return;
            try {
                const docRef = await db.collection('community_guides').doc(this.selectedTrail.id).collection('comments').add({
                    authorUid: this.user.uid,
                    authorName: this.userData.name || this.user.displayName || 'Pet parent',
                    message,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.trailComments.push({
                    id: docRef.id,
                    authorUid: this.user.uid,
                    authorName: this.userData.name || this.user.displayName || 'Pet parent',
                    message
                });
                this.trailCommentText = '';
            } catch (err) {
                alert('Unable to post your comment: ' + err.message);
            }
        },

        async deleteTrailComment(comment) {
            if (!this.isAdmin || !this.adminModeActive || !this.selectedTrail) return;
            if (!confirm('Delete this trail comment? This cannot be undone.')) return;
            try {
                await db.collection('community_guides').doc(this.selectedTrail.id).collection('comments').doc(comment.id).delete();
                this.trailComments = this.trailComments.filter(item => item.id !== comment.id);
            } catch (err) {
                alert('Unable to delete this comment: ' + err.message);
            }
        },

        async upvoteTrail(trailId) {
            if (!this.user) {
                alert('Please log in to upvote trails.');
                return;
            }
            try {
                if (trailId === '1' || trailId === '2') {
                    const idx = this.communityTrails.findIndex(t => t.id === trailId);
                    if (idx > -1) {
                        let upvoters = this.communityTrails[idx].upvoters || [];
                        if (upvoters.includes(this.user.uid)) {
                            upvoters = upvoters.filter(uid => uid !== this.user.uid);
                        } else {
                            upvoters.push(this.user.uid);
                        }
                        this.communityTrails[idx].upvoters = upvoters;
                        this.communityTrails[idx].votes = upvoters.length;
                    }
                    return;
                }

                const trailRef = db.collection('community_guides').doc(trailId);
                const doc = await trailRef.get();
                if (doc.exists) {
                    const data = doc.data();
                    let upvoters = data.upvoters || [];
                    if (upvoters.includes(this.user.uid)) {
                        upvoters = upvoters.filter(uid => uid !== this.user.uid);
                    } else {
                        upvoters.push(this.user.uid);
                    }
                    await trailRef.update({ upvoters: upvoters, votes: upvoters.length });

                    const idx = this.communityTrails.findIndex(t => t.id === trailId);
                    if (idx > -1) {
                        this.communityTrails[idx].upvoters = upvoters;
                        this.communityTrails[idx].votes = upvoters.length;
                    }
                }
            } catch (err) {
                alert('Error updating vote: ' + err.message);
            }
        },

        async installPwa() {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                this.showInstallBanner = false;
                if (outcome !== 'accepted') this.dismissInstallPrompt();
                deferredPrompt = null;
            } else {
                this.showInstallBanner = false;
                this.showIOSInstallModal = true;
            }
        },

        shouldShowInstallPrompt() {
            const dismissedAt = Number(localStorage.getItem('pwaInstallPromptDismissedAt') || 0);
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            return !isStandalone && (!dismissedAt || Date.now() - dismissedAt > 30 * 24 * 60 * 60 * 1000);
        },

        dismissInstallPrompt() {
            this.showInstallBanner = false;
            localStorage.setItem('pwaInstallPromptDismissedAt', String(Date.now()));
        },

        openProfilePanel(view = 'menu') {
            this.profilePanelView = view;
            this.showProfileModal = true;
            this.$nextTick(() => this.positionProfilePanel());
        },

        toggleProfilePanel() {
            if (this.showProfileModal) {
                this.closeProfilePanel();
                return;
            }
            this.openProfilePanel('menu');
        },

        closeProfilePanel() {
            this.showProfileModal = false;
            this.profilePanelView = 'menu';
        },

        positionProfilePanel() {
            const header = this.$refs.siteHeader;
            if (!header) return;
            const top = Math.round(header.getBoundingClientRect().bottom + 8);
            this.profilePanelTop = `${top}px`;
            this.profilePanelMaxHeight = `${Math.max(220, Math.floor(window.innerHeight - top - 12))}px`;
        },

        async loadServiceAreasFromFirestore() {
            const fallbackAreas = [
                { city: 'Amelia', zips: ['45102', '45101'] },
                { city: 'Batavia', zips: ['45103'] },
                { city: 'Bethel', zips: ['45106'] },
                { city: 'Felicity', zips: ['45120'] },
                { city: 'New Richmond', zips: ['45157'] },
                { city: 'Williamsburg', zips: ['45176'] },
                { city: 'Cincinnati & Suburbs', zips: ['45202', '45208', '45209', '45244', '45255'] }
            ];

            try {
                const docRef = db.collection('settings').doc('serviceConfig');
                const doc = await docRef.get();
                if (doc.exists && doc.data().areas && doc.data().areas.length > 0) {
                    this.serviceAreas = doc.data().areas;
                    const updatedAt = doc.data().updatedAt;
                    if (updatedAt && typeof updatedAt.toDate === 'function') {
                        this.serviceAreasLastUpdated = `Service areas last reviewed: ${updatedAt.toDate().toLocaleDateString()}`;
                    }
                } else {
                    this.serviceAreas = fallbackAreas;
                    await docRef.set({ areas: this.serviceAreas, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                }
            } catch (err) {
                this.serviceAreas = fallbackAreas;
            }
        },

        async loadSeasonalNotice() {
            try {
                const doc = await db.collection('settings').doc('seasonalNotice').get();
                if (doc.exists) {
                    const data = doc.data();
                    this.seasonalNotice = {
                        active: data.active === true,
                        title: typeof data.title === 'string' ? data.title.slice(0, 80) : '',
                        message: typeof data.message === 'string' ? data.message.slice(0, 240) : ''
                    };
                }
            } catch (err) {
                console.debug('Seasonal notice unavailable:', err.message);
            }
        },

        async saveSeasonalNotice(active) {
            if (!this.isAdmin || !this.adminModeActive) return;
            const title = this.seasonalNotice.title.trim();
            const message = this.seasonalNotice.message.trim();
            if (active && (!title || !message)) return alert('Add both a title and a short message before publishing.');
            try {
                await db.collection('settings').doc('seasonalNotice').set({
                    active,
                    title: title.slice(0, 80),
                    message: message.slice(0, 240),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                this.seasonalNotice.active = active;
                alert(active ? 'Seasonal notice is now visible on the homepage.' : 'Seasonal notice hidden.');
            } catch (err) {
                alert('Could not save the seasonal notice: ' + err.message);
            }
        },

        async loadApprovedReviews() {
            try {
                const snap = await db.collection('reviews').where('approved', '==', true).get();
                if (!snap.empty) {
                    this.reviewsList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                } else {
                    this.reviewsList = [];
                }
            } catch (err) {
                console.log('Error loading reviews');
            }
        },

        async loadGalleryPhotosFromFirestore() {
            try {
                const snap = await db.collection('gallery_photos').orderBy('createdAt', 'desc').get();
                if (!snap.empty) {
                    this.photoGrid = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                }
            } catch (err) {
                console.log('Using default gallery photos');
            }
        },

        async fetchPendingReviews() {
            try {
                const snap = await db.collection('reviews').where('approved', '==', false).get();
                this.pendingReviews = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (err) {
                console.error('Error fetching pending reviews:', err);
            }
        },

        async approveReview(reviewId) {
            try {
                await db.collection('reviews').doc(reviewId).update({ approved: true });
                alert('Review approved and published to homepage!');
                await this.fetchPendingReviews();
                await this.loadApprovedReviews();
            } catch (err) {
                alert('Error approving review: ' + err.message);
            }
        },

        async deleteReview(reviewId) {
            if (confirm('Permanently delete this review?')) {
                try {
                    await db.collection('reviews').doc(reviewId).delete();
                    await this.fetchPendingReviews();
                    await this.loadApprovedReviews();
                    alert('Review deleted successfully.');
                } catch (err) {
                    alert('Error deleting review: ' + err.message);
                }
            }
        },

        async submitClientReview() {
            if (!this.user) {
                alert('Please log in to submit a review.');
                this.currentView = 'loyalty';
                return;
            }
            if (!this.clientReviewForm.comment.trim()) return;

            try {
                await db.collection('reviews').add({
                    author: this.userData.name || 'Client',
                    stars: this.clientReviewForm.stars,
                    comment: this.clientReviewForm.comment.trim(),
                    approved: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.clientReviewForm = { stars: 5, comment: '' };
                alert('Thank you! Your review has been submitted for admin approval.');
            } catch (err) {
                alert('Error submitting review: ' + err.message);
            }
        },

        async notificationRequest(path, payload) {
            if (!this.notificationServiceConfigured) {
                throw new Error('The Cloudflare notification service is not connected yet.');
            }
            if (!this.user) throw new Error('Please sign in again.');
            // Notification actions go to a separate trusted service, so always
            // refresh the short-lived Firebase ID token before sending one.
            const idToken = await this.user.getIdToken(true);
            const response = await fetch(`${this.notificationServiceUrl}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'The notification service could not complete that request.');
            return result;
        },

        async sendPointUpdatePush(clientUid, points, statusName = '') {
            if (!this.notificationServiceConfigured) return false;
            try {
                await this.notificationRequest('/v1/notifications/point-update', { clientUid, points, statusName });
                return true;
            } catch (err) {
                // A push failure must never undo a successful points transaction.
                console.warn('Point-update push failed:', err.message);
                return false;
            }
        },

        async sendCouponPush(clientUid, coupon, points) {
            if (!this.notificationServiceConfigured || !coupon) return false;
            try {
                await this.notificationRequest('/v1/notifications/send', {
                    audience: 'client',
                    clientUid,
                    title: '🎁 A Paw Points reward was added',
                    body: `${coupon.title}: ${coupon.code}. You now have ${Math.round(points).toLocaleString()} Paw Points.`,
                    url: '/?view=loyalty'
                });
                return true;
            } catch (err) {
                console.warn('Coupon push failed:', err.message);
                return false;
            }
        },

        async sendRewardRedemptionPush(couponCode, rewardTitle) {
            if (!this.notificationServiceConfigured) return false;
            try {
                await this.notificationRequest('/v1/notifications/self-reward', { couponCode, rewardTitle });
                return true;
            } catch (err) {
                console.warn('Reward push failed:', err.message);
                return false;
            }
        },

        async sendRemoteNotification() {
            const form = this.notificationForm;
            if (!form.title.trim() || !form.body.trim()) return alert('Please enter both a title and message.');
            if (form.audience === 'client' && !form.clientUid) return alert('Choose a client.');
            if (form.customData.trim()) {
                try {
                    const parsed = JSON.parse(form.customData);
                    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
                } catch {
                    return alert('Custom data must be a valid JSON object.');
                }
            }
            const action = form.sendAt ? 'Schedule' : 'Send';
            const target = form.audience === 'all' ? 'all subscribed clients' : 'the selected client';
            if (!confirm(`${action} this rich push notification for ${target}?`)) return;
            this.notificationSending = true;
            try {
                const payload = { ...form, sendAt: form.sendAt ? new Date(form.sendAt).toISOString() : '' };
                const result = await this.notificationRequest('/v1/notifications/send', payload);
                if (result.noRecipients) {
                    alert('No push-enabled devices are available yet. Ask clients to sign in and select “Enable personal updates,” then retry. Your notification has been kept in the composer.');
                    return;
                }
                this.resetNotificationForm();
                alert(result.scheduledFor
                    ? `Rich notification scheduled for ${new Date(result.scheduledFor).toLocaleString()}.`
                    : `Rich push queued successfully${result.recipients ? ` for ${result.recipients} subscription(s)` : ''}.`);
            } catch (err) {
                alert('Unable to send push: ' + err.message);
            } finally {
                this.notificationSending = false;
            }
        },

        resetNotificationForm() {
            this.notificationForm = {
                audience: 'all', clientUid: '', title: '', body: '', url: '/?view=home',
                imageUrl: '', iconUrl: '', priority: 'normal', ttlHours: 72,
                collapseId: '', sendAt: '', buttons: [], customData: '', notificationType: 'admin_message'
            };
            this.notificationTemplateName = '';
            this.selectedNotificationTemplateId = '';
        },

        addNotificationButton() {
            if (this.notificationForm.buttons.length >= 2) return;
            const number = this.notificationForm.buttons.length + 1;
            this.notificationForm.buttons.push({ id: `action_${number}`, text: '', url: '/?view=home' });
        },

        applyNotificationTemplate(template) {
            const templates = {
                appointment: {
                    title: '📅 Upcoming pet-care visit',
                    body: 'A friendly reminder that your scheduled pet-care visit is coming up. Tap to review your details.',
                    url: '/?view=home', collapseId: 'appointment-reminder', notificationType: 'appointment', priority: 'normal',
                    buttons: [{ id: 'view_visit', text: 'View details', url: '/?view=home' }]
                },
                medication: {
                    title: '💊 Medication update',
                    body: 'Your pet’s medication update is ready. Tap to review the latest care information.',
                    url: '/?view=home', collapseId: 'medication-update', notificationType: 'medication', priority: 'high',
                    buttons: [{ id: 'review_update', text: 'Review update', url: '/?view=home' }]
                },
                weather: {
                    title: '⚠️ Pet-care weather alert',
                    body: 'Weather may affect today’s pet-care schedule. Tap for the latest update and next steps.',
                    url: '/?view=home', collapseId: 'weather-alert', notificationType: 'weather_alert', priority: 'high', ttlHours: 24,
                    buttons: [{ id: 'view_alert', text: 'View update', url: '/?view=home' }]
                }
            };
            const selected = templates[template];
            if (!selected) return;
            Object.assign(this.notificationForm, selected, { buttons: selected.buttons.map(button => ({ ...button })) });
            this.notificationTemplateName = '';
            this.selectedNotificationTemplateId = '';
        },

        async fetchSavedNotificationTemplates() {
            if (!this.notificationServiceConfigured || !this.user) return;
            try {
                const result = await this.notificationRequest('/v1/notification-templates/list', {});
                this.savedNotificationTemplates = result.templates || [];
            } catch (err) {
                console.warn('Unable to load notification templates:', err.message);
            }
        },

        loadSavedNotificationTemplate(template) {
            if (!template?.payload) return;
            const payload = template.payload;
            Object.assign(this.notificationForm, payload, {
                buttons: Array.isArray(payload.buttons) ? payload.buttons.map(button => ({ ...button })) : [],
                sendAt: '',
                customData: payload.customData || ''
            });
            this.notificationTemplateName = template.name;
            this.selectedNotificationTemplateId = template.id;
        },

        async saveCurrentNotificationTemplate() {
            const name = this.notificationTemplateName.trim();
            if (!name) return alert('Enter a name for this template.');
            if (!this.notificationForm.title.trim() || !this.notificationForm.body.trim()) {
                return alert('Add a title and message before saving the template.');
            }
            this.notificationTemplateSaving = true;
            try {
                const result = await this.notificationRequest('/v1/notification-templates/save', {
                    id: this.selectedNotificationTemplateId,
                    name,
                    template: { ...this.notificationForm, sendAt: '', audience: 'all', clientUid: '' }
                });
                this.selectedNotificationTemplateId = result.id;
                await this.fetchSavedNotificationTemplates();
                alert(`Template “${name}” saved.`);
            } catch (err) {
                alert('Unable to save template: ' + err.message);
            } finally {
                this.notificationTemplateSaving = false;
            }
        },

        async deleteSavedNotificationTemplate(template) {
            if (!confirm(`Delete the “${template.name}” template?`)) return;
            try {
                await this.notificationRequest('/v1/notification-templates/delete', { id: template.id });
                if (this.selectedNotificationTemplateId === template.id) {
                    this.selectedNotificationTemplateId = '';
                    this.notificationTemplateName = '';
                }
                await this.fetchSavedNotificationTemplates();
            } catch (err) {
                alert('Unable to delete template: ' + err.message);
            }
        },

        async scheduleClientReminder() {
            const form = this.reminderForm;
            if (!form.clientUid || !form.sendAt || !form.title.trim() || !form.body.trim()) {
                return alert('Choose a client, date/time, title, and message.');
            }
            try {
                const result = await this.notificationRequest('/v1/reminders', {
                    ...form,
                    sendAt: new Date(form.sendAt).toISOString()
                });
                this.reminderForm = { clientUid: '', sendAt: '', title: 'Pet Care by Steven reminder', body: '', url: '/?view=home' };
                await this.fetchScheduledReminders();
                alert(`Reminder scheduled for ${new Date(result.scheduledFor).toLocaleString()}.`);
            } catch (err) {
                alert('Unable to schedule reminder: ' + err.message);
            }
        },

        clientNameFor(clientUid) {
            const client = this.clientList.find(item => item.id === clientUid);
            return client?.name || client?.email || 'Client';
        },

        async fetchScheduledReminders() {
            if (!this.notificationServiceConfigured) {
                this.scheduledReminders = [];
                return;
            }
            try {
                const result = await this.notificationRequest('/v1/reminders/list', {});
                this.scheduledReminders = result.reminders || [];
            } catch (err) {
                console.warn('Unable to load scheduled reminders:', err.message);
            }
        },

        async cancelScheduledReminder(id) {
            if (!confirm('Cancel this scheduled reminder?')) return;
            try {
                await this.notificationRequest('/v1/reminders/cancel', { id });
                await this.fetchScheduledReminders();
            } catch (err) {
                alert('Unable to cancel reminder: ' + err.message);
            }
        },

        async postInAppAnnouncement() {
            const form = this.inAppAnnouncementForm;
            if (!form.title.trim() || !form.body.trim()) return alert('Please enter both title and body.');
            try {
                await db.collection('broadcasts').add({
                    title: form.title.trim(),
                    body: form.body.trim(),
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.inAppAnnouncementForm = { title: '', body: '' };
                alert('Announcement posted. Clients with an open portal will see it.');
            } catch (err) {
                alert('Error posting announcement: ' + err.message);
            }
        },

        scheduleNextToast() {
            const randomDelay = Math.floor(Math.random() * (30000 - 18000 + 1)) + 18000;
            setTimeout(() => {
                const randomIndex = Math.floor(Math.random() * this.bookingNotices.length);
                this.toastMessage = this.bookingNotices[randomIndex];
                this.showToast = true;

                const displayTime = Math.floor(Math.random() * (4000 - 2500 + 1)) + 2500;
                setTimeout(() => {
                    this.showToast = false;
                    this.scheduleNextToast();
                }, displayTime);
            }, randomDelay);
        },

        setThemePreference(preference) {
            this.themePreference = preference;
            localStorage.setItem('themePreference', preference);
            this.darkMode = preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        },

        async checkServiceArea() {
            const rawQuery = this.zipInput.trim();
            if (!rawQuery || rawQuery.length < 2) {
                this.serviceResult = null;
                return;
            }

            const cleanQuery = rawQuery.toLowerCase().replace(/[,.-]/g, ' ').replace(/\s+/g, ' ');

            const matchedArea = this.serviceAreas.find(area => {
                const cleanCity = area.city.toLowerCase();
                const matchesCity = cleanCity.includes(cleanQuery) || cleanQuery.includes(cleanCity);
                const matchesZip = area.zips.some(zip => zip.includes(cleanQuery) || cleanQuery.includes(zip));
                return matchesCity || matchesZip;
            });

            let isCovered = false;
            if (matchedArea) {
                isCovered = true;
                this.serviceResult = {
                    covered: true,
                    message: `🎉 Match found! ${matchedArea.city} (${matchedArea.zips.join(', ')}) is in our primary coverage area.`
                };
            } else {
                if (rawQuery.length >= 3) {
                    this.serviceResult = {
                        covered: false,
                        message: '📍 That location is outside our standard zone, but we may still accommodate visits! Message Steven to double-check.'
                    };
                } else {
                    this.serviceResult = null;
                    return;
                }
            }

            const normalizedQuery = cleanQuery;
            const now = Date.now();
            if (this.lastLoggedServiceSearch && this.lastLoggedServiceSearch.query === normalizedQuery && now - this.lastLoggedServiceSearch.at < 10 * 60 * 1000) {
                return;
            }

            try {
                await db.collection('search_logs').add({
                    query: rawQuery,
                    covered: isCovered,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.lastLoggedServiceSearch = { query: normalizedQuery, at: now };
            } catch (err) {
                console.error('Failed to log search:', err);
            }
        },

        async submitCarePlanRequest() {
            const request = {
                name: this.carePlanForm.name.trim(),
                email: this.carePlanForm.email.trim(),
                phone: this.carePlanForm.phone.trim(),
                source: this.carePlanForm.source || 'Not provided',
                details: this.carePlanForm.details.trim(),
                honey: this.carePlanForm.honey,
                startedAt: this.carePlanForm.startedAt
            };

            if (!request.name || !request.email || !request.phone || !request.details) {
                this.carePlanStatus = { submitting: false, success: false, message: 'Please complete your name, email, phone number, and care details.' };
                return;
            }

            if (request.honey || Date.now() - request.startedAt < 1500) {
                this.carePlanStatus = { submitting: false, success: true, message: 'Your care-plan request is received.' };
                return;
            }

            this.carePlanStatus = { submitting: true, success: false, message: '' };
            try {
                const response = await fetch('https://formsubmit.co/ajax/2a94e5ab8462bbb1aa7530d6568457f3', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        name: request.name,
                        email: request.email,
                        phone: request.phone,
                        source: request.source,
                        details: request.details,
                        _honey: request.honey,
                        _subject: 'New personalized care plan request',
                        _replyto: request.email,
                        _template: 'table',
                        _autoresponse: `Hi ${request.name},\n\nThanks for reaching out to Pet Care by Steven. Your care-plan request was received, and I’ll review your pet’s needs and preferred timeline before following up with options—usually much sooner than one business day.\n\nFor a pet-care emergency, please contact me directly.\n\n— Steven\nPet Care by Steven`
                    })
                });

                if (!response.ok) {
                    throw new Error('Care-plan email request failed.');
                }

                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.message || 'Care-plan email request failed.');
                }
                this.carePlanForm = { name: '', email: '', phone: '', source: '', details: '', honey: '', startedAt: Date.now() };
                this.carePlanStatus = { submitting: false, success: true, message: 'Your care-plan request is received.' };
                this.trackEvent('care_plan_submit_success', { source: request.source.toLowerCase().replace(/\s+/g, '_').slice(0, 40) });
            } catch (err) {
                console.error('Care-plan request error:', err);
                this.carePlanStatus = { submitting: false, success: false, message: 'We could not send your request right now. Please try again or email support@petcarebysteven.me.' };
            }
        },

        async addBulkServiceAreas() {
            if (!this.bulkAreaInput.trim()) return;

            const newItems = this.bulkAreaInput
                .split(/[\n,]+/)
                .map(item => item.trim())
                .filter(item => item.length > 0);

            let addedCount = 0;
            newItems.forEach(item => {
                const isZip = /^\d+$/.test(item);
                if (isZip) {
                    let existing = this.serviceAreas.find(a => a.zips.includes(item));
                    if (!existing) {
                        this.serviceAreas.push({ city: 'Area ' + item, zips: [item] });
                        addedCount++;
                    }
                } else {
                    let existing = this.serviceAreas.find(a => a.city.toLowerCase() === item.toLowerCase());
                    if (!existing) {
                        this.serviceAreas.push({ city: item, zips: [] });
                        addedCount++;
                    }
                }
            });

            try {
                await db.collection('settings').doc('serviceConfig').set({ areas: this.serviceAreas, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                this.serviceAreasLastUpdated = `Service areas last reviewed: ${new Date().toLocaleDateString()}`;
                this.bulkAreaInput = '';
                alert(`Successfully added ${addedCount} new location group(s) and synced to Firestore!`);
            } catch (err) {
                alert('Error saving to Firestore: ' + err.message);
            }
        },

        async removeServiceArea(idx) {
            if (confirm('Remove this service location?')) {
                this.serviceAreas.splice(idx, 1);
                try {
                    await db.collection('settings').doc('serviceConfig').set({ areas: this.serviceAreas, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                    this.serviceAreasLastUpdated = `Service areas last reviewed: ${new Date().toLocaleDateString()}`;
                } catch (err) {
                    alert('Error updating Firestore: ' + err.message);
                }
            }
        },

        async addNewReview() {
            if (this.newReview.comment && this.newReview.author) {
                try {
                    const revObj = {
                        author: this.newReview.author.trim(),
                        stars: this.newReview.stars,
                        comment: this.newReview.comment.trim(),
                        approved: true,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    const docRef = await db.collection('reviews').add(revObj);
                    this.reviewsList.unshift({ id: docRef.id, ...revObj });
                    this.newReview = { stars: 5, comment: '', author: '' };
                    alert('New review published directly to site and saved to Firestore!');
                } catch (err) {
                    alert('Error publishing review: ' + err.message);
                }
            } else {
                alert('Please enter both an author name and review comment.');
            }
        },

        async addGalleryPhoto() {
            if (this.newPhoto.url.trim()) {
                const photoObj = {
                    url: this.newPhoto.url.trim(),
                    caption: this.newPhoto.caption.trim() || 'Visit Photo',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                try {
                    const docRef = await db.collection('gallery_photos').add(photoObj);
                    this.photoGrid.unshift({ id: docRef.id, ...photoObj });
                    this.newPhoto = { url: '', caption: '' };
                    alert('Photo saved and added to gallery permanently!');
                } catch (err) {
                    alert('Error saving photo to Firestore: ' + err.message);
                }
            } else {
                alert('Please enter a valid image URL.');
            }
        },

        async removeGalleryPhoto(idx) {
            if (confirm('Are you sure you want to remove this photo from the gallery?')) {
                const photoToRemove = this.photoGrid[idx];
                this.photoGrid.splice(idx, 1);
                if (photoToRemove && photoToRemove.id) {
                    try {
                        await db.collection('gallery_photos').doc(photoToRemove.id).delete();
                    } catch (err) {
                        console.error('Error deleting photo from Firestore:', err);
                    }
                }
            }
        },

        async addNewFaq() {
            if (this.newFaq.question.trim() && this.newFaq.answer.trim()) {
                const faqObj = {
                    question: this.newFaq.question.trim(),
                    answer: this.newFaq.answer.trim()
                };
                try {
                    await db.collection('faqs').add(faqObj);
                    this.faqList.push(faqObj);
                    this.newFaq = { question: '', answer: '' };
                    alert('FAQ published and saved to Firestore!');
                } catch (err) {
                    alert('Error saving FAQ: ' + err.message);
                }
            } else {
                alert('Please enter both a question title and answer.');
            }
        },

        removeFaq(idx) {
            if (confirm('Are you sure you want to remove this FAQ item?')) {
                this.faqList.splice(idx, 1);
            }
        },

        async generateAdminBadge() {
            const badgeDiv = document.getElementById("admin-qrcode");
            if (badgeDiv) {
                badgeDiv.innerHTML = "";
                try {
                    await loadExternalScript('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js', 'qrcode-sdk');
                } catch (err) {
                    badgeDiv.textContent = 'QR code could not load. Please try again.';
                    return;
                }
                if (typeof QRCode !== 'undefined' && this.qrBadgeUrl.trim()) {
                    new QRCode(badgeDiv, { text: this.qrBadgeUrl.trim(), width: 140, height: 140 });
                }
            }
        },

        exportWalkiesCSV() {
            if (!this.clientList || this.clientList.length === 0) {
                alert('No client records found to export.');
                return;
            }

            let csvContent = "data:text/csv;charset=utf-8,";
            csvContent += "Client Name,Email,Phone,Address,Lockbox Code,Alarm Notes,Vet Clinic,Vet Phone,Pets & Notes\r\n";

            this.clientList.forEach(c => {
                const name = `"${(c.name || '').replace(/"/g, '""')}"`;
                const email = `"${(c.email || '').replace(/"/g, '""')}"`;
                const phone = `"${(c.phone || '').replace(/"/g, '""')}"`;
                const address = `"${(c.address || '').replace(/"/g, '""')}"`;
                const lockbox = `"${(c.lockboxCode || '').replace(/"/g, '""')}"`;
                const alarm = `"${(c.alarmInstructions || '').replace(/"/g, '""')}"`;
                const vet = `"${(c.vetClinic || '').replace(/"/g, '""')}"`;
                const vetPhone = `"${(c.vetPhone || '').replace(/"/g, '""')}"`;

                const petsSummary = (c.pets || []).map(p => `${p.name}: ${p.notes}`).join(' | ');
                const petsClean = `"${petsSummary.replace(/"/g, '""')}"`;

                csvContent += [name, email, phone, address, lockbox, alarm, vet, vetPhone, petsClean].join(",") + "\r\n";
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `walkies_client_import_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        async handleGoogleAuth() {
            this.authError = '';
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });

            try {
                const res = await auth.signInWithPopup(provider);
                const userRef = db.collection('clients').doc(res.user.uid);
                const doc = await userRef.get();

                if (!doc.exists) {
                    const personalRefCode = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
                    let initialCoupons = [];
                    let referredByUid = null;

                    const urlParams = new URLSearchParams(window.location.search);
                    const refParam = urlParams.get('ref') || this.authForm.refCode;

                    if (refParam) {
                        const enteredRefCode = refParam.trim().toUpperCase();
                        try {
                            const referralDoc = await db.collection('referral_codes').doc(enteredRefCode).get();
                            if (referralDoc.exists) {
                                referredByUid = referralDoc.data().ownerUid;

                                initialCoupons.push({
                                    code: 'WELCOME-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
                                    title: '$10 Off First Visit (Referral Bonus)',
                                    used: false,
                                    createdAt: new Date().toISOString()
                                });

                            }
                        } catch (refError) {
                            console.warn("Could not validate referral code.", refError);
                            initialCoupons.push({
                                code: 'WELCOME-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
                                title: '$10 Off First Visit (Referral Bonus)',
                                used: false,
                                createdAt: new Date().toISOString()
                            });
                        }
                    }

                    fetch('https://hook.us1.make.com/llq7icsk5doklbgwemxl4t1fmqw2dulm', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            source: "Pet Care Portal",
                            uid: res.user.uid,
                            name: res.user.displayName || 'Google Client',
                            email: res.user.email,
                            referralCode: personalRefCode,
                            referredBy: referredByUid || 'None',
                            createdAt: new Date().toISOString()
                        })
                    }).catch(err => console.log('Webhook error:', err));

                    await userRef.set({
                        name: res.user.displayName || 'Client',
                        email: res.user.email,
                        phone: '',
                        address: '',
                        points: 0,
                        lifetimePoints: 0,
                        yearlyPoints: 0,
                        qualifyingYear: new Date().getFullYear(),
                        statusTier: 'bronze',
                        statusYear: new Date().getFullYear().toString(),
                        coupons: initialCoupons,
                        pets: [{ name: '', notes: '', birthday: '', breed: '', photo: '' }],
                        referralCode: personalRefCode,
                        referredBy: referredByUid,
                        referralsCount: 0,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    await this.registerReferralCode(personalRefCode, res.user.uid);
                    if (referredByUid) await this.createReferralClaim(referredByUid, res.user.uid);
                }

                await this.fetchUserData(res.user.uid);
                this.currentView = 'loyalty';
            } catch (err) {
                this.authError = err.message;
            }
        },

        async handleAuth() {
            this.authError = '';
            this.authSuccess = '';
            try {
                if (this.authMode === 'signup') {
                    const res = await auth.createUserWithEmailAndPassword(this.authForm.email, this.authForm.password);
                    await res.user.sendEmailVerification();

                    const personalRefCode = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
                    let initialCoupons = [];
                    let referredByUid = null;

                    const enteredRefCode = (this.authForm.refCode || '').trim().toUpperCase();
                    if (enteredRefCode) {
                        try {
                            const referralDoc = await db.collection('referral_codes').doc(enteredRefCode).get();
                            if (referralDoc.exists) {
                                referredByUid = referralDoc.data().ownerUid;

                                initialCoupons.push({
                                    code: 'WELCOME-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
                                    title: '$10 Off First Visit (Referral Bonus)',
                                    used: false,
                                    createdAt: new Date().toISOString()
                                });

                            }
                        } catch (refError) {
                            console.warn("Could not validate referral code.", refError);
                            initialCoupons.push({
                                code: 'WELCOME-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
                                title: '$10 Off First Visit (Referral Bonus)',
                                used: false,
                                createdAt: new Date().toISOString()
                            });
                        }
                    }

                    fetch('https://hook.us1.make.com/llq7icsk5doklbgwemxl4t1fmqw2dulm', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            source: "Pet Care Portal",
                            uid: res.user.uid,
                            name: this.authForm.name,
                            email: this.authForm.email,
                            referralCode: personalRefCode,
                            referredBy: referredByUid || 'None',
                            createdAt: new Date().toISOString()
                        })
                    }).catch(err => console.log('Webhook error:', err));

                    await db.collection('clients').doc(res.user.uid).set({
                        name: this.authForm.name,
                        email: this.authForm.email,
                        phone: '',
                        address: '',
                        points: 0,
                        lifetimePoints: 0,
                        yearlyPoints: 0,
                        qualifyingYear: new Date().getFullYear(),
                        statusTier: 'bronze',
                        statusYear: new Date().getFullYear().toString(),
                        coupons: initialCoupons,
                        pets: [{ name: '', notes: '', birthday: '', breed: '', photo: '' }],
                        referralCode: personalRefCode,
                        referredBy: referredByUid,
                        referralsCount: 0,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    await this.registerReferralCode(personalRefCode, res.user.uid);
                    if (referredByUid) await this.createReferralClaim(referredByUid, res.user.uid);

                    this.authSuccess = 'Account created! Please check your email to verify your address.';
                    this.authMode = 'login';
                } else {
                    const res = await auth.signInWithEmailAndPassword(this.authForm.email, this.authForm.password);
                    await res.user.reload();

                    const isGoogleUser = res.user.providerData.some(p => p.providerId === 'google.com');
                    this.isVerified = res.user.emailVerified || isGoogleUser;

                    if (!this.isVerified) {
                        this.authError = 'Please verify your email address to access the dashboard.';
                    }
                }
            } catch (err) {
                this.authError = err.message;
            }
        },

        async resendVerificationEmail() {
            this.authError = '';
            this.authSuccess = '';
            if (auth.currentUser) {
                try {
                    await auth.currentUser.sendEmailVerification();
                    alert('Verification email resent! Please check your inbox.');
                } catch (err) {
                    alert('Error sending verification email: ' + err.message);
                }
            }
        },

        async checkVerificationStatus() {
            if (auth.currentUser) {
                await auth.currentUser.reload();
                const isGoogleUser = auth.currentUser.providerData.some(p => p.providerId === 'google.com');
                this.isVerified = auth.currentUser.emailVerified || isGoogleUser;

                if (this.isVerified) {
                    await this.fetchUserData(auth.currentUser.uid);
                } else {
                    alert('Email not verified yet. Please click the link sent to your email.');
                }
            }
        },

        async handleForgotPassword() {
            this.authError = '';
            this.authSuccess = '';
            if (!this.authForm.email) {
                this.authError = 'Please enter your email address.';
                return;
            }

            try {
                await auth.sendPasswordResetEmail(this.authForm.email);
                this.authSuccess = 'Password reset link sent! Check your email inbox.';
            } catch (err) {
                this.authError = err.message;
            }
        },

        async fetchUserData(uid) {
            const userRef = db.collection('clients').doc(uid);
            const [doc, adminDoc] = await Promise.all([
                userRef.get(),
                db.collection('admins').doc(uid).get().catch((err) => {
                    console.warn('Admin role lookup failed:', err.code || err.message);
                    return null;
                })
            ]);
            this.isAdmin = !!adminDoc && adminDoc.exists && adminDoc.data().enabled !== false;
            if (doc.exists) {
                const oldPoints = this.userData.points;
                this.userData = doc.data();
                this.userData.coupons = this.userData.coupons || [];

                const currentYear = new Date().getFullYear().toString();
                // Point balances are maintained by an administrator, never by a browser.
                // This prevents a client from changing their own loyalty balance.
                this.userData.yearlyPoints = this.userData.yearlyPoints || 0;
                this.userData.lifetimePoints = this.userData.lifetimePoints || this.userData.points || 0;

                if (oldPoints !== undefined && oldPoints !== this.userData.points) {
                    this.showPersonalNotification('🐾 Paw Points updated', `You now have ${this.userData.points} Paw Points.`, 'points', '/?view=loyalty');
                }

                this.profileForm = {
                    name: this.userData.name || '',
                    email: this.userData.email || this.user.email,
                    phone: this.userData.phone || '',
                    address: this.userData.address || '',
                    photoUrl: this.userData.photoUrl || ''
                };
                this.profilePhotoFailed = false;
                this.firstVisitChecklist = {
                    contactReady: false, accessReady: false, petCareReady: false, vetReady: false,
                    ...(this.userData.firstVisitChecklist || {})
                };

                if (!this.userData.referralCode) {
                    const newRefCode = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
                    await userRef.update({ referralCode: newRefCode });
                    this.userData.referralCode = newRefCode;
                }
                await this.registerReferralCode(this.userData.referralCode, uid);

                const todayStr = new Date().toISOString().slice(5, 10);
                if (this.userData.pets && this.userData.pets.length > 0) {
                    const hasBirthdayToday = this.userData.pets.some(p => p.birthday && p.birthday.slice(5, 10) === todayStr);
                    if (hasBirthdayToday) {
                        const lastBdayBonus = localStorage.getItem('bday_bonus_' + new Date().getFullYear());
                        if (!lastBdayBonus) {
                            localStorage.setItem('bday_bonus_' + new Date().getFullYear(), 'true');
                            this.petBirthdayAlert = true;
                        }
                    }
                }

                // Trigger Confetti if the birthday alert is true!
                if (this.petBirthdayAlert) {
                    this.fireConfetti();
                }

                this.isFirstVisitCompleted = !!this.userData.firstVisitCompleted;

                if (!this.userData.pets || this.userData.pets.length === 0) {
                    this.userData.pets = [{
                        name: this.userData.petName || '',
                        notes: this.userData.petNotes || '',
                        birthday: '',
                        breed: '',
                        photo: ''
                    }];
                }

                if (!this.userData.emergencyContacts) {
                    this.userData.emergencyContacts = [];
                }

                if (this.userData.vetAuth) {
                    this.vetAuthForm = { ...this.userData.vetAuth };
                }

                if (this.userData.houseChecklist) {
                    this.houseChecklist = { ...this.userData.houseChecklist };
                }

            }
        },

        async registerReferralCode(code, ownerUid) {
            if (!code || !ownerUid) return;
            try {
                const codeRef = db.collection('referral_codes').doc(code);
                const existing = await codeRef.get();
                if (!existing.exists) {
                    await codeRef.set({
                        ownerUid: ownerUid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            } catch (err) {
                console.warn('Referral code registration failed:', err.code || err.message);
            }
        },

        async createReferralClaim(referrerUid, clientUid) {
            if (!referrerUid || !clientUid || referrerUid === clientUid) return;
            try {
                await db.collection('referral_claims').doc(clientUid).set({
                    referrerUid: referrerUid,
                    clientUid: clientUid,
                    status: 'pending',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (err) {
                console.warn('Referral claim creation failed:', err.code || err.message);
            }
        },

        async updateUserProfile() {
            this.profileError = '';
            this.profileSuccess = '';

            try {
                const photoUrl = (this.profileForm.photoUrl || '').trim();
                if (photoUrl) {
                    let parsedPhotoUrl;
                    try { parsedPhotoUrl = new URL(photoUrl); } catch (_) { parsedPhotoUrl = null; }
                    if (!parsedPhotoUrl || parsedPhotoUrl.protocol !== 'https:') {
                        this.profileError = 'Please use a valid https:// link for your profile photo.';
                        return;
                    }
                }
                const clientRef = db.collection('clients').doc(this.user.uid);
                await clientRef.update({
                    name: this.profileForm.name,
                    email: this.profileForm.email,
                    phone: this.profileForm.phone,
                    address: this.profileForm.address,
                    photoUrl
                });

                let checklistSaved = true;
                try {
                    await clientRef.update({ firstVisitChecklist: this.firstVisitChecklist });
                } catch (checklistError) {
                    console.warn('First-visit checklist save failed:', checklistError);
                    checklistSaved = false;
                }

                if (this.profileForm.email !== this.user.email) {
                    await this.user.updateEmail(this.profileForm.email);
                    await this.user.sendEmailVerification();
                }

                this.userData.name = this.profileForm.name;
                this.userData.email = this.profileForm.email;
                this.userData.phone = this.profileForm.phone;
                this.userData.address = this.profileForm.address;
                this.userData.photoUrl = photoUrl;
                this.profilePhotoFailed = false;
                if (checklistSaved) this.userData.firstVisitChecklist = this.firstVisitChecklist;
                await this.identifyOneSignalUser();

                this.profileSuccess = checklistSaved
                    ? 'Profile details updated successfully!'
                    : 'Contact profile saved. Publish the latest Firestore rules to save the first-visit checklist.';
                setTimeout(() => { this.showProfileModal = false; this.profileSuccess = ''; }, 1500);
            } catch (err) {
                this.profileError = err.message;
            }
        },

        async saveVetAuth() {
            if (!this.user) return;
            try {
                if (!this.vetAuthForm.dateSigned) {
                    this.vetAuthForm.dateSigned = new Date().toLocaleDateString();
                }
                this.vetAuthForm.isSigned = true;

                await db.collection('clients').doc(this.user.uid).set({
                    vetAuth: this.vetAuthForm
                }, { merge: true });

                this.userData.vetAuth = this.vetAuthForm;
                this.showVetAuthModal = false;
                alert('Medical Authorization saved successfully!');
            } catch (err) {
                alert('Error saving authorization: ' + err.message);
            }
        },

        async saveHouseChecklist() {
            if (!this.user) return;
            try {
                await db.collection('clients').doc(this.user.uid).set({
                    houseChecklist: this.houseChecklist
                }, { merge: true });

                this.userData.houseChecklist = this.houseChecklist;
                this.showChecklistModal = false;
                alert('House & Care Checklist saved successfully!');
            } catch (err) {
                alert('Error saving checklist: ' + err.message);
            }
        },

        getReferralLink() {
            if (!this.userData.referralCode) return 'Loading...';
            return `${window.location.origin}${window.location.pathname}?ref=${this.userData.referralCode}`;
        },

        copyReferralLink() {
            const link = this.getReferralLink();
            navigator.clipboard.writeText(link).then(() => {
                this.copiedRef = true;
                setTimeout(() => this.copiedRef = false, 2500);
            });
        },

        addPet() {
            if (!this.userData.pets) this.userData.pets = [];
            this.userData.pets.push({ name: '', notes: '', birthday: '', breed: '', photo: '' });
            this.isEditingPets = true;
        },

        removePet(index) {
            if (this.userData.pets.length > 1) {
                this.userData.pets.splice(index, 1);
            }
        },

        addEmergencyContact() {
            if (!this.userData.emergencyContacts) this.userData.emergencyContacts = [];
            this.userData.emergencyContacts.push({ name: '', relation: '', phone: '' });
        },

        removeEmergencyContact(idx) {
            this.userData.emergencyContacts.splice(idx, 1);
        },

        uploadPetPhoto(event, index) {
            const file = event.target.files[0];
            if (!file) return;

            const img = new Image();
            const reader = new FileReader();

            reader.onload = (e) => {
                img.src = e.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 300;
                    const MAX_HEIGHT = 300;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    this.userData.pets[index].photo = canvas.toDataURL('image/webp', 0.8);
                };
            };
            reader.readAsDataURL(file);
        },

        async savePetDetails() {
            if (!this.user) {
                alert('You must be logged in to save pet details.');
                return;
            }

            try {
                const cleanedPets = (this.userData.pets || []).map(p => ({
                    name: p.name || '',
                    notes: p.notes || '',
                    birthday: p.birthday || '',
                    breed: p.breed || '',
                    photo: p.photo || ''
                }));

                await db.collection('clients').doc(this.user.uid).set({
                    pets: cleanedPets,
                    lockboxCode: this.userData.lockboxCode || '',
                    alarmInstructions: this.userData.alarmInstructions || '',
                    homeEntryNotes: this.userData.homeEntryNotes || '',
                    emergencyContacts: this.userData.emergencyContacts || [],
                    vetClinic: this.userData.vetClinic || '',
                    vetPhone: this.userData.vetPhone || ''
                }, { merge: true });

                this.isEditingPets = false;
                alert('Pet profiles, home access & emergency contacts saved successfully!');
            } catch (err) {
                alert(`Error saving profile: ${err.message}`);
            }
        },

        async cancelPetEdit() {
            if (this.user) {
                await this.fetchUserData(this.user.uid);
            }
            this.isEditingPets = false;
        },

        async openAdminModal(tab = 'points') {
            this.adminTab = tab;
            this.showAdminModal = true;
            await this.fetchClientsList();
            await this.fetchPendingReferrals();
            if (tab === 'reviews') {
                await this.fetchPendingReviews();
                await this.loadApprovedReviews();
            }
            if (tab === 'broadcast') {
                await this.fetchScheduledReminders();
            }
            if (tab === 'badge') {
                this.$nextTick(() => this.generateAdminBadge());
            }
        },

        async fetchClientsList() {
            try {
                const snapshot = await db.collection('clients').get();
                this.clientList = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
            } catch (err) {
                console.error('Failed to load clients list:', err);
            }
        },

        async fetchPendingReferrals() {
            try {
                const snapshot = await db.collection('referral_claims').where('status', '==', 'pending').get();
                this.pendingReferrals = await Promise.all(snapshot.docs.map(async (doc) => {
                    const claim = { id: doc.id, ...doc.data() };
                    const [referrer, client] = await Promise.all([
                        db.collection('clients').doc(claim.referrerUid).get(),
                        db.collection('clients').doc(claim.clientUid).get()
                    ]);
                    return {
                        ...claim,
                        referrerName: referrer.exists ? (referrer.data().name || referrer.data().email || 'Unnamed client') : 'Unknown referrer',
                        clientName: client.exists ? (client.data().name || client.data().email || 'New client') : 'New client'
                    };
                }));
            } catch (err) {
                console.error('Failed to load referral claims:', err);
                this.pendingReferrals = [];
            }
        },

        async approveReferral(claim) {
            if (!confirm(`Approve ${claim.clientName}'s referral? ${claim.referrerName} will receive 1,000 Paw Points and may unlock a current-year status upgrade.`)) return;
            try {
                const referrerRef = db.collection('clients').doc(claim.referrerUid);
                const claimRef = db.collection('referral_claims').doc(claim.id);
                const referrer = await referrerRef.get();
                if (!referrer.exists) throw new Error('The referring client could not be found.');
                const data = referrer.data();
                const currentPoints = data.points || 0;
                const referralsCount = Number(data.referralsCount || 0) + 1;
                const currentTier = this.getClientTier(data).key;
                const referralTier = referralsCount >= 5 ? 'gold' : (referralsCount >= 1 ? 'silver' : currentTier);
                const tierRank = { bronze: 0, silver: 1, gold: 2 };
                const statusTier = (tierRank[referralTier] || 0) > (tierRank[currentTier] || 0) ? referralTier : currentTier;
                const update = {
                    points: currentPoints + 1000,
                    lifetimePoints: (data.lifetimePoints || currentPoints) + 1000,
                    referralsCount
                };
                if (statusTier !== currentTier) {
                    update.statusTier = statusTier;
                    update.statusYear = this.tierSeasonYear;
                }
                await referrerRef.update(update);
                await claimRef.update({
                    status: 'awarded',
                    reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    reviewedBy: this.user.uid
                });
                await this.sendPointUpdatePush(
                    claim.referrerUid,
                    currentPoints + 1000,
                    statusTier !== currentTier ? this.getClientTier({ statusTier }).name : ''
                );
                await this.fetchPendingReferrals();
                await this.fetchClientsList();
                const upgradeMessage = statusTier !== currentTier ? ` ${statusTier === 'gold' ? 'Gold Paw VIP' : 'Silver Paw'} status is now active for ${this.tierSeasonYear}.` : '';
                alert(`Referral reward approved and 1,000 Paw Points added.${upgradeMessage}`);
            } catch (err) {
                alert('Unable to award referral points: ' + err.message);
            }
        },

        async redeemReward(cost, title) {
            if ((this.userData.points || 0) < cost) return;
            if (confirm(`Redeem ${cost} points for ${title}?`)) {
                const couponCode = 'PAW-' + Math.random().toString(36).substring(2, 10).toUpperCase();
                const coupon = { code: couponCode, title: title, used: false, createdAt: new Date().toISOString() };
                const updatedCoupons = [...(this.userData.coupons || []), coupon];
                await db.collection('clients').doc(this.user.uid).update({
                    points: this.userData.points - cost,
                    coupons: updatedCoupons
                });
                this.userData.points -= cost;
                this.userData.coupons = updatedCoupons;
                await this.identifyOneSignalUser();
                this.showPersonalNotification('🎁 Your reward is ready', `Your coupon code is ${couponCode}. Show it when booking.`, 'reward', '/?view=loyalty');
                await this.sendRewardRedemptionPush(couponCode, title);
                alert(`Reward redeemed!\n\nYour coupon code is: ${couponCode}`);
            }
        },

        showCouponForRedemption(index) {
            if (!this.user) return;

            const coupon = this.userData.coupons[index];

            if (coupon.used) {
                alert('This coupon has already been used and cannot be changed.');
                return;
            }

            alert(`Show this coupon to Steven when booking:\n\n${coupon.code}\n\nSteven will mark it used after applying it to your booking.`);
        },

        getClientCoupons(clientUid) {
            const client = this.clientList.find(item => item.id === clientUid);
            return client?.coupons || [];
        },

        async markClientCouponUsed(clientUid, couponIndex) {
            if (!this.isAdmin || !this.adminModeActive) return;
            const client = this.clientList.find(item => item.id === clientUid);
            const coupon = client?.coupons?.[couponIndex];
            if (!coupon || coupon.used) return;
            if (!confirm(`Mark ${coupon.code} as used for ${client.name || 'this client'}?`)) return;
            try {
                const clientRef = db.collection('clients').doc(clientUid);
                const snapshot = await clientRef.get();
                if (!snapshot.exists) throw new Error('Client not found.');
                const coupons = [...(snapshot.data().coupons || [])];
                if (!coupons[couponIndex] || coupons[couponIndex].used) throw new Error('This coupon was already used.');
                coupons[couponIndex] = {
                    ...coupons[couponIndex],
                    used: true,
                    usedAt: new Date().toISOString(),
                    usedBy: this.user.uid
                };
                await clientRef.update({ coupons });
                client.coupons = coupons;
                if (clientUid === this.user.uid) this.userData.coupons = coupons;
                alert(`${coupons[couponIndex].code} is now marked used.`);
            } catch (err) {
                alert('Unable to mark this coupon used: ' + err.message);
            }
        },

        async rolloverLoyaltyStatuses() {
            if (!this.isAdmin || !this.adminModeActive) return;
            const targetYear = this.tierSeasonYear;
            const clientsToRoll = this.clientList.filter(client => Number(client.qualifyingYear || targetYear) < targetYear);
            if (!clientsToRoll.length) return;
            if (!confirm(`Start the ${targetYear} Paw Status season for ${clientsToRoll.length} client(s)? Their status will be set from last year's qualifying points, and their new qualifying balance will begin at zero.`)) return;

            try {
                await Promise.all(clientsToRoll.map(client => {
                    const earnedStatus = this.tierKeyForPoints(client.yearlyPoints || 0);
                    return db.collection('clients').doc(client.id).update({
                        statusTier: earnedStatus,
                        statusYear: targetYear,
                        yearlyPoints: 0,
                        qualifyingYear: targetYear
                    });
                }));
                // Delivery is best-effort: a successful status rollover must never be
                // undone because a client has not opted into push notifications.
                await Promise.allSettled(clientsToRoll.map(client => {
                    const earnedStatus = this.tierKeyForPoints(client.yearlyPoints || 0);
                    return this.sendPointUpdatePush(client.id, client.points || 0, this.getClientTier({ statusTier: earnedStatus }).name);
                }));
                await this.fetchClientsList();
                alert(`The ${targetYear} Paw Status season is ready.`);
            } catch (err) {
                alert('Unable to roll over member statuses: ' + err.message);
            }
        },

        async updateClientPoints() {
            if (!this.adminForm.targetUid) return alert('Select a client.');

            const targetRef = db.collection('clients').doc(this.adminForm.targetUid);
            const doc = await targetRef.get();

            if (!doc.exists) return alert('Client not found!');

            const currentPts = doc.data().points || 0;
            const currentLifetime = doc.data().lifetimePoints || currentPts;
            const currentProgramYear = this.tierSeasonYear;
            const storedQualifyingYear = Number(doc.data().qualifyingYear || currentProgramYear);
            const currentYearly = storedQualifyingYear === currentProgramYear ? Number(doc.data().yearlyPoints || 0) : 0;
            const delta = parseInt(this.adminForm.pointsDelta || 0);
            const newPts = currentPts + delta;
            const newLifetime = delta > 0 ? currentLifetime + delta : currentLifetime;
            const newYearly = this.adminForm.countsTowardStatus && delta > 0 ? currentYearly + delta : currentYearly;

            const update = {
                points: newPts,
                lifetimePoints: newLifetime,
                yearlyPoints: newYearly,
                qualifyingYear: currentProgramYear
            };
            if (this.adminForm.overrideStatusTier) {
                update.statusTier = this.adminForm.overrideStatusTier;
                update.statusYear = currentProgramYear;
            }
            let issuedCoupon = null;
            if (this.adminForm.couponTitle) {
                issuedCoupon = {
                    code: 'PAW-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
                    title: this.adminForm.couponTitle,
                    used: false,
                    createdAt: new Date().toISOString()
                };
                update.coupons = [...(doc.data().coupons || []), issuedCoupon];
            }
            await targetRef.update(update);
            if (issuedCoupon) {
                await this.sendCouponPush(this.adminForm.targetUid, issuedCoupon, newPts);
            } else if (delta !== 0 || this.adminForm.overrideStatusTier) {
                await this.sendPointUpdatePush(
                    this.adminForm.targetUid,
                    newPts,
                    this.adminForm.overrideStatusTier ? this.getClientTier({ statusTier: this.adminForm.overrideStatusTier }).name : ''
                );
            }

            alert(`Updated client points and tier successfully!`);

            if (this.adminForm.targetUid === this.user.uid) {
                this.userData.points = newPts;
                this.userData.lifetimePoints = newLifetime;
                this.userData.yearlyPoints = newYearly;
                this.userData.qualifyingYear = currentProgramYear;
                if (this.adminForm.overrideStatusTier) {
                    this.userData.statusTier = this.adminForm.overrideStatusTier;
                    this.userData.statusYear = currentProgramYear;
                }
                await this.identifyOneSignalUser();
                this.showPersonalNotification('🐾 Paw Points updated', `You now have ${newPts} Paw Points.`, 'points', '/?view=loyalty');
            }

            this.showAdminModal = false;
            this.adminForm = { targetUid: '', pointsDelta: 0, tipAmount: '', couponTitle: '', countsTowardStatus: true, overrideStatusTier: '' };
        },

        async logout() {
            if (this.oneSignalConfigured) {
                window.OneSignalDeferred.push(async (OneSignal) => {
                    try { await OneSignal.logout(); } catch (err) { console.warn('OneSignal logout failed:', err); }
                });
            }
            await auth.signOut();
            this.user = null;
            this.userData = {};
            this.isVerified = false;
            this.pushEnabled = false;
        }
    }
}

window.pawApp = pawApp;
