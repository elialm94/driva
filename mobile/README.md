# Ferva – mobilskal (Capacitor)

Ett tunt Capacitor-skal som laddar den driftsatta Ferva-webbappen (PWA:n) i
en native WebView. Skalet innehåller ingen egen affärslogik: en deploy av
webben är en deploy av appen.

**Status: skalet är körbart lokalt men INTE butiksklart.** Se listan längst
ner innan något skickas till App Store eller Google Play.

## Förutsättningar

- Node 20+
- iOS: macOS med Xcode 15+ och CocoaPods
- Android: Android Studio (Hedgehog eller nyare) med SDK 34

Skalet installeras separat från webbappens `node_modules` – det ska aldrig
dra in Capacitor i webbygget.

```bash
cd mobile
npm install
mkdir -p www && echo '<!doctype html><title>Ferva</title>' > www/index.html
```

## Bygg mot rätt miljö

`capacitor.config.ts` läser `FERVA_APP_URL`. Utan variabeln laddas den
lokala dev-servern (`http://10.0.2.2:3000`, Android-emulatorns alias för
värdmaskinen).

```bash
# Produktion
FERVA_APP_URL=https://app.ferva.se npx cap sync

# Lokal utveckling (kör `npm run dev` i repo-roten först)
npx cap sync
```

## Plattformar

```bash
# Första gången
npx cap add ios
npx cap add android

# Öppna i IDE / kör på enhet
npx cap open ios
npx cap open android
npx cap run android
```

De genererade mapparna `ios/` och `android/` checkas in när de skapats första
gången; efter det körs `npx cap sync` vid varje ändring i konfigurationen.

## Plattformsspecifika filer att underhålla

| Fil | Varför |
| --- | --- |
| `ios/App/App/Info.plist` | `NSCameraUsageDescription` (foton/kvitton i fältläget), `NSPhotoLibraryUsageDescription`, `WKAppBoundDomains` med appens domän |
| `ios/App/App/Assets.xcassets/AppIcon.appiconset` | App-ikonen – generera från `public/icons/icon-512.png` med `@capacitor/assets` |
| `ios/App/App/Assets.xcassets/Splash.imageset` | Splash-bild |
| `android/app/src/main/AndroidManifest.xml` | `CAMERA`-permission, `android:usesCleartextTraffic` får bara vara `true` i debug |
| `android/app/src/main/res/mipmap-*` | Launcher-ikoner |
| `android/app/src/main/res/values/strings.xml` | Appnamn |
| `android/app/build.gradle` | `applicationId se.ferva.app`, versionCode/versionName per release |
| `ios/App/App.xcodeproj` | Bundle identifier `se.ferva.app`, Team/signing, version/build |

## Hur webben och skalet hänger ihop

- Sessionen är en vanlig httpOnly-cookie i WebView:n. `server.url` måste
  därför vara exakt appens origin – ingen preview-URL.
- Service workern (`/sw.js`) och offline-lagret (IndexedDB) fungerar likadant
  i WebView:n som i Safari/Chrome. Fältläget kräver ingen native-kod.
- Kamera nås via `<input type="file" capture>` – WebView:n öppnar systemets
  kamera. Ingen Capacitor Camera-plugin krävs för V1.
- Djuplänkar (`/offert/<token>`, `/faktura/<token>`) öppnas i systemets
  webbläsare, inte i appen – de är kundens vy, inte hantverkarens.

## Inte butiksklart – återstår innan publicering

- [ ] Riktiga ikoner och splash (nuvarande PNG:er är platshållare)
- [ ] Sekretesspolicy-URL och App Privacy-deklaration (Apple) / Data safety (Google)
- [ ] Apple: motivering för WebView-app (riktlinje 4.2) – fältläget och offlinekön är det native-värdet
- [ ] Google: `targetSdkVersion` enligt aktuell Play-policy
- [ ] Signering: Apple Distribution-certifikat, Android upload key i säker lagring (aldrig i repot)
- [ ] Djuplänkar / universal links om appen ska fånga `app.ferva.se`
- [ ] Push-notiser (kräver plugin + server; inte i V1)
- [ ] Testkörning på fysisk iPhone och Android-enhet med nätet avstängt: registrera tid, ta foto, gå online, verifiera synk
