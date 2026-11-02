# Pubblicazione di Maestrale su Google Play e App Store

Guida passo a passo per pubblicare l'app Flutter in `app/`.

## Dati dell'app (stato attuale)

| Voce | Valore |
|---|---|
| Nome visualizzato | Maestrale |
| Package Flutter | `sardegna_mare_app` |
| Versione | `1.0.0+1` (`app/pubspec.yaml`) |
| Android `applicationId` | `it.sardegnamare.sardegna_mare_app` |
| iOS Bundle ID | `it.sardegnamare.sardegnaMareApp` |
| iOS deployment target | 13.0 |
| Permessi | Internet, posizione (coarse/fine su Android, "When In Use" su iOS) |

> **Attenzione:** in `app/android/app/build.gradle.kts` la build `release` è firmata con la chiave **debug** (`signingConfig = signingConfigs.getByName("debug")`). Google Play rifiuta questi pacchetti: va sistemato prima (vedi Android, passo 2).

> L'`applicationId` e il Bundle ID sono **definitivi** dopo la prima pubblicazione. Se vuoi cambiarli, fallo adesso.

---

## 0. Prerequisiti comuni

- [ ] Informativa privacy pubblicata a un URL pubblico. Serve perché l'app usa la posizione.
- [ ] Icona dell'app (1024×1024 senza trasparenza) e icone di lancio aggiornate in `app/android` e `app/ios`.
- [ ] Screenshot (vedi i requisiti sotto).
- [ ] Descrizione breve e lunga, parole chiave, email di supporto.
- [ ] Nota sulle fonti dati meteo/marine (Open-Meteo, Copernicus), con attribuzioni e licenze rispettate.
- [ ] `flutter doctor` senza errori, `flutter analyze` e `flutter test` verdi.
- [ ] Endpoint di produzione del Worker configurato nell'app (non localhost).

Versioning: aumenta `version: X.Y.Z+N` in `pubspec.yaml`. `N` (build number) deve **crescere a ogni caricamento** su entrambi gli store.

---

## 1. Android: Google Play

### 1. Account sviluppatore
1. Registrati su <https://play.google.com/console> (one-time fee 25 USD).
2. Completa la verifica dell'identità. Gli account personali nuovi devono in genere fare un **closed test con almeno 12 tester per 14 giorni** prima di accedere alla produzione. Verifica i requisiti correnti in Play Console.

### 2. Keystore di firma (upload key)
```bash
keytool -genkey -v -keystore ~/maestrale-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```
Conserva il file e le password in un posto sicuro (fuori da git). Con Play App Signing, se perdi l'upload key puoi chiederne il reset, ma è un processo lungo.

Crea `app/android/key.properties` (**da aggiungere a `.gitignore`**):
```properties
storePassword=<password>
keyPassword=<password>
keyAlias=upload
storeFile=/Users/<utente>/maestrale-upload.jks
```

In `app/android/app/build.gradle.kts` carica il file e usa una config `release`:
```kotlin
import java.util.Properties
import java.io.FileInputStream

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

### 3. Build dell'App Bundle
```bash
cd app
flutter clean && flutter pub get
flutter build appbundle --release
```
Output: `app/build/app/outputs/bundle/release/app-release.aab`

### 4. Creare l'app in Play Console
1. **Crea app**: nome "Maestrale", lingua predefinita italiano, tipo App, gratuita/a pagamento (non modificabile dopo).
2. Compila **Dashboard → Configura l'app**:
   - Privacy policy (URL)
   - Accesso all'app (nessun login)
   - Annunci (sì/no)
   - Classificazione dei contenuti (questionario)
   - Pubblico target
   - **Sicurezza dei dati**: dichiara la raccolta della posizione approssimativa/precisa e se viene condivisa/trasmessa
   - Dichiarazione sui permessi di posizione, se richiesta
3. **Scheda dello Store principale**: descrizione breve (80 caratteri), completa (4000), icona 512×512, immagine in evidenza 1024×500, almeno 2 screenshot per il telefono.

### 5. Test e rilascio
1. **Test → Test interni**: crea un rilascio, carica il `.aab`, aggiungi gli indirizzi email dei tester e invia il link di opt-in.
2. **Test chiuso** se richiesto dal tuo tipo di account (vedi sopra).
3. **Produzione → Crea nuovo rilascio** → carica l'AAB → note di rilascio → **Revisione** → **Avvia il rollout** (puoi iniziare con una percentuale).
4. La revisione può richiedere da poche ore a qualche giorno.

### 6. Aggiornamenti
Incrementa il build number (`1.0.1+2`), ripeti la build e carica un nuovo rilascio.

---

## 2. iOS: App Store

Serve un Mac con Xcode aggiornato.

### 1. Account sviluppatore
1. Iscriviti all'**Apple Developer Program** (99 USD/anno): <https://developer.apple.com/programs/>.
2. Accedi con lo stesso Apple ID in Xcode (**Settings → Accounts**).

### 2. Identificativo e firma
1. In <https://developer.apple.com/account> → *Identifiers* registra l'App ID `it.sardegnamare.sardegnaMareApp` (oppure lascia che Xcode lo faccia).
2. Apri `app/ios/Runner.xcworkspace` in Xcode.
3. Target **Runner → Signing & Capabilities**: seleziona il tuo **Team** e attiva **Automatically manage signing**.
4. Verifica **Display Name**, **Version** e **Build**, e che il deployment target sia coerente con i plugin (attualmente 13.0).

### 3. Info.plist e privacy
- `NSLocationWhenInUseUsageDescription` è presente: controlla che il testo spieghi chiaramente perché serve la posizione (Apple lo rivede).
- Se l'app non usa crittografia oltre HTTPS, aggiungi in `Info.plist`:
  ```xml
  <key>ITSAppUsesNonExemptEncryption</key>
  <false/>
  ```
- Se i plugin o l'app usano API "required reason", assicurati che esista il Privacy Manifest (`PrivacyInfo.xcprivacy`); `shared_preferences` e altri plugin ne usano di solito uno proprio.

### 4. Creare l'app su App Store Connect
1. <https://appstoreconnect.apple.com> → **Apps → + → Nuova app**.
2. Piattaforma iOS, nome "Maestrale", lingua principale italiano, Bundle ID scelto prima, SKU a piacere (es. `maestrale-ios`).

### 5. Build e upload
```bash
cd app
flutter clean && flutter pub get
cd ios && pod install --repo-update && cd ..
flutter build ipa --release
```
Output: `app/build/ios/ipa/*.ipa`

Caricamento (una delle due):
- **Transporter** (app Mac Store): trascina l'`.ipa` e premi *Deliver*.
- Xcode: `open build/ios/archive/Runner.xcarchive` → *Distribute App → App Store Connect → Upload*.

Dopo alcuni minuti la build compare in App Store Connect (elaborazione e controlli automatici; arriva una mail in caso di problemi).

### 6. TestFlight
1. **TestFlight** → seleziona la build → rispondi alle domande sulla conformità all'export.
2. **Test interni**: aggiungi utenti del tuo team (nessuna revisione).
3. **Test esterni**: crea un gruppo, aggiungi tester o link pubblico. La prima build richiede una breve revisione Beta.

### 7. Scheda App Store
Nella versione 1.0 compila:
- Screenshot: iPhone 6.9" (obbligatorio per il set più grande), eventualmente 6.5"; iPad solo se l'app lo supporta. Controlla le dimensioni attuali richieste in App Store Connect.
- Testo promozionale, descrizione, parole chiave, URL di supporto, URL marketing (opzionale).
- Categoria (es. Meteo), classificazione per età.
- **URL privacy policy** e **App Privacy** (le "etichette"): dichiara la posizione e l'uso che ne fai.
- Informazioni per la revisione: contatto e note (nessun account di test necessario se non c'è login).

### 8. Invio in revisione
1. Seleziona la build nella versione 1.0.
2. **Aggiungi per la revisione → Invia**.
3. La revisione dura normalmente 24–48 ore. In caso di rifiuto, correggi e reinvia da *Resolution Center*.
4. Scegli il rilascio manuale o automatico.

### 9. Aggiornamenti
Incrementa `version` e/o il build number (`1.0.1+2`), ripeti `flutter build ipa`, carica la build e invia una nuova versione.

---

## 3. Checklist finale

**Android**
- [ ] Release firmata con upload key (non debug)
- [ ] `key.properties` e `.jks` fuori da git
- [ ] AAB caricato, scheda store, Data safety e classificazione completati
- [ ] Test interno/chiuso fatto

**iOS**
- [ ] Team e firma configurati
- [ ] Testo del permesso posizione chiaro
- [ ] Build su TestFlight verificata
- [ ] App Privacy, screenshot e URL privacy completati

## Riferimenti
- Flutter Android: <https://docs.flutter.dev/deployment/android>
- Flutter iOS: <https://docs.flutter.dev/deployment/ios>
- Play Console: <https://support.google.com/googleplay/android-developer>
- App Store Connect: <https://developer.apple.com/help/app-store-connect/>
